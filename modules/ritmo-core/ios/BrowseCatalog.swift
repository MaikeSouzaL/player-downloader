import Foundation

/**
 * Dados para navegar sem o JS (CarPlay): a lista de músicas da última varredura (salva em cache) e o que o
 * app manda em `setBrowseData` — playlists, curtidas, recentes, filtros, informações editadas e textos.
 * Mesmo formato do Android Auto.
 */
enum BrowseCatalog {
  struct Track: Codable {
    var id: String
    var uri: String
    var title: String
    var artist: String?
    var album: String?
    var albumId: String
    var artistId: String
    var trackNumber: Int
    var folder: String?
    var durationMs: Double
  }

  struct Playlist {
    var id: String
    var name: String
    var trackIds: [String]
  }

  struct Info {
    var labels: [String: String]
    var playlists: [Playlist]
    var liked: [String]
    var recent: [String]
    var hiddenFolders: Set<String>
    var hiddenTracks: Set<String>
    var minDurationMs: Double
    var edits: [String: [String: String]]
  }

  static let defaultLabels = [
    "home": "Início",
    "recent": "Recentes",
    "liked": "Curtidas",
    "playlists": "Playlists",
    "albums": "Álbuns",
    "artists": "Artistas",
    "shuffle": "Tocar tudo no aleatório",
    "unknownArtist": "Artista desconhecido",
    "unknownAlbum": "Álbum desconhecido",
  ]

  private static let dataKey = "ritmo.browse"
  private static var tracksFile: URL { LibraryStore.caches.appendingPathComponent("ritmo-browse-tracks.json") }
  private static var cachedTracks: [Track]?
  private static var cachedData: Info?
  private static let lock = NSLock()

  /// Chamado depois de cada varredura da biblioteca.
  static func updateTracks(_ dicts: [[String: Any]]) {
    let list: [Track] = dicts.compactMap { d in
      guard let id = d["id"] as? String, let uri = d["uri"] as? String else { return nil }
      return Track(
        id: id,
        uri: uri,
        title: d["title"] as? String ?? id,
        artist: d["artist"] as? String,
        album: d["album"] as? String,
        albumId: d["albumId"] as? String ?? "0",
        artistId: d["artistId"] as? String ?? "0",
        trackNumber: d["track"] as? Int ?? 0,
        folder: d["folder"] as? String,
        durationMs: d["duration"] as? Double ?? 0
      )
    }
    lock.lock()
    cachedTracks = list
    lock.unlock()
    if let encoded = try? JSONEncoder().encode(list) { try? encoded.write(to: tracksFile, options: .atomic) }
  }

  static func save(json: String) throws {
    guard let raw = json.data(using: .utf8), (try JSONSerialization.jsonObject(with: raw)) is [String: Any] else {
      throw NSError(domain: "RitmoBrowse", code: 1, userInfo: [NSLocalizedDescriptionKey: "JSON inválido"])
    }
    UserDefaults.standard.set(json, forKey: dataKey)
    lock.lock()
    cachedData = nil
    lock.unlock()
  }

  static func data() -> Info {
    lock.lock()
    defer { lock.unlock() }
    if let cachedData { return cachedData }
    var parsed = Info(labels: defaultLabels, playlists: [], liked: [], recent: [], hiddenFolders: [], hiddenTracks: [], minDurationMs: 30_000, edits: [:])
    if let json = UserDefaults.standard.string(forKey: dataKey), let raw = json.data(using: .utf8),
      let o = (try? JSONSerialization.jsonObject(with: raw)) as? [String: Any]
    {
      if let labels = o["labels"] as? [String: String] {
        for (k, v) in labels where !v.isEmpty { parsed.labels[k] = v }
      }
      parsed.playlists = (o["playlists"] as? [[String: Any]] ?? []).compactMap { p in
        guard let id = p["id"] as? String else { return nil }
        return Playlist(id: id, name: p["name"] as? String ?? id, trackIds: p["trackIds"] as? [String] ?? [])
      }
      parsed.liked = o["liked"] as? [String] ?? []
      parsed.recent = Array((o["recent"] as? [String] ?? []).prefix(100))
      parsed.hiddenFolders = Set(o["hiddenFolders"] as? [String] ?? [])
      parsed.hiddenTracks = Set(o["hiddenTracks"] as? [String] ?? [])
      parsed.minDurationMs = o["minDurationMs"] as? Double ?? 30_000
      parsed.edits = o["edits"] as? [String: [String: String]] ?? [:]
    }
    cachedData = parsed
    return parsed
  }

  /// Músicas visíveis (sem as ocultas e curtas), com as informações editadas aplicadas.
  static func tracks() async -> [Track] {
    lock.lock()
    var list = cachedTracks
    lock.unlock()
    if list == nil, let raw = try? Data(contentsOf: tracksFile) {
      list = try? JSONDecoder().decode([Track].self, from: raw)
      lock.lock()
      cachedTracks = list
      lock.unlock()
    }
    if list == nil || list?.isEmpty == true {
      // App aberto direto pelo CarPlay, sem varredura ainda: faz uma agora.
      _ = await LibraryStore.audio()
      lock.lock()
      list = cachedTracks
      lock.unlock()
    }
    let d = data()
    return (list ?? []).compactMap { t in
      if d.hiddenTracks.contains(t.id) || t.durationMs < d.minDurationMs { return nil }
      if let folder = t.folder, d.hiddenFolders.contains(folder) { return nil }
      var track = t
      if let edit = d.edits[t.id] {
        if let v = edit["title"], !v.isEmpty { track.title = v }
        if let v = edit["artist"], !v.isEmpty { track.artist = v }
        if let v = edit["album"], !v.isEmpty { track.album = v }
      }
      return track
    }
  }

  static func entry(_ t: Track) -> QueueEntry {
    var art = URLComponents()
    art.scheme = "ritmo-art"
    art.host = "album"
    art.path = "/" + t.albumId
    art.queryItems = [URLQueryItem(name: "track", value: t.uri)]
    return QueueEntry(id: t.id, uri: t.uri, title: t.title, artist: t.artist, album: t.album, artworkUri: art.string)
  }

  static func label(_ key: String) -> String {
    data().labels[key] ?? defaultLabels[key] ?? key
  }
}
