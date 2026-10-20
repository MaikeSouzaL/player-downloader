import AVFoundation
import Foundation
import MediaPlayer
import UIKit

/// Item da fila como o JS manda (mesmo formato do Android).
struct QueueEntry: Codable, Equatable {
  var id: String
  var uri: String
  var title: String
  var artist: String?
  var album: String?
  var artworkUri: String?
}

/**
 * Player do iOS: AVAudioEngine (nó de reprodução → velocidade → equalizador → saída), para ter equalizador
 * de verdade, que o AVPlayer não oferece. Mesmo comportamento do player media3 do Android: fila com ordem
 * aleatória, repetir, velocidade, timer com fade-out, tela de bloqueio, fone e interrupções (ligação).
 * Tudo roda na thread principal.
 */
final class RitmoPlayer: NSObject {
  static let shared = RitmoPlayer()

  // Avisos para o módulo (que repassa ao JS) e para o CarPlay.
  var onState: (([String: Any]) -> Void)?
  var onProgress: (([String: Any]) -> Void)?
  var onSleepTimer: (([String: Any]) -> Void)?
  var onIssue: (([String: Any]) -> Void)?
  var onQueueChanged: (() -> Void)?
  /// Em segundo plano o progresso só serve para somar o tempo ouvido: avisa a cada 10 s.
  var inForeground = true {
    didSet { restartProgressTimer() }
  }

  private let engine = AVAudioEngine()
  private let node = AVAudioPlayerNode()
  private let timePitch = AVAudioUnitTimePitch()
  let eq = AVAudioUnitEQ(numberOfBands: Equalizer.bandCount + 1)
  private var connectedFormat: AVAudioFormat?

  private(set) var items: [QueueEntry] = []
  /// Ordem real de reprodução (índices de `items`); igual a 0..n-1 sem o aleatório.
  private(set) var order: [Int] = []
  private(set) var index = -1
  private(set) var shuffle = false
  private(set) var repeatMode = "off"
  private(set) var speed: Float = 1
  private var playWhenReady = false
  private var status = "idle"
  private var errorMessage: String?

  private var file: AVAudioFile?
  private var startFrame: AVAudioFramePosition = 0
  private var stoppedPositionMs: Double = 0
  /// Última posição lida com o motor tocando; vale quando o motor para sozinho (fone Bluetooth, ligação).
  private var lastLivePositionMs: Double = 0
  private var scheduleToken = 0
  private var loadToken = 0
  private var consecutiveErrors = 0
  private var progressTimer: Timer?
  private var saveTimer: Timer?
  private var resumeAfterInterruption = false
  private var commandsReady = false

  // Timer para dormir.
  private var sleepAt: Date?
  private var sleepEndOfTrack = false
  private var sleepTimer: Timer?
  private static let fadeSeconds: TimeInterval = 20

  private override init() {
    super.init()
    engine.attach(node)
    engine.attach(timePitch)
    engine.attach(eq)
    Equalizer.configure(eq)
    engine.connect(timePitch, to: eq, format: nil)
    engine.connect(eq, to: engine.mainMixerNode, format: nil)

    let center = NotificationCenter.default
    center.addObserver(self, selector: #selector(onInterruption(_:)), name: AVAudioSession.interruptionNotification, object: nil)
    center.addObserver(self, selector: #selector(onRouteChange(_:)), name: AVAudioSession.routeChangeNotification, object: nil)
    center.addObserver(self, selector: #selector(onEngineConfigChange(_:)), name: .AVAudioEngineConfigurationChange, object: engine)
    center.addObserver(self, selector: #selector(onMediaServicesReset(_:)), name: AVAudioSession.mediaServicesWereResetNotification, object: nil)
    Equalizer.restoreSaved(into: eq)
  }

  // MARK: - Estado para o JS

  var currentEntry: QueueEntry? { items.indices.contains(index) ? items[index] : nil }

  var isPlaying: Bool { playWhenReady && node.isPlaying && status == "ready" }

  var positionMs: Double {
    guard let file, node.isPlaying else { return stoppedPositionMs }
    guard let nodeTime = node.lastRenderTime, let playerTime = node.playerTime(forNodeTime: nodeTime) else {
      // Nó "tocando" mas o motor parou (troca de saída, interrupção): vale a última leitura boa.
      return max(stoppedPositionMs, lastLivePositionMs)
    }
    let frames = Double(startFrame) + Double(playerTime.sampleTime)
    let ms = min(Double(file.length), max(0, frames)) / file.processingFormat.sampleRate * 1000
    lastLivePositionMs = ms
    return ms
  }

  var durationMs: Double {
    guard let file else { return 0 }
    return Double(file.length) / file.processingFormat.sampleRate * 1000
  }

  func snapshot() -> [String: Any] {
    [
      "isPlaying": isPlaying,
      "playWhenReady": playWhenReady,
      "state": status,
      "index": index,
      "mediaId": currentEntry?.id ?? NSNull(),
      "position": positionMs,
      "duration": durationMs,
      "shuffle": shuffle,
      "repeat": repeatMode,
      "speed": Double(speed),
      "queueLength": items.count,
      "error": errorMessage ?? NSNull(),
    ]
  }

  func queueInfo() -> [String: Any] {
    ["ids": items.map(\.id), "order": order, "index": index]
  }

  private func progress() -> [String: Any] {
    ["mediaId": currentEntry?.id ?? NSNull(), "position": positionMs, "duration": durationMs, "buffered": durationMs]
  }

  private func emitState() {
    onState?(snapshot())
  }

  // MARK: - Fila

  func setQueue(_ newItems: [QueueEntry], startIndex: Int, positionMs: Double, play: Bool) {
    items = newItems
    guard !items.isEmpty else {
      clearPlayback()
      return
    }
    let start = min(max(0, startIndex), items.count - 1)
    order = shuffle ? shuffledOrder(first: start) : Array(items.indices)
    queueChanged()
    load(index: start, positionMs: positionMs, play: play)
  }

  func addToQueue(_ newItems: [QueueEntry], playNext: Bool) {
    guard !newItems.isEmpty else { return }
    if items.isEmpty {
      setQueue(newItems, startIndex: 0, positionMs: 0, play: false)
      return
    }
    let insertAt = playNext ? index + 1 : items.count
    items.insert(contentsOf: newItems, at: insertAt)
    let added = Array(insertAt..<(insertAt + newItems.count))
    if shuffle {
      order = order.map { $0 >= insertAt ? $0 + newItems.count : $0 }
      if playNext, let pos = order.firstIndex(of: index) {
        order.insert(contentsOf: added, at: pos + 1)
      } else {
        order.append(contentsOf: added)
      }
    } else {
      order = Array(items.indices)
    }
    if insertAt <= index { index += newItems.count }
    queueChanged()
    emitState()
  }

  func remove(at i: Int) {
    guard items.indices.contains(i) else { return }
    let wasCurrent = i == index
    let nextAfterRemoval: Int? = wasCurrent ? nextIndex(wrap: repeatMode == "all") : nil
    items.remove(at: i)
    order = order.filter { $0 != i }.map { $0 > i ? $0 - 1 : $0 }
    if !shuffle { order = Array(items.indices) }
    if items.isEmpty {
      clearPlayback()
      return
    }
    // Ajusta o índice antes de salvar a fila.
    if !wasCurrent, i < index { index -= 1 }
    queueChanged()
    if wasCurrent {
      // Como o media3: segue para a próxima (ou para a primeira, se a removida era a última).
      var target = nextAfterRemoval.map { $0 > i ? $0 - 1 : $0 } ?? min(i, items.count - 1)
      if !items.indices.contains(target) { target = 0 }
      load(index: target, positionMs: 0, play: playWhenReady)
    } else {
      emitState()
    }
  }

  func move(from: Int, to: Int) {
    guard items.indices.contains(from), items.indices.contains(to), from != to else { return }
    let mapIndex: (Int) -> Int = { k in
      if k == from { return to }
      if from < to, k > from, k <= to { return k - 1 }
      if from > to, k >= to, k < from { return k + 1 }
      return k
    }
    let item = items.remove(at: from)
    items.insert(item, at: to)
    index = mapIndex(index)
    order = shuffle ? order.map(mapIndex) : Array(items.indices)
    queueChanged()
    emitState()
  }

  func skip(to i: Int) {
    guard items.indices.contains(i) else { return }
    load(index: i, positionMs: 0, play: true)
  }

  func next() {
    guard let target = nextIndex(wrap: repeatMode != "off") else { return }
    load(index: target, positionMs: 0, play: playWhenReady)
  }

  /// Volta ao começo se já tocou mais de 3 s; senão vai para a anterior (como o media3).
  func previous() {
    if positionMs > 3000 || items.count <= 1 {
      seek(toMs: 0)
      return
    }
    if let target = previousIndex(wrap: repeatMode != "off") {
      load(index: target, positionMs: 0, play: playWhenReady)
    } else {
      seek(toMs: 0)
    }
  }

  func setShuffle(_ enabled: Bool) {
    guard enabled != shuffle else { return }
    shuffle = enabled
    order = enabled ? shuffledOrder(first: max(0, index)) : Array(items.indices)
    queueChanged()
    emitState()
  }

  func setRepeat(_ mode: String) {
    repeatMode = ["off", "one", "all"].contains(mode) ? mode : "off"
    emitState()
    saveState()
  }

  func setSpeed(_ value: Float) {
    speed = min(4, max(0.25, value))
    timePitch.rate = speed
    updateNowPlayingTimes()
    emitState()
    saveState()
  }

  private func shuffledOrder(first: Int) -> [Int] {
    guard items.indices.contains(first) else { return Array(items.indices).shuffled() }
    return [first] + items.indices.filter { $0 != first }.shuffled()
  }

  private func nextIndex(wrap: Bool) -> Int? {
    guard let pos = order.firstIndex(of: index) else { return order.first }
    if pos + 1 < order.count { return order[pos + 1] }
    return wrap ? order.first : nil
  }

  private func previousIndex(wrap: Bool) -> Int? {
    guard let pos = order.firstIndex(of: index) else { return order.first }
    if pos > 0 { return order[pos - 1] }
    return wrap ? order.last : nil
  }

  private func queueChanged() {
    saveItems()
    onQueueChanged?()
  }

  // MARK: - Controles

  func play() {
    guard currentEntry != nil else { return }
    if status == "ended" {
      load(index: index, positionMs: stoppedPositionMs < durationMs ? stoppedPositionMs : 0, play: true)
      return
    }
    playWhenReady = true
    if file == nil {
      // Ainda carregando (ou falhou): carrega de novo de onde parou.
      load(index: index, positionMs: stoppedPositionMs, play: true)
      return
    }
    startEngineAndNode()
    emitState()
  }

  func pause() {
    playWhenReady = false
    if node.isPlaying { stoppedPositionMs = positionMs }
    node.pause()
    stopProgressTimer()
    updateNowPlayingTimes()
    emitState()
    saveState()
  }

  func toggle() {
    isPlaying ? pause() : play()
  }

  func seek(toMs ms: Double) {
    if status == "ended" {
      stoppedPositionMs = max(0, min(ms, durationMs - 1))
      updateNowPlayingTimes()
      emitState()
      return
    }
    guard file != nil else {
      stoppedPositionMs = max(0, ms)
      emitState()
      return
    }
    let wasPlaying = playWhenReady
    stopNode()
    schedule(fromMs: ms)
    if wasPlaying { startEngineAndNode() }
    updateNowPlayingTimes()
    emitState()
    saveState()
  }

  private func clearPlayback() {
    stopNode()
    loadToken += 1
    file = nil
    items = []
    order = []
    index = -1
    playWhenReady = false
    status = "idle"
    errorMessage = nil
    stoppedPositionMs = 0
    stopProgressTimer()
    MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    queueChanged()
    emitState()
  }

  // MARK: - Carregar e agendar

  private func load(index newIndex: Int, positionMs: Double, play: Bool) {
    guard items.indices.contains(newIndex) else {
      clearPlayback()
      return
    }
    setupRemoteCommandsIfNeeded()
    stopNode()
    loadToken += 1
    let token = loadToken
    index = newIndex
    playWhenReady = play
    file = nil
    stoppedPositionMs = max(0, positionMs)
    status = "buffering"
    errorMessage = nil
    let entry = items[newIndex]
    updateNowPlaying()
    emitState()

    MediaSource.resolve(entry) { [weak self] result in
      guard let self, token == self.loadToken else { return }
      switch result {
      case .failure(let error):
        self.handleError(error, entry: entry, code: (error as NSError).domain == MediaSource.errorDomain ? "IO_FILE_NOT_FOUND" : "IO_UNSPECIFIED")
      case .success(let url):
        do {
          let audioFile = try AVAudioFile(forReading: url)
          try self.connect(format: audioFile.processingFormat)
          self.file = audioFile
          self.status = "ready"
          self.schedule(fromMs: positionMs)
          if self.playWhenReady { self.startEngineAndNode() }
          // Título e capa já foram montados no começo do carregamento; aqui só os tempos mudam.
          self.updateNowPlayingTimes()
          self.emitState()
          self.saveState()
        } catch {
          self.handleError(error, entry: entry, code: "DECODING_FORMAT_UNSUPPORTED")
        }
      }
    }
  }

  /// Liga a cadeia nó → velocidade → equalizador no formato do arquivo (taxa de amostragem e canais mudam
  /// entre músicas); o mixer principal converte para a saída do aparelho.
  private func connect(format: AVAudioFormat) throws {
    if let connectedFormat, connectedFormat == format { return }
    if engine.isRunning { engine.stop() }
    engine.disconnectNodeOutput(node)
    engine.disconnectNodeOutput(timePitch)
    engine.disconnectNodeOutput(eq)
    engine.connect(node, to: timePitch, format: format)
    engine.connect(timePitch, to: eq, format: format)
    engine.connect(eq, to: engine.mainMixerNode, format: format)
    connectedFormat = format
  }

  private func schedule(fromMs ms: Double) {
    guard let file else { return }
    lastLivePositionMs = max(0, ms)
    scheduleToken += 1
    let token = scheduleToken
    let rate = file.processingFormat.sampleRate
    var start = AVAudioFramePosition((max(0, ms) / 1000) * rate)
    if start >= file.length { start = max(0, file.length - 1) }
    startFrame = start
    stoppedPositionMs = Double(start) / rate * 1000
    let count = AVAudioFrameCount(max(0, file.length - start))
    guard count > 0 else {
      DispatchQueue.main.async { [weak self] in self?.itemFinished(token) }
      return
    }
    node.scheduleSegment(file, startingFrame: start, frameCount: count, at: nil, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      DispatchQueue.main.async { self?.itemFinished(token) }
    }
  }

  private func stopNode() {
    // Parar o nó dispara os callbacks de fim dos trechos agendados: o token novo faz eles serem ignorados.
    scheduleToken += 1
    if node.isPlaying { stoppedPositionMs = positionMs }
    node.stop()
  }

  private func startEngineAndNode() {
    activateSession()
    do {
      if !engine.isRunning { try engine.start() }
      node.play()
      consecutiveErrors = 0
      restartProgressTimer()
      updateNowPlayingTimes()
    } catch {
      errorMessage = error.localizedDescription
      playWhenReady = false
      reportIssue(type: "stop", entry: currentEntry, code: "AUDIO_TRACK_INIT_FAILED", message: error.localizedDescription)
    }
  }

  private func itemFinished(_ token: Int) {
    guard token == scheduleToken, file != nil else { return }
    if sleepEndOfTrack {
      // Timer "fim da faixa": avança para a próxima, mas pausada.
      finishSleep()
      if let target = nextIndex(wrap: repeatMode != "off") {
        load(index: target, positionMs: 0, play: false)
      } else {
        endOfQueue()
      }
      return
    }
    if repeatMode == "one" {
      stopNode()
      schedule(fromMs: 0)
      if playWhenReady { startEngineAndNode() }
      updateNowPlayingTimes()
      emitState()
      return
    }
    if let target = nextIndex(wrap: repeatMode == "all") {
      load(index: target, positionMs: 0, play: playWhenReady)
    } else {
      endOfQueue()
    }
  }

  private func endOfQueue() {
    stopNode()
    stoppedPositionMs = durationMs
    playWhenReady = false
    status = "ended"
    stopProgressTimer()
    updateNowPlayingTimes()
    emitState()
    saveState()
  }

  /// Arquivo sumiu, sem permissão ou formato que o iPhone não toca: tira da fila e segue (como no Android).
  private func handleError(_ error: Error, entry: QueueEntry, code: String) {
    consecutiveErrors += 1
    let count = items.count
    let skip = count > 1 && consecutiveErrors < count && items.indices.contains(index)
    reportIssue(type: skip ? "skip" : "stop", entry: entry, code: code, message: error.localizedDescription)
    if skip {
      remove(at: index)
    } else {
      consecutiveErrors = 0
      playWhenReady = false
      status = "idle"
      errorMessage = error.localizedDescription
      emitState()
    }
  }

  private func reportIssue(type: String, entry: QueueEntry?, code: String, message: String) {
    onIssue?([
      "type": type,
      "mediaId": entry?.id ?? NSNull(),
      "title": entry?.title ?? NSNull(),
      "code": code,
      "message": message,
    ])
  }

  // MARK: - Sessão de áudio, interrupções e fone

  private func activateSession() {
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(.playback, mode: .default, options: [])
      try session.setActive(true)
    } catch {
      // Sem a sessão o som ainda pode sair; o erro aparece se o motor não ligar.
    }
  }

  @objc private func onInterruption(_ note: Notification) {
    guard let info = note.userInfo, let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
      let type = AVAudioSession.InterruptionType(rawValue: raw)
    else { return }
    DispatchQueue.main.async {
      if type == .began {
        self.resumeAfterInterruption = self.playWhenReady
        if self.playWhenReady { self.pause() }
      } else {
        let options = AVAudioSession.InterruptionOptions(rawValue: info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
        if self.resumeAfterInterruption, options.contains(.shouldResume) {
          if self.engine.isRunning || self.file == nil {
            self.play()
          } else {
            self.playWhenReady = true
            self.seek(toMs: self.stoppedPositionMs)
          }
        }
        self.resumeAfterInterruption = false
      }
    }
  }

  @objc private func onRouteChange(_ note: Notification) {
    guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
      let reason = AVAudioSession.RouteChangeReason(rawValue: raw)
    else { return }
    // Tirou o fone / desconectou o Bluetooth: pausa (como o "becoming noisy" do Android).
    if reason == .oldDeviceUnavailable {
      DispatchQueue.main.async { if self.playWhenReady { self.pause() } }
    }
  }

  /// O motor para quando a saída muda de formato (ex.: fone Bluetooth): religa onde estava.
  @objc private func onEngineConfigChange(_ note: Notification) {
    DispatchQueue.main.async {
      guard let file = self.file else { return }
      let position = self.positionMs
      let wasPlaying = self.playWhenReady
      self.stopNode()
      self.connectedFormat = nil
      try? self.connect(format: file.processingFormat)
      self.schedule(fromMs: position)
      if wasPlaying { self.startEngineAndNode() }
    }
  }

  @objc private func onMediaServicesReset(_ note: Notification) {
    DispatchQueue.main.async {
      let position = self.positionMs
      let wasPlaying = self.playWhenReady
      self.connectedFormat = nil
      if self.items.indices.contains(self.index) { self.load(index: self.index, positionMs: position, play: wasPlaying) }
    }
  }

  // MARK: - Tela de bloqueio e controle remoto (fone, Central de Controle, CarPlay)

  private func setupRemoteCommandsIfNeeded() {
    guard !commandsReady else { return }
    commandsReady = true
    UIApplication.shared.beginReceivingRemoteControlEvents()
    let center = MPRemoteCommandCenter.shared()
    // Outros módulos (expo-video) podem desligar os comandos: liga de forma explícita.
    let simple: [(MPRemoteCommand, (RitmoPlayer) -> Void)] = [
      (center.playCommand, { $0.play() }),
      (center.pauseCommand, { $0.pause() }),
      (center.togglePlayPauseCommand, { $0.toggle() }),
      (center.nextTrackCommand, { $0.next() }),
      (center.previousTrackCommand, { $0.previous() }),
    ]
    for (command, action) in simple {
      command.isEnabled = true
      command.addTarget { [weak self] _ in
        DispatchQueue.main.async { if let self { action(self) } }
        return .success
      }
    }
    center.changePlaybackPositionCommand.isEnabled = true
    center.changePlaybackPositionCommand.addTarget { [weak self] event in
      guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
      let ms = event.positionTime * 1000
      DispatchQueue.main.async { self?.seek(toMs: ms) }
      return .success
    }
    center.skipForwardCommand.isEnabled = false
    center.skipBackwardCommand.isEnabled = false
  }

  private var artworkToken = 0

  private func updateNowPlaying() {
    guard let entry = currentEntry else {
      MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
      return
    }
    var info: [String: Any] = [
      MPMediaItemPropertyTitle: entry.title,
      MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
      MPNowPlayingInfoPropertyPlaybackQueueIndex: index,
      MPNowPlayingInfoPropertyPlaybackQueueCount: items.count,
    ]
    if let artist = entry.artist { info[MPMediaItemPropertyArtist] = artist }
    if let album = entry.album { info[MPMediaItemPropertyAlbumTitle] = album }
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    updateNowPlayingTimes()

    artworkToken += 1
    let token = artworkToken
    Task {
      guard let image = await ArtworkSource.image(for: entry) else { return }
      await MainActor.run {
        guard token == RitmoPlayer.shared.artworkToken else { return }
        var current = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        current[MPMediaItemPropertyArtwork] = RitmoPlayer.makeArtwork(image)
        MPNowPlayingInfoCenter.default().nowPlayingInfo = current
      }
    }
  }

  /// Fora de qualquer actor: o MediaPlayer chama o bloco da capa numa fila de fundo.
  private nonisolated static func makeArtwork(_ image: UIImage) -> MPMediaItemArtwork {
    MPMediaItemArtwork(boundsSize: image.size) { _ in image }
  }

  private func updateNowPlayingTimes() {
    guard var info = MPNowPlayingInfoCenter.default().nowPlayingInfo else { return }
    info[MPMediaItemPropertyPlaybackDuration] = durationMs / 1000
    info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = positionMs / 1000
    info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? Double(speed) : 0
    info[MPNowPlayingInfoPropertyDefaultPlaybackRate] = 1.0
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
  }

  // MARK: - Progresso

  private func restartProgressTimer() {
    stopProgressTimer()
    guard playWhenReady else { return }
    let interval: TimeInterval = inForeground ? 0.5 : 10
    let timer = Timer(timeInterval: interval, repeats: true) { [weak self] _ in
      guard let self else { return }
      self.onProgress?(self.progress())
    }
    RunLoop.main.add(timer, forMode: .common)
    progressTimer = timer
    onProgress?(progress())
    saveTimer?.invalidate()
    let save = Timer(timeInterval: 15, repeats: true) { [weak self] _ in self?.saveState() }
    RunLoop.main.add(save, forMode: .common)
    saveTimer = save
  }

  private func stopProgressTimer() {
    progressTimer?.invalidate()
    progressTimer = nil
    saveTimer?.invalidate()
    saveTimer = nil
  }

  // MARK: - Timer para dormir (com fade-out nos últimos 20 s)

  func setSleepTimer(minutes: Double, endOfTrack: Bool) -> [String: Any] {
    cancelSleepTimer()
    if endOfTrack {
      sleepEndOfTrack = true
    } else if minutes > 0 {
      sleepAt = Date().addingTimeInterval(minutes * 60)
      let timer = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in self?.sleepTick() }
      RunLoop.main.add(timer, forMode: .common)
      sleepTimer = timer
    }
    return sleepState(fired: false)
  }

  func sleepState(fired: Bool) -> [String: Any] {
    let remaining = sleepAt.map { max(0, $0.timeIntervalSinceNow) * 1000 } ?? 0
    return ["active": sleepAt != nil || sleepEndOfTrack, "endOfTrack": sleepEndOfTrack, "remainingMs": remaining, "fired": fired]
  }

  private func cancelSleepTimer() {
    sleepTimer?.invalidate()
    sleepTimer = nil
    sleepAt = nil
    sleepEndOfTrack = false
    engine.mainMixerNode.outputVolume = 1
  }

  private func sleepTick() {
    guard let at = sleepAt else { return }
    let left = at.timeIntervalSinceNow
    if left <= 0 {
      pause()
      finishSleep()
    } else if left < Self.fadeSeconds {
      engine.mainMixerNode.outputVolume = Float(max(0.05, left / Self.fadeSeconds))
    }
  }

  private func finishSleep() {
    cancelSleepTimer()
    onSleepTimer?(sleepState(fired: true))
  }

  // MARK: - Fila salva (retomar ao abrir o app)

  private static let itemsKey = "ritmo.queue.items"
  private static let stateKey = "ritmo.queue.state"

  private struct SavedState: Codable {
    var index: Int
    var positionMs: Double
    var shuffle: Bool
    var repeatMode: String
    var speed: Float
  }

  /// Itens da pasta privada ("v:") não vão para a fila salva (próxima abertura, widget).
  private static func isPrivate(_ entry: QueueEntry) -> Bool { entry.id.hasPrefix("v:") }

  private func saveItems() {
    let kept = items.filter { !Self.isPrivate($0) }
    // Tocando só itens privados: mantém a última fila pública salva.
    if kept.isEmpty, !items.isEmpty { return }
    if let data = try? JSONEncoder().encode(kept) { UserDefaults.standard.set(data, forKey: Self.itemsKey) }
    saveState()
  }

  private func saveState() {
    // O índice salvo conta só os itens salvos (sem os da pasta privada).
    var kept = 0
    var keptIndex = 0
    for (i, entry) in items.enumerated() where !Self.isPrivate(entry) {
      if i <= index { keptIndex = kept }
      kept += 1
    }
    guard kept > 0 else {
      if items.isEmpty { UserDefaults.standard.removeObject(forKey: Self.stateKey) }
      return
    }
    let onPrivate = items.indices.contains(index) && Self.isPrivate(items[index])
    let state = SavedState(
      index: keptIndex, positionMs: onPrivate ? 0 : positionMs, shuffle: shuffle, repeatMode: repeatMode, speed: speed)
    if let data = try? JSONEncoder().encode(state) { UserDefaults.standard.set(data, forKey: Self.stateKey) }
  }

  /// Recarrega a última fila salva, se o player estiver vazio. Devolve true se restaurou.
  func restoreSavedQueue(play: Bool) -> Bool {
    guard items.isEmpty,
      let data = UserDefaults.standard.data(forKey: Self.itemsKey),
      let saved = try? JSONDecoder().decode([QueueEntry].self, from: data), !saved.isEmpty
    else { return false }
    let state = UserDefaults.standard.data(forKey: Self.stateKey).flatMap { try? JSONDecoder().decode(SavedState.self, from: $0) }
    shuffle = state?.shuffle ?? false
    repeatMode = state?.repeatMode ?? "off"
    setSpeed(state?.speed ?? 1)
    setQueue(saved, startIndex: state?.index ?? 0, positionMs: state?.positionMs ?? 0, play: play)
    return true
  }

  func clearSavedQueue() {
    UserDefaults.standard.removeObject(forKey: Self.itemsKey)
    UserDefaults.standard.removeObject(forKey: Self.stateKey)
  }

  // MARK: - Equalizador

  func equalizerInfo() -> [String: Any] { Equalizer.info(eq) }
}

/// Converte o item da fila numa URL que o AVAudioFile abre: arquivo importado direto; música do app Música
/// é copiada (sem recodificar) para o cache na primeira vez, porque o AVAudioFile não lê "ipod-library://".
enum MediaSource {
  static let errorDomain = "RitmoMediaSource"

  static func resolve(_ entry: QueueEntry, completion: @escaping (Result<URL, Error>) -> Void) {
    guard let url = LibraryStore.playableURL(id: entry.id, fallback: entry.uri) else {
      completion(.failure(NSError(domain: errorDomain, code: 1, userInfo: [NSLocalizedDescriptionKey: "Arquivo não encontrado"])))
      return
    }
    if url.isFileURL {
      if FileManager.default.fileExists(atPath: url.path) {
        completion(.success(url))
      } else {
        completion(.failure(NSError(domain: errorDomain, code: 2, userInfo: [NSLocalizedDescriptionKey: "Arquivo não encontrado"])))
      }
      return
    }
    exportLibraryItem(url, id: entry.id) { result in DispatchQueue.main.async { completion(result) } }
  }

  private static var exportDir: URL {
    let dir = LibraryStore.caches.appendingPathComponent("library-audio", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }

  private static func exportLibraryItem(_ url: URL, id: String, completion: @escaping (Result<URL, Error>) -> Void) {
    let base = exportDir.appendingPathComponent(LibraryStore.stableHash(id))
    for ext in ["m4a", "caf"] {
      let cached = base.appendingPathExtension(ext)
      if FileManager.default.fileExists(atPath: cached.path) {
        completion(.success(cached))
        return
      }
    }
    let asset = AVURLAsset(url: url)
    guard let exporter = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetPassthrough) else {
      completion(.failure(NSError(domain: "RitmoExport", code: 1, userInfo: [NSLocalizedDescriptionKey: "Não foi possível ler a música do app Música"])))
      return
    }
    let type: AVFileType = exporter.supportedFileTypes.contains(.m4a) ? .m4a : .caf
    let out = base.appendingPathExtension(type == .m4a ? "m4a" : "caf")
    let tmp = out.appendingPathExtension("part")
    try? FileManager.default.removeItem(at: tmp)
    exporter.outputURL = tmp
    exporter.outputFileType = type
    exporter.exportAsynchronously {
      if exporter.status == .completed {
        do {
          try? FileManager.default.removeItem(at: out)
          try FileManager.default.moveItem(at: tmp, to: out)
          completion(.success(out))
        } catch {
          completion(.failure(error))
        }
      } else {
        try? FileManager.default.removeItem(at: tmp)
        completion(.failure(exporter.error ?? NSError(domain: "RitmoExport", code: 2, userInfo: [NSLocalizedDescriptionKey: "Falha ao preparar a música"])))
      }
    }
  }

  /// Apaga as cópias do app Música que já não estão em nenhuma fila (chamado ao limpar o cache).
  static func clearCache() {
    try? FileManager.default.removeItem(at: exportDir)
  }
}

/// Capa do item da fila: arquivo escolhido pelo usuário ("file://") ou "ritmo-art://album/<id>?track=<uri>".
enum ArtworkSource {
  static func image(for entry: QueueEntry) async -> UIImage? {
    guard let raw = entry.artworkUri, let url = URL(string: raw) else {
      return await LibraryStore.artworkImage(forTrackUri: entry.uri, albumId: nil)
    }
    if url.isFileURL { return UIImage(contentsOfFile: url.path) }
    if url.scheme == "ritmo-art" {
      let albumId = url.lastPathComponent
      let track = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "track" }?.value
      return await LibraryStore.artworkImage(forTrackUri: track ?? entry.uri, albumId: albumId)
    }
    return nil
  }
}
