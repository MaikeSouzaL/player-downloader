import AVFoundation
import ExpoModulesCore
import Foundation
import UIKit

/// Erro com mensagem amigável e o mesmo código do Android (ex.: ERR_CANCELLED), que chega ao JS.
/// Precisa ser um `Exception` do Expo: outros erros viram ERR_UNEXPECTED no caminho.
final class ToolError: Exception, @unchecked Sendable {
  init(_ message: String, code: String = "ERR_TOOL") {
    super.init(name: "ToolError", description: message, code: code)
  }
}

// MARK: - Salvar na biblioteca

/**
 * No iPhone a "biblioteca" é a pasta do app (Documents, visível em Arquivos › No meu iPhone › Player Downloader):
 * áudio vai para "Músicas" e vídeo para "Vídeos". Aceita arquivos abertos "no lugar" pelo app Arquivos
 * (URL com escopo de segurança) e move o que veio pela caixa de entrada (Documents/Inbox).
 */
enum MediaSaverIOS {
  static func save(sourceUri: String, name: String, kind: String) throws -> String {
    guard let source = URL(string: sourceUri), source.isFileURL else { throw ToolError("Arquivo inválido") }
    let folder = LibraryStore.documents.appendingPathComponent(kind == "video" ? "Vídeos" : "Músicas", isDirectory: true)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let target = uniqueURL(in: folder, name: sanitize(name.isEmpty ? source.lastPathComponent : name))
    let scoped = source.startAccessingSecurityScopedResource()
    defer { if scoped { source.stopAccessingSecurityScopedResource() } }
    if isTemporary(source) {
      try FileManager.default.moveItem(at: source, to: target)
    } else {
      try FileManager.default.copyItem(at: source, to: target)
    }
    return target.absoluteString
  }

  /// Caminho comparável: o iOS usa /private/var e /var para o mesmo lugar.
  static func canonical(_ url: URL) -> String { url.resolvingSymlinksInPath().standardizedFileURL.path }

  private static func isInside(_ url: URL, _ roots: [URL]) -> Bool {
    let path = canonical(url)
    return roots.contains { path.hasPrefix(canonical($0) + "/") }
  }

  /// Caixa de entrada (Documents/Inbox), cache ou temporários: o arquivo já é uma cópia do app e pode ser movido.
  static func isTemporary(_ url: URL) -> Bool {
    isInside(url, [LibraryStore.documents.appendingPathComponent("Inbox", isDirectory: true), LibraryStore.caches, FileManager.default.temporaryDirectory])
  }

  static func sanitize(_ name: String) -> String {
    let bad = CharacterSet(charactersIn: "\\/:*?\"<>|").union(.controlCharacters)
    let clean = name.components(separatedBy: bad).joined(separator: "_")
      .trimmingCharacters(in: CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: ".")))
    return clean.isEmpty ? "arquivo" : String(clean.prefix(120))
  }

  static func uniqueURL(in dir: URL, name: String) -> URL {
    var url = dir.appendingPathComponent(name)
    let base = (name as NSString).deletingPathExtension
    let ext = (name as NSString).pathExtension
    var i = 2
    while FileManager.default.fileExists(atPath: url.path) {
      url = dir.appendingPathComponent(ext.isEmpty ? "\(base) (\(i))" : "\(base) (\(i)).\(ext)")
      i += 1
    }
    return url
  }

  /// Apaga um arquivo do app. Sem `library`, só temporários (cache e tmp); com ele, também a biblioteca
  /// (Documents), para excluir músicas e vídeos. A pasta privada (Application Support) nunca.
  static func deleteLocal(_ uri: String, library: Bool = false) -> Bool {
    guard let url = URL(string: uri), url.isFileURL else { return false }
    var roots = [LibraryStore.caches, FileManager.default.temporaryDirectory]
    if library { roots.append(LibraryStore.documents) }
    guard isInside(url, roots) else { return false }
    return (try? FileManager.default.removeItem(at: url)) != nil
  }
}

// MARK: - Converter vídeo em áudio

/**
 * Vídeo (ou áudio) → AAC/M4A. "Original" (0) usa o preset do sistema (AAC de alta qualidade);
 * 96/128/192/256 kbps recodifica com AVAssetReader + AVAssetWriter nessa qualidade.
 * O resultado vai para Documents/Músicas.
 */
final class AudioConverterIOS {
  private static var jobs: [String: AudioConverterIOS] = [:]
  private static let lock = NSLock()

  private var cancelled = false
  private var export: AVAssetExportSession?
  private var reader: AVAssetReader?

  static func cancel(_ id: String) {
    lock.lock()
    let job = jobs[id]
    lock.unlock()
    job?.cancelled = true
    job?.export?.cancelExport()
    job?.reader?.cancelReading()
  }

  static func convert(jobId: String, sourceUri: String, name: String, bitrateKbps: Int, progress: @escaping (Int) -> Void) async throws -> String {
    guard let source = URL(string: sourceUri) else { throw ToolError("Arquivo inválido") }
    let job = AudioConverterIOS()
    lock.lock()
    jobs[jobId] = job
    lock.unlock()
    defer {
      lock.lock()
      jobs[jobId] = nil
      lock.unlock()
    }
    let scoped = source.startAccessingSecurityScopedResource()
    defer { if scoped { source.stopAccessingSecurityScopedResource() } }

    let tmpDir = LibraryStore.caches.appendingPathComponent("convert", isDirectory: true)
    try FileManager.default.createDirectory(at: tmpDir, withIntermediateDirectories: true)
    let output = tmpDir.appendingPathComponent("\(jobId).m4a")
    try? FileManager.default.removeItem(at: output)
    defer { try? FileManager.default.removeItem(at: output) }

    let asset = AVURLAsset(url: source)
    let audioTracks = try await asset.loadTracks(withMediaType: .audio)
    guard !audioTracks.isEmpty else { throw ToolError("O arquivo não tem áudio", code: "ERR_NO_AUDIO") }
    if bitrateKbps <= 0 {
      try await job.exportPreset(asset: asset, output: output, progress: progress)
    } else {
      try await job.transcode(asset: asset, output: output, bitrate: bitrateKbps * 1000, progress: progress)
    }
    if job.cancelled { throw ToolError("Conversão cancelada", code: "ERR_CANCELLED") }
    let finalName = (name as NSString).deletingPathExtension + ".m4a"
    return try MediaSaverIOS.save(sourceUri: output.absoluteString, name: finalName, kind: "audio")
  }

  private func exportPreset(asset: AVURLAsset, output: URL, progress: @escaping (Int) -> Void) async throws {
    guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
      throw ToolError("Este arquivo não pode ser convertido")
    }
    export = session
    session.outputURL = output
    session.outputFileType = .m4a
    let timer = DispatchSource.makeTimerSource(queue: .main)
    timer.schedule(deadline: .now() + 0.5, repeating: 0.5)
    timer.setEventHandler { progress(min(99, Int(session.progress * 100))) }
    timer.resume()
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      session.exportAsynchronously { continuation.resume() }
    }
    timer.cancel()
    if cancelled { throw ToolError("Conversão cancelada", code: "ERR_CANCELLED") }
    guard session.status == .completed else { throw session.error ?? ToolError("Falha ao converter") }
  }

  private func transcode(asset: AVURLAsset, output: URL, bitrate: Int, progress: @escaping (Int) -> Void) async throws {
    guard let track = try await asset.loadTracks(withMediaType: .audio).first else { throw ToolError("O arquivo não tem áudio") }
    let duration = CMTimeGetSeconds(try await asset.load(.duration))
    var sourceRate = 44_100.0
    var channels = 2
    if let desc = try await track.load(.formatDescriptions).first,
      let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(desc)?.pointee
    {
      sourceRate = asbd.mSampleRate
      // Mono continua mono; 5.1 e outros viram estéreo.
      channels = asbd.mChannelsPerFrame == 1 ? 1 : 2
    }
    // O AAC grava com segurança em 44,1 ou 48 kHz em qualquer qualidade; o leitor converte o resto (8, 22, 96 kHz…).
    let sampleRate = sourceRate == 48_000 ? 48_000.0 : 44_100.0
    var layout = AudioChannelLayout()
    layout.mChannelLayoutTag = channels == 1 ? kAudioChannelLayoutTag_Mono : kAudioChannelLayoutTag_Stereo
    let layoutData = withUnsafeBytes(of: layout) { Data($0) }

    let reader = try AVAssetReader(asset: asset)
    self.reader = reader
    let pcm: [String: Any] = [
      AVFormatIDKey: kAudioFormatLinearPCM,
      AVLinearPCMBitDepthKey: 16,
      AVLinearPCMIsFloatKey: false,
      AVLinearPCMIsBigEndianKey: false,
      AVLinearPCMIsNonInterleaved: false,
      AVSampleRateKey: sampleRate,
      AVNumberOfChannelsKey: channels,
      AVChannelLayoutKey: layoutData,
    ]
    // A saída "mix" faz a redução de canais (5.1 → estéreo) que a saída por faixa recusa.
    let readerOutput = AVAssetReaderAudioMixOutput(audioTracks: [track], audioSettings: pcm)
    readerOutput.alwaysCopiesSampleData = false
    guard reader.canAdd(readerOutput) else { throw ToolError("Não foi possível ler o áudio") }
    reader.add(readerOutput)

    let writer = try AVAssetWriter(outputURL: output, fileType: .m4a)
    let aac: [String: Any] = [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: sampleRate,
      AVNumberOfChannelsKey: channels,
      AVChannelLayoutKey: layoutData,
      AVEncoderBitRateKey: channels == 1 ? min(bitrate, 160_000) : bitrate,
    ]
    let input = AVAssetWriterInput(mediaType: .audio, outputSettings: aac)
    input.expectsMediaDataInRealTime = false
    guard writer.canAdd(input) else { throw ToolError("Não foi possível criar o arquivo de áudio") }
    writer.add(input)

    guard reader.startReading() else { throw reader.error ?? ToolError("Não foi possível ler o áudio") }
    guard writer.startWriting() else { throw writer.error ?? ToolError("Não foi possível gravar o áudio") }
    writer.startSession(atSourceTime: .zero)

    let queue = DispatchQueue(label: "ritmo.convert")
    // Estado mutável numa classe: o bloco do AVAssetWriterInput pode ser @Sendable nos SDKs novos.
    final class Pump {
      var finished = false
      var lastPercent = -1
    }
    let pump = Pump()
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      input.requestMediaDataWhenReady(on: queue) { [weak self] in
        guard !pump.finished else { return }
        let stop: (Bool) -> Void = { cancelReader in
          pump.finished = true
          if cancelReader { reader.cancelReading() }
          input.markAsFinished()
          continuation.resume()
        }
        while input.isReadyForMoreMediaData {
          if self?.cancelled == true || reader.status != .reading {
            stop(false)
            return
          }
          guard let buffer = readerOutput.copyNextSampleBuffer() else {
            stop(false)
            return
          }
          if !input.append(buffer) {
            stop(true)
            return
          }
          // Duração ou tempo indefinidos (NaN) derrubariam o Int(…).
          let seconds = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(buffer))
          if duration.isFinite, duration > 0, seconds.isFinite {
            let percent = min(99, max(0, Int(seconds / duration * 100)))
            if percent != pump.lastPercent {
              pump.lastPercent = percent
              DispatchQueue.main.async { progress(percent) }
            }
          }
        }
      }
    }
    if cancelled {
      writer.cancelWriting()
      throw ToolError("Conversão cancelada", code: "ERR_CANCELLED")
    }
    await writer.finishWriting()
    if reader.status == .failed { throw reader.error ?? ToolError("Falha ao ler o áudio") }
    guard writer.status == .completed else { throw writer.error ?? ToolError("Falha ao gravar o áudio") }
  }
}

// MARK: - Downloads

/**
 * Downloads de links diretos numa URLSession de segundo plano: o iOS continua baixando com o app fechado
 * (menos quando o usuário fecha o app à força). A lista fica salva no UserDefaults e sobrevive a reabrir o app.
 * Os arquivos ficam em Caches/downloads/<id>/ até o JS salvar na biblioteca ou converter.
 */
final class DownloadsIOS: NSObject, URLSessionDownloadDelegate {
  static let shared = DownloadsIOS()
  static let sessionIdentifier = "com.ritmo.player.downloads"
  private static let storeKey = "ritmo.downloads"

  private struct Item: Codable {
    var name: String
    var mime: String?
    var status = "pending"
    var bytes: Int64 = 0
    var total: Int64 = -1
    /// Caminho dentro de Caches/downloads (o caminho do app pode mudar entre aberturas).
    var file: String?
    var reason = 0
  }

  private var items: [String: Item] = [:]
  private let lock = NSLock()
  /// Criada no init (o `shared` é criado uma vez só, de forma segura entre threads).
  private var session: URLSession!

  private static var folder: URL { LibraryStore.caches.appendingPathComponent("downloads", isDirectory: true) }

  private override init() {
    super.init()
    if let data = UserDefaults.standard.data(forKey: Self.storeKey),
      let saved = try? JSONDecoder().decode([String: Item].self, from: data)
    {
      items = saved
    }
    let config = URLSessionConfiguration.background(withIdentifier: Self.sessionIdentifier)
    // Sem acordar o app em segundo plano: o iOS baixa sozinho e entrega tudo quando o app abre de novo.
    // (Acordar o app travaria no handler do expo-file-system, que segura o aviso de qualquer sessão.)
    config.sessionSendsLaunchEvents = false
    config.isDiscretionary = false
    session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
  }

  /// Liga a sessão: recebe o que terminou enquanto o app estava fechado.
  func connect() {
    _ = session
  }

  /// Quem chama segura o lock.
  private func persistLocked() {
    if let data = try? JSONEncoder().encode(items) { UserDefaults.standard.set(data, forKey: Self.storeKey) }
  }

  func start(url: String, fileName: String, mime: String?) throws -> String {
    guard let remote = URL(string: url), let scheme = remote.scheme?.lowercased(), scheme == "https" || scheme == "http" else {
      throw ToolError("Link inválido")
    }
    var request = URLRequest(url: remote)
    request.setValue("PlayerDownloader/1.5 (iOS)", forHTTPHeaderField: "User-Agent")
    let task = session.downloadTask(with: request)
    let id = UUID().uuidString
    task.taskDescription = id
    lock.lock()
    items[id] = Item(name: MediaSaverIOS.sanitize(fileName), mime: mime)
    persistLocked()
    lock.unlock()
    task.resume()
    return id
  }

  func query(_ ids: [String]) -> [[String: Any]] {
    lock.lock()
    defer { lock.unlock() }
    return ids.compactMap { id in
      guard let item = items[id] else { return nil }
      return [
        "id": id,
        "status": item.status,
        "bytes": Double(item.bytes),
        "total": Double(item.total),
        "reason": item.reason,
        "localUri": item.file.map { Self.folder.appendingPathComponent($0).absoluteString } ?? NSNull(),
        "mime": item.mime ?? NSNull(),
      ]
    }
  }

  /// Cancela (se ainda estiver baixando), tira da lista e apaga a pasta do download.
  func cancel(_ id: String) {
    lock.lock()
    let known = items.removeValue(forKey: id) != nil
    persistLocked()
    lock.unlock()
    guard known else { return }
    try? FileManager.default.removeItem(at: Self.folder.appendingPathComponent(id, isDirectory: true))
    session.getAllTasks { tasks in
      tasks.first { $0.taskDescription == id }?.cancel()
    }
  }

  private func lookup(_ task: URLSessionTask) -> Item? {
    guard let id = task.taskDescription else { return nil }
    lock.lock()
    defer { lock.unlock() }
    return items[id]
  }

  private func update(_ task: URLSessionTask, persist: Bool = true, _ change: (inout Item) -> Void) {
    guard let id = task.taskDescription else { return }
    lock.lock()
    if var item = items[id] {
      change(&item)
      items[id] = item
      if persist { persistLocked() }
    }
    lock.unlock()
  }

  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
    update(downloadTask, persist: false) { item in
      item.status = "running"
      item.bytes = totalBytesWritten
      item.total = totalBytesExpectedToWrite
    }
  }

  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
    // Download que saiu da lista (cancelado ou removido): o iOS apaga o temporário sozinho.
    guard let id = downloadTask.taskDescription, let item = lookup(downloadTask) else { return }
    let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 200
    do {
      guard (200..<300).contains(status) else { throw ToolError("HTTP \(status)") }
      // O temporário some quando este método retorna: move já, para uma pasta só deste download.
      let dir = Self.folder.appendingPathComponent(id, isDirectory: true)
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      let target = dir.appendingPathComponent(item.name)
      guard target.standardizedFileURL.deletingLastPathComponent().path == dir.standardizedFileURL.path else {
        throw ToolError("Nome de arquivo inválido")
      }
      try? FileManager.default.removeItem(at: target)
      try FileManager.default.moveItem(at: location, to: target)
      update(downloadTask) { item in
        item.status = "done"
        item.file = "\(id)/\(target.lastPathComponent)"
        if let mime = downloadTask.response?.mimeType, item.mime == nil { item.mime = mime }
        if item.total <= 0 { item.total = item.bytes }
      }
    } catch {
      update(downloadTask) { item in
        item.status = "failed"
        item.reason = status
      }
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard let error else { return }
    update(task) { item in
      if item.status != "done" {
        item.status = "failed"
        item.reason = (error as NSError).code
      }
    }
  }
}

// MARK: - Pasta privada

/**
 * Pasta privada do iPhone: Application Support/RitmoVault (fora do app Arquivos e da biblioteca).
 * O PIN / Face ID fica no JS. Não é criptografia: esconde, não protege de quem tem o aparelho desbloqueado.
 */
enum VaultIOS {
  private static let dir: URL = {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    var url = base.appendingPathComponent("RitmoVault", isDirectory: true)
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    // Fora do backup do iCloud e do computador: a pasta privada fica só neste aparelho.
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? url.setResourceValues(values)
    return url
  }()

  private static var indexURL: URL { dir.appendingPathComponent("index.json") }
  private static let lock = NSLock()

  /// Índice ilegível é erro (não vira lista vazia, senão a próxima gravação apagaria tudo).
  private static func read() throws -> [[String: Any]] {
    guard FileManager.default.fileExists(atPath: indexURL.path) else { return [] }
    let data = try Data(contentsOf: indexURL)
    guard let list = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else {
      throw ToolError("Índice da pasta privada ilegível", code: "ERR_VAULT_INDEX")
    }
    return list
  }

  private static func write(_ items: [[String: Any]]) throws {
    let data = try JSONSerialization.data(withJSONObject: items)
    try data.write(to: indexURL, options: .atomic)
  }

  private static func present(_ item: [String: Any]) -> [String: Any] {
    var out = item
    if let file = item["file"] as? String { out["uri"] = dir.appendingPathComponent(file).absoluteString }
    out["file"] = nil
    return out
  }

  static func add(sourceUri: String, meta: [String: Any]) throws -> [String: Any] {
    guard let source = URL(string: sourceUri), source.isFileURL else {
      throw ToolError("Músicas do app Música não podem ir para a pasta privada", code: "ERR_NOT_FILE")
    }
    // Confere o índice antes de copiar (não copia um arquivo grande à toa).
    lock.lock()
    do {
      _ = try read()
    } catch {
      lock.unlock()
      throw error
    }
    lock.unlock()
    let scoped = source.startAccessingSecurityScopedResource()
    defer { if scoped { source.stopAccessingSecurityScopedResource() } }
    let id = UUID().uuidString
    let name = MediaSaverIOS.sanitize(meta["name"] as? String ?? source.lastPathComponent)
    // NaN/infinito derrubaria o JSONSerialization.
    let rawDuration = (meta["duration"] as? NSNumber)?.doubleValue ?? 0
    let duration = rawDuration.isFinite ? rawDuration : 0
    let ext = (name as NSString).pathExtension
    let file = ext.isEmpty ? id : "\(id).\(ext)"
    let target = dir.appendingPathComponent(file)
    // O que veio pela caixa de entrada (ou do cache) é uma cópia do app: move, para não sobrar no app Arquivos.
    let moved = MediaSaverIOS.isTemporary(source)
    if moved {
      try FileManager.default.moveItem(at: source, to: target)
    } else {
      try FileManager.default.copyItem(at: source, to: target)
    }
    let size = (try? FileManager.default.attributesOfItem(atPath: target.path)[.size] as? NSNumber)?.doubleValue ?? 0
    let item: [String: Any] = [
      "id": id,
      "file": file,
      "name": name,
      "title": meta["title"] as? String ?? (name as NSString).deletingPathExtension,
      "artist": meta["artist"] as? String ?? NSNull(),
      "album": meta["album"] as? String ?? NSNull(),
      "duration": duration,
      "kind": (meta["kind"] as? String) == "video" ? "video" : "audio",
      "mime": meta["mime"] as? String ?? NSNull(),
      "size": size,
      "addedAt": Date().timeIntervalSince1970 * 1000,
    ]
    lock.lock()
    defer { lock.unlock() }
    do {
      var items = try read()
      items.append(item)
      try write(items)
    } catch {
      // Sem índice o arquivo ficaria perdido: devolve ao lugar de origem (ou apaga a cópia).
      if moved {
        try? FileManager.default.moveItem(at: target, to: source)
      } else {
        try? FileManager.default.removeItem(at: target)
      }
      throw error
    }
    return present(item)
  }

  static func list() throws -> [[String: Any]] {
    lock.lock()
    defer { lock.unlock() }
    return try read().map(present)
  }

  static func restore(id: String) throws -> String {
    lock.lock()
    defer { lock.unlock() }
    var items = try read()
    guard let index = items.firstIndex(where: { $0["id"] as? String == id }), let file = items[index]["file"] as? String else {
      throw ToolError("Item não encontrado")
    }
    let source = dir.appendingPathComponent(file)
    let kind = items[index]["kind"] as? String ?? "audio"
    let name = items[index]["name"] as? String ?? file
    let folder = LibraryStore.documents.appendingPathComponent(kind == "video" ? "Vídeos" : "Músicas", isDirectory: true)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let target = MediaSaverIOS.uniqueURL(in: folder, name: name)
    try FileManager.default.moveItem(at: source, to: target)
    items.remove(at: index)
    do {
      try write(items)
    } catch {
      // Sem atualizar o índice, o item ficaria fantasma: o arquivo volta para a pasta privada.
      try? FileManager.default.moveItem(at: target, to: source)
      throw error
    }
    return target.absoluteString
  }

  static func delete(id: String) throws {
    lock.lock()
    defer { lock.unlock() }
    var items = try read()
    guard let index = items.firstIndex(where: { $0["id"] as? String == id }) else { return }
    if let file = items[index]["file"] as? String { try? FileManager.default.removeItem(at: dir.appendingPathComponent(file)) }
    items.remove(at: index)
    try write(items)
  }

  /// "Esqueci o PIN": apaga tudo, inclusive um índice ilegível.
  static func wipe() throws {
    lock.lock()
    defer { lock.unlock() }
    for url in try FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) {
      try FileManager.default.removeItem(at: url)
    }
  }
}
