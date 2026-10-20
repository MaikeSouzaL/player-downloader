import AVFoundation
import ExpoModulesCore
import MediaPlayer

/// Item da fila vindo do JS.
struct TrackItemRecord: Record {
  @Field var id: String = ""
  @Field var uri: String = ""
  @Field var title: String = ""
  @Field var artist: String? = nil
  @Field var album: String? = nil
  @Field var artworkUri: String? = nil

  var entry: QueueEntry {
    QueueEntry(id: id, uri: uri, title: title, artist: artist, album: album, artworkUri: artworkUri)
  }
}

/**
 * Módulo nativo do Ritmo no iOS. Mesmas funções e eventos do módulo Kotlin do Android, para o JS ser um só;
 * o que não existe no iPhone (lixeira do sistema, toque de chamada) responde "não suportado".
 */
public class RitmoCoreModule: Module {
  private var libraryWatcher: DispatchSourceFileSystemObject?
  private var libraryChangeWork: DispatchWorkItem?
  private var mediaLibraryObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("RitmoCore")

    Events("onState", "onProgress", "onSleepTimer", "onIssue", "onLibraryChanged", "onShare", "onConvertProgress")

    OnCreate {
      // O mais cedo possível: qualquer exceção nativa daqui em diante vai para o relatório.
      CrashCatcher.install()
      DispatchQueue.main.async {
        let player = RitmoPlayer.shared
        player.onState = { [weak self] state in self?.sendEvent("onState", state) }
        player.onProgress = { [weak self] progress in self?.sendEvent("onProgress", progress) }
        player.onSleepTimer = { [weak self] state in self?.sendEvent("onSleepTimer", state) }
        player.onIssue = { [weak self] issue in self?.sendEvent("onIssue", issue) }
        self.startWatchingLibrary()
        // Downloads que terminaram com o app fechado chegam assim que a sessão volta.
        DownloadsIOS.shared.connect()
      }
    }

    OnDestroy {
      DispatchQueue.main.async {
        let player = RitmoPlayer.shared
        player.onState = nil
        player.onProgress = nil
        player.onSleepTimer = nil
        player.onIssue = nil
        self.stopWatchingLibrary()
      }
    }

    OnAppEntersBackground {
      DispatchQueue.main.async { RitmoPlayer.shared.inForeground = false }
    }

    OnAppEntersForeground {
      DispatchQueue.main.async { RitmoPlayer.shared.inForeground = true }
    }

    // MARK: Biblioteca

    AsyncFunction("queryAudio") { () async -> [[String: Any]] in
      await LibraryStore.audio()
    }

    AsyncFunction("queryVideos") { () async -> [[String: Any]] in
      await LibraryStore.videos()
    }

    AsyncFunction("getArtwork") { (albumId: String, trackUri: String?, size: Int) async -> String? in
      await LibraryStore.artwork(albumId: albumId, trackUri: trackUri, size: size)
    }

    AsyncFunction("getVideoThumbnail") { (videoId: String, size: Int) async -> String? in
      await LibraryStore.videoThumbnail(id: videoId, size: size)
    }

    AsyncFunction("clearArtworkCache") {
      LibraryStore.clearArtworkCache()
      MediaSource.clearCache()
    }

    AsyncFunction("readLyrics") { (path: String?, uri: String) async -> [String: Any]? in
      await LibraryStore.lyrics(path: path, uri: uri)
    }

    /// Acesso ao app Música (as músicas importadas não precisam de permissão).
    Function("mediaLibraryStatus") { () -> String in
      LibraryStore.mediaLibraryStatus()
    }

    AsyncFunction("requestMediaLibraryAccess") { () async -> String in
      await LibraryStore.requestMediaLibraryAccess()
    }

    /// Pasta onde as músicas importadas ficam (Documents), para o JS copiar arquivos escolhidos.
    Function("musicFolderUri") { () -> String in
      LibraryStore.documents.absoluteString
    }

    // O iPhone não tem lixeira do sistema para apps nem toque de chamada personalizado.
    AsyncFunction("queryTrashed") { () -> [[String: Any]] in [] }
    Function("supportsTrash") { false }
    AsyncFunction("trashTracks") { (_: [String], _: Bool) -> Bool in false }

    AsyncFunction("deleteTracks") { (ids: [String]) -> Bool in
      let ok = LibraryStore.delete(ids: ids)
      DispatchQueue.main.async { self.libraryChanged() }
      return ok
    }

    /// Apaga arquivos da pasta do app pela URL (file://). Itens do app Música não podem ser apagados.
    AsyncFunction("deleteUris") { (uris: [String]) -> Bool in
      let ok = uris.allSatisfy { MediaSaverIOS.deleteLocal($0, library: true) }
      DispatchQueue.main.async { self.libraryChanged() }
      return ok
    }

    /// Das URLs passadas, as que ainda existem (para desfazer só o que não foi apagado).
    AsyncFunction("existingUris") { (uris: [String]) -> [String] in
      uris.filter { uri in
        guard let url = URL(string: uri), url.isFileURL else { return true }
        return FileManager.default.fileExists(atPath: url.path)
      }
    }

    Function("canWriteSettings") { false }
    Function("openWriteSettings") {}
    AsyncFunction("setRingtone") { (_: String, _: String) -> Bool in false }

    Function("getOutputDevice") { () -> [String: Any] in
      let output = AVAudioSession.sharedInstance().currentRoute.outputs.first
      let bluetooth: [AVAudioSession.Port] = [.bluetoothA2DP, .bluetoothLE, .bluetoothHFP, .carAudio, .airPlay]
      let wired: [AVAudioSession.Port] = [.headphones, .usbAudio, .lineOut]
      let kind = output.map { bluetooth.contains($0.portType) ? "bluetooth" : wired.contains($0.portType) ? "wired" : "speaker" } ?? "speaker"
      return ["kind": kind, "name": output?.portName ?? NSNull()]
    }

    // MARK: Reprodução (sempre na thread principal)

    AsyncFunction("setQueue") { (items: [TrackItemRecord], startIndex: Int, startPositionMs: Double, play: Bool) in
      RitmoPlayer.shared.setQueue(items.map(\.entry), startIndex: startIndex, positionMs: startPositionMs, play: play)
    }.runOnQueue(DispatchQueue.main)

    AsyncFunction("addToQueue") { (items: [TrackItemRecord], playNext: Bool) in
      RitmoPlayer.shared.addToQueue(items.map(\.entry), playNext: playNext)
    }.runOnQueue(DispatchQueue.main)

    AsyncFunction("removeFromQueue") { (index: Int) in
      RitmoPlayer.shared.remove(at: index)
    }.runOnQueue(DispatchQueue.main)

    AsyncFunction("moveInQueue") { (from: Int, to: Int) in
      RitmoPlayer.shared.move(from: from, to: to)
    }.runOnQueue(DispatchQueue.main)

    AsyncFunction("play") { RitmoPlayer.shared.play() }.runOnQueue(DispatchQueue.main)
    AsyncFunction("pause") { RitmoPlayer.shared.pause() }.runOnQueue(DispatchQueue.main)

    AsyncFunction("seekTo") { (positionMs: Double) in
      RitmoPlayer.shared.seek(toMs: positionMs)
    }.runOnQueue(DispatchQueue.main)

    AsyncFunction("skipTo") { (index: Int) in
      RitmoPlayer.shared.skip(to: index)
    }.runOnQueue(DispatchQueue.main)

    AsyncFunction("next") { RitmoPlayer.shared.next() }.runOnQueue(DispatchQueue.main)
    AsyncFunction("previous") { RitmoPlayer.shared.previous() }.runOnQueue(DispatchQueue.main)

    AsyncFunction("setShuffle") { (enabled: Bool) in
      RitmoPlayer.shared.setShuffle(enabled)
    }.runOnQueue(DispatchQueue.main)

    AsyncFunction("setRepeat") { (mode: String) in
      RitmoPlayer.shared.setRepeat(mode)
    }.runOnQueue(DispatchQueue.main)

    AsyncFunction("setSpeed") { (speed: Double) in
      RitmoPlayer.shared.setSpeed(Float(speed))
    }.runOnQueue(DispatchQueue.main)

    AsyncFunction("getState") { () -> [String: Any]? in
      RitmoPlayer.shared.items.isEmpty ? nil : RitmoPlayer.shared.snapshot()
    }.runOnQueue(DispatchQueue.main)

    AsyncFunction("getQueue") { () -> [String: Any] in
      RitmoPlayer.shared.queueInfo()
    }.runOnQueue(DispatchQueue.main)

    // MARK: Equalizador

    AsyncFunction("getEqualizer") { () -> [String: Any] in
      RitmoPlayer.shared.equalizerInfo()
    }.runOnQueue(DispatchQueue.main)

    AsyncFunction("setEqualizerEnabled") { (enabled: Bool) -> [String: Any] in
      Equalizer.setEnabled(RitmoPlayer.shared.eq, enabled)
      return RitmoPlayer.shared.equalizerInfo()
    }.runOnQueue(DispatchQueue.main)

    AsyncFunction("setEqualizerBand") { (band: Int, level: Int) -> [String: Any] in
      Equalizer.setBand(RitmoPlayer.shared.eq, band: band, level: level)
      return RitmoPlayer.shared.equalizerInfo()
    }.runOnQueue(DispatchQueue.main)

    AsyncFunction("applyEqualizerPreset") { (preset: Int) -> [String: Any] in
      Equalizer.usePreset(RitmoPlayer.shared.eq, preset)
      return RitmoPlayer.shared.equalizerInfo()
    }.runOnQueue(DispatchQueue.main)

    AsyncFunction("setBassBoost") { (strength: Int) -> [String: Any] in
      Equalizer.setBass(RitmoPlayer.shared.eq, strength)
      return RitmoPlayer.shared.equalizerInfo()
    }.runOnQueue(DispatchQueue.main)

    AsyncFunction("setLoudness") { (gainMb: Int) -> [String: Any] in
      Equalizer.setLoudness(RitmoPlayer.shared.eq, gainMb)
      return RitmoPlayer.shared.equalizerInfo()
    }.runOnQueue(DispatchQueue.main)

    AsyncFunction("restoreEqualizer") { (enabled: Bool, levels: [Int]?, preset: Int, bass: Int, loudness: Int) -> [String: Any] in
      Equalizer.restore(RitmoPlayer.shared.eq, enabled: enabled, levels: levels, preset: preset, bass: bass, loudness: loudness)
      return RitmoPlayer.shared.equalizerInfo()
    }.runOnQueue(DispatchQueue.main)

    // MARK: Timer, fila salva e CarPlay

    AsyncFunction("setSleepTimer") { (minutes: Double, endOfTrack: Bool) -> [String: Any] in
      RitmoPlayer.shared.setSleepTimer(minutes: minutes, endOfTrack: endOfTrack)
    }.runOnQueue(DispatchQueue.main)

    AsyncFunction("getSleepTimer") { () -> [String: Any] in
      RitmoPlayer.shared.sleepState(fired: false)
    }.runOnQueue(DispatchQueue.main)

    AsyncFunction("restoreSavedQueue") { (play: Bool) -> Bool in
      RitmoPlayer.shared.restoreSavedQueue(play: play)
    }.runOnQueue(DispatchQueue.main)

    AsyncFunction("clearSavedQueue") {
      RitmoPlayer.shared.clearSavedQueue()
    }.runOnQueue(DispatchQueue.main)

    // MARK: Compartilhar, converter, baixar e pasta privada (mesmas funções do Android)

    /// No iPhone o "Abrir com / Copiar para o Ritmo" chega como URL pelo expo-router (+native-intent).
    /// Crash nativo da última vez que o app abriu (ou nil). Lê uma vez só.
    Function("takeLastCrash") { () -> String? in CrashCatcher.take() }

    /// Link que a extensão "Compartilhar" guardou quando não conseguiu abrir o Ritmo (lê uma vez só).
    Function("getPendingShare") { () -> [String: Any]? in
      guard let group = Bundle.main.object(forInfoDictionaryKey: "RitmoAppGroup") as? String,
        let defaults = UserDefaults(suiteName: group),
        let link = defaults.string(forKey: "ritmo.pendingShare"), !link.isEmpty
      else { return nil }
      defaults.removeObject(forKey: "ritmo.pendingShare")
      return ["text": link, "subject": NSNull(), "items": [[String: Any]]()]
    }

    AsyncFunction("saveToLibrary") { (uri: String, name: String, _: String?, kind: String) -> String in
      let saved = try MediaSaverIOS.save(sourceUri: uri, name: name, kind: kind)
      DispatchQueue.main.async { self.libraryChanged() }
      return saved
    }

    AsyncFunction("convertToAudio") { (jobId: String, uri: String, name: String, bitrateKbps: Int) async throws -> String in
      let saved = try await AudioConverterIOS.convert(jobId: jobId, sourceUri: uri, name: name, bitrateKbps: bitrateKbps) { [weak self] percent in
        self?.sendEvent("onConvertProgress", ["jobId": jobId, "progress": percent])
      }
      await MainActor.run { self.libraryChanged() }
      return saved
    }

    Function("cancelConversion") { (jobId: String) in AudioConverterIOS.cancel(jobId) }

    Function("startDownload") { (url: String, fileName: String, mime: String?, _: String) throws -> String in
      try DownloadsIOS.shared.start(url: url, fileName: fileName, mime: mime)
    }

    Function("queryDownloads") { (ids: [String]) -> [[String: Any]] in
      DownloadsIOS.shared.query(ids)
    }

    Function("cancelDownload") { (id: String) in DownloadsIOS.shared.cancel(id) }

    Function("deleteLocalFile") { (uri: String) -> Bool in MediaSaverIOS.deleteLocal(uri) }

    AsyncFunction("vaultAdd") { (uri: String, meta: [String: Any]) throws -> [String: Any] in
      try VaultIOS.add(sourceUri: uri, meta: meta)
    }

    AsyncFunction("vaultList") { () throws -> [[String: Any]] in try VaultIOS.list() }

    AsyncFunction("vaultRestore") { (id: String) throws -> String in
      let saved = try VaultIOS.restore(id: id)
      DispatchQueue.main.async { self.libraryChanged() }
      return saved
    }

    AsyncFunction("vaultDelete") { (id: String) throws in try VaultIOS.delete(id: id) }

    AsyncFunction("vaultWipe") { () throws in try VaultIOS.wipe() }

    /// Playlists, curtidas, recentes, filtros e textos para o CarPlay (mesmo JSON do Android Auto).
    AsyncFunction("setBrowseData") { (json: String) in
      try BrowseCatalog.save(json: json)
      DispatchQueue.main.async { CarPlayController.shared.reload() }
    }
  }

  // MARK: - Biblioteca ao vivo

  /// Avisa o JS quando arquivos entram ou saem da pasta do app (Arquivos, Finder) ou o app Música muda.
  private func startWatchingLibrary() {
    stopWatchingLibrary()
    let fd = open(LibraryStore.documents.path, O_EVTONLY)
    if fd >= 0 {
      let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: [.write, .rename, .delete, .extend], queue: .main)
      source.setEventHandler { [weak self] in self?.libraryChanged() }
      source.setCancelHandler { close(fd) }
      source.resume()
      libraryWatcher = source
    }
    if MPMediaLibrary.authorizationStatus() == .authorized {
      MPMediaLibrary.default().beginGeneratingLibraryChangeNotifications()
    }
    mediaLibraryObserver = NotificationCenter.default.addObserver(forName: .MPMediaLibraryDidChange, object: nil, queue: .main) { [weak self] _ in
      self?.libraryChanged()
    }
  }

  private func stopWatchingLibrary() {
    libraryWatcher?.cancel()
    libraryWatcher = nil
    if let mediaLibraryObserver { NotificationCenter.default.removeObserver(mediaLibraryObserver) }
    mediaLibraryObserver = nil
  }

  /// Espera 2 s sem mudanças (cópias grandes geram muitos eventos) antes de avisar.
  private func libraryChanged() {
    libraryChangeWork?.cancel()
    let work = DispatchWorkItem { [weak self] in self?.sendEvent("onLibraryChanged", [:]) }
    libraryChangeWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: work)
  }
}
