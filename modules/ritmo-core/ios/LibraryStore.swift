import AVFoundation
import Foundation
import MediaPlayer
import UIKit

/**
 * Biblioteca do iOS. O iPhone não deixa apps lerem as pastas de música, então as músicas vêm de:
 *  - arquivos importados para a pasta do app (Arquivos › No meu iPhone › Ritmo, Finder/iTunes ou "Importar");
 *  - app Música (músicas sincronizadas do computador; itens com DRM/streaming não têm `assetURL` e ficam de fora).
 *
 * IDs: "f:<caminho relativo em Documents>" para arquivos e "m:<persistentID>" para o app Música.
 * Caminhos mostrados ao JS são "Ritmo/<pasta>/<arquivo>": o caminho real do contêiner muda entre atualizações.
 */
enum LibraryStore {
  static let virtualRoot = "Ritmo"

  static let audioExtensions: Set<String> = ["mp3", "m4a", "aac", "wav", "aif", "aiff", "aifc", "caf", "flac", "m4b", "alac", "opus"]
  static let videoExtensions: Set<String> = ["mp4", "mov", "m4v", "3gp"]

  static var documents: URL {
    FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
  }

  static var caches: URL {
    FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
  }

  // MARK: - IDs e caminhos

  static func fileId(for url: URL) -> String {
    "f:" + relativePath(of: url)
  }

  static func relativePath(of url: URL) -> String {
    let base = documents.standardizedFileURL.path
    let full = url.standardizedFileURL.path
    guard full.hasPrefix(base) else { return url.lastPathComponent }
    return String(full.dropFirst(base.count)).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
  }

  /// "f:Rock/a.mp3" → URL do arquivo; "m:123" → nil.
  static func fileURL(forId id: String) -> URL? {
    guard id.hasPrefix("f:") else { return nil }
    return documents.appendingPathComponent(String(id.dropFirst(2)))
  }

  /// "Ritmo/Rock/a.mp3" (caminho mostrado no app) → URL real.
  static func fileURL(forVirtualPath path: String) -> URL? {
    let prefix = virtualRoot + "/"
    guard path.hasPrefix(prefix) else { return nil }
    return documents.appendingPathComponent(String(path.dropFirst(prefix.count)))
  }

  static func virtualPath(_ relative: String) -> String {
    relative.isEmpty ? virtualRoot : "\(virtualRoot)/\(relative)"
  }

  /// URI de reprodução atual de um ID (o caminho do contêiner pode ter mudado desde que a fila foi salva).
  static func playableURL(id: String, fallback: String?) -> URL? {
    if let file = fileURL(forId: id) { return file }
    if let fallback, let url = URL(string: fallback) { return url }
    if id.hasPrefix("m:"), let pid = UInt64(id.dropFirst(2)) { return mediaItem(persistentID: pid)?.assetURL }
    return nil
  }

  // MARK: - App Música

  static func mediaLibraryStatus() -> String {
    switch MPMediaLibrary.authorizationStatus() {
    case .authorized: return "granted"
    case .denied: return "denied"
    case .restricted: return "restricted"
    default: return "undetermined"
    }
  }

  static func requestMediaLibraryAccess() async -> String {
    let status = await withCheckedContinuation { continuation in
      MPMediaLibrary.requestAuthorization { _ in continuation.resume(returning: mediaLibraryStatus()) }
    }
    // Acesso recém-liberado: passa a avisar quando o app Música mudar.
    if status == "granted" { MPMediaLibrary.default().beginGeneratingLibraryChangeNotifications() }
    return status
  }

  static func mediaItem(persistentID: UInt64) -> MPMediaItem? {
    guard MPMediaLibrary.authorizationStatus() == .authorized else { return nil }
    let query = MPMediaQuery.songs()
    query.addFilterPredicate(MPMediaPropertyPredicate(value: NSNumber(value: persistentID), forProperty: MPMediaItemPropertyPersistentID))
    return query.items?.first
  }

  private static func mediaLibraryTracks() -> [[String: Any]] {
    guard MPMediaLibrary.authorizationStatus() == .authorized else { return [] }
    let items = MPMediaQuery.songs().items ?? []
    return items.compactMap { item -> [String: Any]? in
      // Sem assetURL = protegido por DRM ou só na nuvem: não dá para tocar.
      guard let url = item.assetURL, !item.hasProtectedAsset, !item.isCloudItem else { return nil }
      let albumId = item.albumPersistentID
      let artistId = item.artistPersistentID
      return [
        "id": "m:\(item.persistentID)",
        "uri": url.absoluteString,
        "title": nonEmpty(item.title) ?? url.lastPathComponent,
        "fileName": NSNull(),
        "artist": nonEmpty(item.artist) ?? NSNull(),
        "artistId": "m\(artistId)",
        "album": nonEmpty(item.albumTitle) ?? NSNull(),
        "albumId": "m\(albumId)",
        "duration": (item.playbackDuration * 1000).rounded(),
        "path": NSNull(),
        "folder": NSNull(),
        "size": 0,
        "dateAdded": item.dateAdded.timeIntervalSince1970 * 1000,
        "track": item.albumTrackNumber,
        "year": yearOf(item.releaseDate),
        "mime": NSNull(),
        "isMusic": true,
      ]
    }
  }

  // MARK: - Arquivos importados

  private struct CachedMeta: Codable {
    var size: Int64
    var modified: Double
    var title: String?
    var artist: String?
    var album: String?
    var albumArtist: String?
    var durationMs: Double
    var track: Int
    var year: Int
  }

  private static var metaCacheURL: URL { caches.appendingPathComponent("ritmo-library-cache.json") }

  private static func loadMetaCache() -> [String: CachedMeta] {
    guard let data = try? Data(contentsOf: metaCacheURL) else { return [:] }
    return (try? JSONDecoder().decode([String: CachedMeta].self, from: data)) ?? [:]
  }

  private static func saveMetaCache(_ cache: [String: CachedMeta]) {
    if let data = try? JSONEncoder().encode(cache) { try? data.write(to: metaCacheURL, options: .atomic) }
  }

  /// Todos os arquivos com uma das extensões, em qualquer subpasta de Documents (menos a lixeira interna).
  static func files(withExtensions exts: Set<String>) -> [URL] {
    let keys: [URLResourceKey] = [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey, .creationDateKey]
    guard let enumerator = FileManager.default.enumerator(at: documents, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles]) else {
      return []
    }
    var out: [URL] = []
    for case let url as URL in enumerator {
      if url.lastPathComponent == ".Trash" { enumerator.skipDescendants(); continue }
      guard exts.contains(url.pathExtension.lowercased()) else { continue }
      if (try? url.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile == true { out.append(url) }
    }
    return out
  }

  private static func readMeta(_ url: URL, size: Int64, modified: Double) async -> CachedMeta {
    let asset = AVURLAsset(url: url)
    var meta = CachedMeta(size: size, modified: modified, title: nil, artist: nil, album: nil, albumArtist: nil, durationMs: 0, track: 0, year: 0)
    if let duration = try? await asset.load(.duration), duration.isNumeric {
      meta.durationMs = (CMTimeGetSeconds(duration) * 1000).rounded()
    }
    let common = (try? await asset.load(.commonMetadata)) ?? []
    meta.title = await string(common, .commonIdentifierTitle)
    meta.artist = await string(common, .commonIdentifierArtist)
    meta.album = await string(common, .commonIdentifierAlbumName)
    if let date = await string(common, .commonIdentifierCreationDate) { meta.year = Int(date.prefix(4)) ?? 0 }

    // Número da faixa e artista do álbum ficam nos metadados específicos do formato (ID3 / iTunes).
    let all = (try? await asset.load(.metadata)) ?? []
    if let trck = await string(all, .id3MetadataTrackNumber) {
      meta.track = Int(trck.split(separator: "/").first ?? "") ?? 0
    } else if let item = AVMetadataItem.metadataItems(from: all, filteredByIdentifier: .iTunesMetadataTrackNumber).first,
      let data = try? await item.load(.dataValue), data.count >= 4
    {
      meta.track = Int(data[2]) << 8 | Int(data[3])
    }
    var albumArtist = await string(all, .iTunesMetadataAlbumArtist)
    if albumArtist == nil { albumArtist = await string(all, .id3MetadataBand) }
    meta.albumArtist = albumArtist
    if meta.year == 0 {
      var year = await string(all, .id3MetadataYear)
      if year == nil { year = await string(all, .id3MetadataRecordingTime) }
      if let year { meta.year = Int(year.prefix(4)) ?? 0 }
    }
    return meta
  }

  private static func string(_ items: [AVMetadataItem], _ id: AVMetadataIdentifier) async -> String? {
    guard let item = AVMetadataItem.metadataItems(from: items, filteredByIdentifier: id).first else { return nil }
    return nonEmpty(try? await item.load(.stringValue))
  }

  private static func importedTracks() async -> [[String: Any]] {
    var cache = loadMetaCache()
    var seen = Set<String>()
    var tracks: [[String: Any]] = []
    let urls = files(withExtensions: audioExtensions)

    // Lê os metadados que mudaram em paralelo (até 6 arquivos por vez).
    var pending: [(URL, String, Int64, Double, Double)] = []
    var infos: [(URL, String, Int64, Double, Double)] = []
    for url in urls {
      let rel = relativePath(of: url)
      let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey, .creationDateKey])
      let size = Int64(values?.fileSize ?? 0)
      let modified = values?.contentModificationDate?.timeIntervalSince1970 ?? 0
      let created = (values?.creationDate ?? values?.contentModificationDate ?? Date()).timeIntervalSince1970
      infos.append((url, rel, size, modified, created))
      if let c = cache[rel], c.size == size, c.modified == modified { continue }
      pending.append((url, rel, size, modified, created))
    }
    var index = 0
    while index < pending.count {
      let batch = pending[index..<min(index + 6, pending.count)]
      await withTaskGroup(of: (String, CachedMeta).self) { group in
        for (url, rel, size, modified, _) in batch {
          group.addTask { (rel, await readMeta(url, size: size, modified: modified)) }
        }
        for await (rel, meta) in group { cache[rel] = meta }
      }
      index += 6
    }

    for (url, rel, size, _, created) in infos {
      guard let meta = cache[rel] else { continue }
      seen.insert(rel)
      let folderRel = (rel as NSString).deletingLastPathComponent
      let albumName = normalizedKey(meta.album ?? "")
      let albumArtistName = normalizedKey(meta.albumArtist ?? meta.artist ?? "")
      let albumKey = "\(albumName)|\(albumArtistName)|\(folderRel)"
      let artistKey = normalizedKey(meta.artist ?? "")
      let fileName = url.lastPathComponent
      tracks.append([
        "id": "f:" + rel,
        "uri": url.absoluteString,
        "title": meta.title ?? (fileName as NSString).deletingPathExtension,
        "fileName": fileName,
        "artist": meta.artist ?? NSNull(),
        "artistId": "f" + stableHash(artistKey),
        "album": meta.album ?? NSNull(),
        "albumId": "f" + stableHash(albumKey),
        "duration": meta.durationMs,
        "path": virtualPath(rel),
        "folder": virtualPath(folderRel),
        "size": Double(size),
        "dateAdded": created * 1000,
        "track": meta.track,
        "year": meta.year,
        "mime": mimeType(url.pathExtension) ?? NSNull(),
        "isMusic": true,
      ])
    }
    cache = cache.filter { seen.contains($0.key) }
    saveMetaCache(cache)
    return tracks
  }

  // MARK: - Consultas usadas pelo JS

  static func audio() async -> [[String: Any]] {
    let files = await importedTracks()
    let library = mediaLibraryTracks()
    let all = files + library
    BrowseCatalog.updateTracks(all)
    return all
  }

  static func videos() async -> [[String: Any]] {
    var out: [[String: Any]] = []
    for url in files(withExtensions: videoExtensions) {
      let rel = relativePath(of: url)
      let values = try? url.resourceValues(forKeys: [.fileSizeKey, .creationDateKey, .contentModificationDateKey])
      let asset = AVURLAsset(url: url)
      var duration = 0.0
      if let d = try? await asset.load(.duration), d.isNumeric { duration = (CMTimeGetSeconds(d) * 1000).rounded() }
      var width = 0
      var height = 0
      if let track = try? await asset.loadTracks(withMediaType: .video).first,
        let size = try? await track.load(.naturalSize),
        let transform = try? await track.load(.preferredTransform)
      {
        let rect = CGRect(origin: .zero, size: size).applying(transform)
        width = Int(abs(rect.width))
        height = Int(abs(rect.height))
      }
      let title = (url.lastPathComponent as NSString).deletingPathExtension
      out.append([
        "id": "f:" + rel,
        "uri": url.absoluteString,
        "title": title,
        "fileName": url.lastPathComponent,
        "duration": duration,
        "size": Double(values?.fileSize ?? 0),
        "width": width,
        "height": height,
        "path": virtualPath(rel),
        "folder": virtualPath((rel as NSString).deletingLastPathComponent),
        "dateAdded": (values?.creationDate ?? values?.contentModificationDate ?? Date()).timeIntervalSince1970 * 1000,
        "mime": mimeType(url.pathExtension) ?? NSNull(),
      ])
    }
    return out.sorted { ($0["dateAdded"] as? Double ?? 0) > ($1["dateAdded"] as? Double ?? 0) }
  }

  // MARK: - Capas

  private static var artworkDir: URL {
    let dir = caches.appendingPathComponent("artwork", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }

  /// Capa em JPEG no cache; nil se a música não tiver. Para o app Música usa a capa do item.
  static func artwork(albumId: String, trackUri: String?, size: Int) async -> String? {
    let safe = albumId.replacingOccurrences(of: "/", with: "_")
    let out = artworkDir.appendingPathComponent("a_\(safe)_\(size).jpg")
    let none = artworkDir.appendingPathComponent("a_\(safe)_\(size).none")
    if FileManager.default.fileExists(atPath: out.path) { return out.absoluteString }
    if FileManager.default.fileExists(atPath: none.path) { return nil }

    var image: UIImage?
    var inspected = false
    if let trackUri, let url = URL(string: trackUri) {
      if url.scheme == "ipod-library" {
        if let pid = persistentID(fromAssetURL: url), let item = mediaItem(persistentID: pid) {
          inspected = true
          image = item.artwork?.image(at: CGSize(width: size, height: size))
        }
      } else {
        inspected = FileManager.default.fileExists(atPath: url.path)
        let common = (try? await AVURLAsset(url: url).load(.commonMetadata)) ?? []
        if let item = AVMetadataItem.metadataItems(from: common, filteredByIdentifier: .commonIdentifierArtwork).first,
          let data = try? await item.load(.dataValue)
        {
          image = UIImage(data: data)
        } else {
          image = folderCover(near: url)
        }
      }
    }
    guard let image, let data = resized(image, to: size).jpegData(compressionQuality: 0.85) else {
      if inspected { FileManager.default.createFile(atPath: none.path, contents: Data()) }
      return nil
    }
    try? data.write(to: out, options: .atomic)
    return out.absoluteString
  }

  /// "cover.jpg" / "folder.jpg" ao lado da música, comum em álbuns copiados do computador.
  private static func folderCover(near url: URL) -> UIImage? {
    let dir = url.deletingLastPathComponent()
    for name in ["cover.jpg", "cover.png", "folder.jpg", "folder.png", "front.jpg", "albumart.jpg"] {
      if let img = UIImage(contentsOfFile: dir.appendingPathComponent(name).path) { return img }
    }
    return nil
  }

  static func artworkImage(forTrackUri uri: String?, albumId: String?) async -> UIImage? {
    guard let albumId else { return nil }
    guard let path = await artwork(albumId: albumId, trackUri: uri, size: 512), let url = URL(string: path) else { return nil }
    return UIImage(contentsOfFile: url.path)
  }

  static func videoThumbnail(id: String, size: Int) async -> String? {
    guard let url = fileURL(forId: id) else { return nil }
    let out = artworkDir.appendingPathComponent("v_\(stableHash(id))_\(size).jpg")
    if FileManager.default.fileExists(atPath: out.path) { return out.absoluteString }
    let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = CGSize(width: size, height: size)
    guard let frame = try? await generator.image(at: CMTime(seconds: 1, preferredTimescale: 600)),
      let data = UIImage(cgImage: frame.image).jpegData(compressionQuality: 0.8)
    else { return nil }
    try? data.write(to: out, options: .atomic)
    return out.absoluteString
  }

  static func clearArtworkCache() {
    try? FileManager.default.removeItem(at: caches.appendingPathComponent("artwork", isDirectory: true))
  }

  // MARK: - Letras

  /// Arquivo .lrc com o mesmo nome ao lado da música; senão a letra embutida (ID3 USLT / iTunes).
  static func lyrics(path: String?, uri: String) async -> [String: Any]? {
    let url = URL(string: uri)
    let localFile = path.flatMap { Self.fileURL(forVirtualPath: $0) } ?? (url?.isFileURL == true ? url : nil)
    if let localFile {
      let lrc = localFile.deletingPathExtension().appendingPathExtension("lrc")
      if let text = readText(lrc), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return ["source": "lrc", "text": text]
      }
    }
    if let url, url.scheme == "ipod-library", let pid = persistentID(fromAssetURL: url), let item = mediaItem(persistentID: pid),
      let text = nonEmpty(item.lyrics)
    {
      return ["source": "embedded", "text": text]
    }
    guard let url else { return nil }
    let asset = AVURLAsset(url: url)
    let all = (try? await asset.load(.metadata)) ?? []
    if let text = await string(all, .id3MetadataUnsynchronizedLyric) { return ["source": "embedded", "text": text] }
    return nil
  }

  private static func readText(_ url: URL) -> String? {
    guard let data = try? Data(contentsOf: url) else { return nil }
    return String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1)
  }

  // MARK: - Excluir

  /// Apaga arquivos importados. Músicas do app Música não podem ser apagadas por outros apps.
  static func delete(ids: [String]) -> Bool {
    var ok = true
    for id in ids {
      guard let url = fileURL(forId: id) else {
        ok = false
        continue
      }
      do {
        try FileManager.default.removeItem(at: url)
        let lrc = url.deletingPathExtension().appendingPathExtension("lrc")
        try? FileManager.default.removeItem(at: lrc)
      } catch {
        ok = false
      }
    }
    return ok
  }

  // MARK: - Utilidades

  static func persistentID(fromAssetURL url: URL) -> UInt64? {
    URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "id" }?.value.flatMap { UInt64($0) }
  }

  static func nonEmpty(_ s: String?) -> String? {
    guard let s = s?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
    return s
  }

  private static func normalizedKey(_ s: String) -> String {
    s.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil).trimmingCharacters(in: .whitespaces)
  }

  /// Hash estável entre execuções (o `hashValue` do Swift muda a cada abertura do app).
  static func stableHash(_ s: String) -> String {
    var hash: UInt64 = 0xcbf2_9ce4_8422_2325
    for byte in s.utf8 {
      hash ^= UInt64(byte)
      hash = hash &* 0x0000_0100_0000_01b3
    }
    return String(hash, radix: 36)
  }

  private static func yearOf(_ date: Date?) -> Int {
    guard let date else { return 0 }
    return Calendar(identifier: .gregorian).component(.year, from: date)
  }

  private static func mimeType(_ ext: String) -> String? {
    switch ext.lowercased() {
    case "mp3": return "audio/mpeg"
    case "m4a", "m4b", "alac": return "audio/mp4"
    case "aac": return "audio/aac"
    case "wav": return "audio/wav"
    case "aif", "aiff", "aifc": return "audio/aiff"
    case "caf": return "audio/x-caf"
    case "flac": return "audio/flac"
    case "opus": return "audio/opus"
    case "mp4", "m4v": return "video/mp4"
    case "mov": return "video/quicktime"
    case "3gp": return "video/3gpp"
    default: return nil
    }
  }

  private static func resized(_ image: UIImage, to size: Int) -> UIImage {
    let target = CGFloat(size)
    let scale = min(1, target / max(image.size.width, image.size.height))
    guard scale < 1 else { return image }
    let newSize = CGSize(width: image.size.width * scale, height: image.size.height * scale)
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1
    return UIGraphicsImageRenderer(size: newSize, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: newSize)) }
  }
}
