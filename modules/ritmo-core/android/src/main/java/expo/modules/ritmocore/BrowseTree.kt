package expo.modules.ritmocore

import android.content.Context
import android.net.Uri
import android.os.Bundle
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import org.json.JSONArray
import org.json.JSONObject
import java.text.Normalizer

/**
 * Navegação para o Android Auto (e outros "media browsers"): Recentes, Curtidas, Playlists,
 * Álbuns, Artistas e Aleatório, mais a busca por voz.
 *
 * As coleções, os filtros e os nomes das seções vêm do JS (`setBrowseData`, salvo em
 * SharedPreferences para funcionar com o app fechado); as músicas vêm direto do MediaStore.
 * Chamar fora da thread principal: lê o MediaStore.
 */
object BrowseTree {
  const val ROOT = "ritmo:root"
  private const val HOME = "ritmo:home"
  private const val RECENT = "ritmo:recent"
  private const val LIKED = "ritmo:liked"
  private const val PLAYLISTS = "ritmo:playlists"
  private const val ALBUMS = "ritmo:albums"
  private const val ARTISTS = "ritmo:artists"
  private const val SHUFFLE = "ritmo:shuffle"
  private const val PLAYLIST = "ritmo:playlist:"
  private const val ALBUM = "ritmo:album:"
  private const val ARTIST = "ritmo:artist:"
  /** Faixa dentro de uma lista: "<lista>|<id da faixa>" (para tocar a lista inteira a partir dela). */
  private const val SEP = '|'

  private const val PREFS = "ritmo_browse"
  private const val KEY = "data"
  private const val CACHE_MS = 30_000L
  private const val RECENT_LIMIT = 100

  // Pede ao Android Auto lista para músicas e grade para álbuns/artistas.
  private const val STYLE_BROWSABLE = "android.media.browse.CONTENT_STYLE_BROWSABLE_HINT"
  private const val STYLE_PLAYABLE = "android.media.browse.CONTENT_STYLE_PLAYABLE_HINT"
  private const val STYLE_LIST = 1
  private const val STYLE_GRID = 2
  /** Sem isto na raiz o Android Auto ignora as dicas de lista/grade. */
  private const val STYLE_SUPPORTED = "android.media.browse.CONTENT_STYLE_SUPPORTED"

  private val DIACRITICS = Regex("\\p{M}+")
  private val SPACES = Regex("\\s+")

  data class Track(
    val id: String,
    val uri: String,
    val title: String,
    val artist: String?,
    val album: String?,
    val albumId: String,
    val artistId: String,
    val durationMs: Long,
    val folder: String?,
    val trackNumber: Int
  )

  private data class Playlist(val id: String, val name: String, val trackIds: List<String>)

  private class Data(
    val labels: Map<String, String>,
    val playlists: List<Playlist>,
    val liked: List<String>,
    val recent: List<String>,
    val hiddenFolders: Set<String>,
    val hiddenTracks: Set<String>,
    val minDurationMs: Long,
    val edits: Map<String, Map<String, String>>
  )

  private val DEFAULT_LABELS = mapOf(
    "home" to "Início",
    "recent" to "Recentes",
    "liked" to "Curtidas",
    "playlists" to "Playlists",
    "albums" to "Álbuns",
    "artists" to "Artistas",
    "shuffle" to "Tocar tudo no aleatório",
    "unknownArtist" to "Artista desconhecido",
    "unknownAlbum" to "Álbum desconhecido"
  )

  @Volatile private var cachedTracks: List<Track>? = null
  @Volatile private var cachedAt = 0L
  @Volatile private var cachedData: Data? = null

  /** Muda a cada alteração de dados ou da biblioteca: caches antigos (inclusive buscas) deixam de valer. */
  @Volatile var generation = 0
    private set

  // ------------------------------------------------------------ dados vindos do JS

  /** Guarda o que o JS mandou (playlists, curtidas, recentes, filtros, edições e textos). */
  fun save(context: Context, json: String) {
    JSONObject(json) // valida antes de gravar
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply()
    generation++
    cachedData = null
    cachedTracks = null
  }

  /** A biblioteca mudou (MediaStore): a próxima navegação relê as músicas. */
  fun invalidate() {
    generation++
    cachedTracks = null
  }

  private fun data(context: Context): Data {
    cachedData?.let { return it }
    val raw = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
    val parsed = runCatching { raw?.let { parse(JSONObject(it)) } }.getOrNull() ?: Data(DEFAULT_LABELS, emptyList(), emptyList(), emptyList(), emptySet(), emptySet(), 30_000L, emptyMap())
    cachedData = parsed
    return parsed
  }

  private fun JSONArray?.strings(): List<String> =
    if (this == null) emptyList() else (0 until length()).mapNotNull { optString(it, null)?.takeIf { s -> s.isNotEmpty() } }

  private fun parse(o: JSONObject): Data {
    val labels = HashMap(DEFAULT_LABELS)
    o.optJSONObject("labels")?.let { l -> l.keys().forEach { k -> l.optString(k).takeIf { it.isNotBlank() }?.let { labels[k] = it } } }
    val playlists = o.optJSONArray("playlists")?.let { arr ->
      (0 until arr.length()).mapNotNull { i ->
        val p = arr.optJSONObject(i) ?: return@mapNotNull null
        val id = p.optString("id").takeIf { it.isNotEmpty() } ?: return@mapNotNull null
        Playlist(id, p.optString("name", id), p.optJSONArray("trackIds").strings())
      }
    } ?: emptyList()
    val edits = HashMap<String, Map<String, String>>()
    o.optJSONObject("edits")?.let { e ->
      e.keys().forEach { id ->
        val fields = e.optJSONObject(id) ?: return@forEach
        edits[id] = listOf("title", "artist", "album").mapNotNull { f -> fields.optString(f).takeIf { it.isNotBlank() }?.let { f to it } }.toMap()
      }
    }
    return Data(
      labels = labels,
      playlists = playlists,
      liked = o.optJSONArray("liked").strings(),
      recent = o.optJSONArray("recent").strings().take(RECENT_LIMIT),
      hiddenFolders = o.optJSONArray("hiddenFolders").strings().toSet(),
      hiddenTracks = o.optJSONArray("hiddenTracks").strings().toSet(),
      minDurationMs = o.optLong("minDurationMs", 30_000L),
      edits = edits
    )
  }

  // ------------------------------------------------------------ músicas

  private fun tracks(context: Context): List<Track> {
    val now = System.currentTimeMillis()
    cachedTracks?.takeIf { now - cachedAt < CACHE_MS }?.let { return it }
    val gen = generation
    val d = data(context)
    val list = MediaLibrary.audio(context).mapNotNull { m ->
      val id = m["id"] as? String ?: return@mapNotNull null
      val folder = m["folder"] as? String
      val duration = (m["duration"] as? Number)?.toLong() ?: 0L
      if (id in d.hiddenTracks || (folder != null && folder in d.hiddenFolders) || duration < d.minDurationMs) return@mapNotNull null
      val edit = d.edits[id]
      Track(
        id = id,
        uri = m["uri"] as? String ?: return@mapNotNull null,
        title = edit?.get("title") ?: (m["title"] as? String ?: id),
        artist = edit?.get("artist") ?: (m["artist"] as? String),
        album = edit?.get("album") ?: (m["album"] as? String),
        albumId = m["albumId"] as? String ?: "0",
        artistId = m["artistId"] as? String ?: "0",
        durationMs = duration,
        folder = folder,
        trackNumber = (m["track"] as? Number)?.toInt() ?: 0
      )
    }
    // Se os dados mudaram durante a leitura, não guarda (a próxima chamada relê com os novos).
    if (gen == generation) {
      cachedTracks = list
      cachedAt = now
    }
    return list
  }

  private fun byIds(all: List<Track>, ids: List<String>): List<Track> {
    val map = all.associateBy { it.id }
    return ids.mapNotNull { map[it] }
  }

  private fun normalize(text: String?): String =
    Normalizer.normalize(text ?: "", Normalizer.Form.NFD).replace(DIACRITICS, "").lowercase().trim()

  // ------------------------------------------------------------ itens

  private fun styleExtras(browsable: Int, playable: Int) = Bundle().apply {
    putInt(STYLE_BROWSABLE, browsable)
    putInt(STYLE_PLAYABLE, playable)
  }

  private fun node(id: String, title: String, subtitle: String? = null, type: Int, playable: Boolean, grid: Boolean = false, artwork: String? = null): MediaItem =
    MediaItem.Builder()
      .setMediaId(id)
      .setMediaMetadata(
        MediaMetadata.Builder()
          .setTitle(title)
          .setSubtitle(subtitle)
          .apply { artwork?.let { setArtworkUri(Uri.parse(it)) } }
          .setIsBrowsable(true)
          .setIsPlayable(playable)
          .setMediaType(type)
          .setExtras(styleExtras(if (grid) STYLE_GRID else STYLE_LIST, STYLE_LIST))
          .build()
      )
      .build()

  /** Faixa para mostrar numa lista (sem URI: o app resolve quando a pessoa tocar). */
  private fun listed(parent: String, t: Track, labels: Map<String, String>): MediaItem =
    MediaItem.Builder()
      .setMediaId("$parent$SEP${t.id}")
      .setMediaMetadata(
        MediaMetadata.Builder()
          .setTitle(t.title)
          .setArtist(t.artist ?: labels["unknownArtist"])
          .setSubtitle(t.artist ?: labels["unknownArtist"])
          .setAlbumTitle(t.album)
          .setIsBrowsable(false)
          .setIsPlayable(true)
          .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
          .build()
      )
      .build()

  /** Faixa pronta para o player (mesmo formato que o app usa ao montar a fila). */
  fun playable(t: Track): MediaItem =
    MediaItem.Builder()
      .setMediaId(t.id)
      .setUri(t.uri)
      .setMediaMetadata(
        MediaMetadata.Builder()
          .setTitle(t.title)
          .setArtist(t.artist)
          .setAlbumTitle(t.album)
          .setIsPlayable(true)
          .setIsBrowsable(false)
          .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
          .setArtworkUri(Uri.parse(ArtworkBitmapLoader.uriFor(t.albumId, t.uri)))
          .build()
      )
      .build()

  /** Extras da raiz: avisa o Android Auto que entendemos as dicas de lista/grade. */
  fun rootExtras(): Bundle = Bundle().apply {
    putBoolean(STYLE_SUPPORTED, true)
    putInt(STYLE_BROWSABLE, STYLE_LIST)
    putInt(STYLE_PLAYABLE, STYLE_LIST)
  }

  fun root(): MediaItem =
    MediaItem.Builder()
      .setMediaId(ROOT)
      .setMediaMetadata(
        MediaMetadata.Builder()
          .setTitle("Player Downloader")
          .setIsBrowsable(true)
          .setIsPlayable(false)
          .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED)
          .setExtras(styleExtras(STYLE_LIST, STYLE_LIST))
          .build()
      )
      .build()

  // ------------------------------------------------------------ navegação

  /** Filhos de um nó, ou null se o nó não existe. */
  fun children(context: Context, parentId: String): List<MediaItem>? {
    val d = data(context)
    val l = d.labels
    return when {
      // O Android Auto mostra no máximo 4 abas na raiz.
      parentId == ROOT -> listOf(
        node(HOME, l["home"]!!, type = MediaMetadata.MEDIA_TYPE_FOLDER_MIXED, playable = false),
        node(PLAYLISTS, l["playlists"]!!, type = MediaMetadata.MEDIA_TYPE_FOLDER_PLAYLISTS, playable = false),
        node(ALBUMS, l["albums"]!!, type = MediaMetadata.MEDIA_TYPE_FOLDER_ALBUMS, playable = false, grid = true),
        node(ARTISTS, l["artists"]!!, type = MediaMetadata.MEDIA_TYPE_FOLDER_ARTISTS, playable = false)
      )
      parentId == HOME -> listOf(
        MediaItem.Builder()
          .setMediaId(SHUFFLE)
          .setMediaMetadata(
            MediaMetadata.Builder().setTitle(l["shuffle"]).setIsBrowsable(false).setIsPlayable(true).setMediaType(MediaMetadata.MEDIA_TYPE_PLAYLIST).build()
          )
          .build(),
        node(RECENT, l["recent"]!!, type = MediaMetadata.MEDIA_TYPE_PLAYLIST, playable = true),
        node(LIKED, l["liked"]!!, type = MediaMetadata.MEDIA_TYPE_PLAYLIST, playable = true)
      )
      parentId == PLAYLISTS -> d.playlists.map { p ->
        node(PLAYLIST + p.id, p.name, subtitle = null, type = MediaMetadata.MEDIA_TYPE_PLAYLIST, playable = true)
      }
      parentId == ALBUMS -> tracks(context).groupBy { it.albumId }.map { (albumId, list) ->
        val first = list.first()
        node(
          ALBUM + albumId,
          first.album ?: l["unknownAlbum"]!!,
          subtitle = first.artist ?: l["unknownArtist"],
          type = MediaMetadata.MEDIA_TYPE_ALBUM,
          playable = true,
          artwork = ArtworkBitmapLoader.uriFor(albumId, first.uri)
        )
      }.sortedBy { normalize(it.mediaMetadata.title?.toString()) }
      parentId == ARTISTS -> tracks(context).groupBy { it.artistId }.map { (artistId, list) ->
        node(ARTIST + artistId, list.first().artist ?: l["unknownArtist"]!!, type = MediaMetadata.MEDIA_TYPE_ARTIST, playable = true)
      }.sortedBy { normalize(it.mediaMetadata.title?.toString()) }
      else -> trackList(context, parentId)?.map { listed(parentId, it, l) }
    }
  }

  /** Músicas de uma lista tocável (recentes, curtidas, playlist, álbum, artista), na ordem certa. */
  private fun trackList(context: Context, id: String): List<Track>? {
    val d = data(context)
    val all = tracks(context)
    return when {
      id == RECENT -> byIds(all, d.recent)
      id == LIKED -> byIds(all, d.liked)
      id.startsWith(PLAYLIST) -> d.playlists.find { it.id == id.removePrefix(PLAYLIST) }?.let { byIds(all, it.trackIds) }
      id.startsWith(ALBUM) -> all.filter { it.albumId == id.removePrefix(ALBUM) }.sortedWith(compareBy({ it.trackNumber }, { normalize(it.title) }))
      id.startsWith(ARTIST) -> all.filter { it.artistId == id.removePrefix(ARTIST) }
        .sortedWith(compareBy({ normalize(it.album) }, { it.trackNumber }, { normalize(it.title) }))
      else -> null
    }
  }

  fun item(context: Context, mediaId: String): MediaItem? {
    if (mediaId == ROOT) return root()
    val parent = mediaId.substringBeforeLast(SEP, "")
    if (parent.isNotEmpty()) {
      val trackId = mediaId.substringAfterLast(SEP)
      return tracks(context).find { it.id == trackId }?.let { listed(parent, it, data(context).labels) }
    }
    return children(context, ROOT)?.find { it.mediaId == mediaId }
      ?: children(context, HOME)?.find { it.mediaId == mediaId }
      ?: children(context, PLAYLISTS)?.find { it.mediaId == mediaId }
      ?: if (mediaId.startsWith(ALBUM) || mediaId.startsWith(ARTIST)) {
        children(context, if (mediaId.startsWith(ALBUM)) ALBUMS else ARTISTS)?.find { it.mediaId == mediaId }
      } else {
        null
      }
  }

  /** Busca (por voz ou digitada no carro) em título, artista e álbum. */
  fun search(context: Context, query: String): List<Track> {
    val words = normalize(query).split(SPACES).filter { it.isNotEmpty() }
    val all = tracks(context)
    if (words.isEmpty()) return all.shuffled().take(50)
    return all
      .map { t -> t to listOf(normalize(t.title), normalize(t.artist), normalize(t.album)) }
      .filter { (_, fields) -> words.all { w -> fields.any { it.contains(w) } } }
      .sortedByDescending { (_, fields) -> if (fields[0] == normalize(query)) 2 else if (fields[1] == normalize(query)) 1 else 0 }
      .map { it.first }
      .take(100)
  }

  fun searchItems(context: Context, query: String): List<MediaItem> {
    val labels = data(context).labels
    return search(context, query).map { listed("ritmo:search:$query", it, labels) }
  }

  /**
   * O que tocar quando a pessoa escolhe algo no carro: uma faixa toca com a lista dela como fila;
   * uma lista toca do começo; "Aleatório" embaralha tudo. Null se o ID não é da navegação.
   */
  fun expand(context: Context, mediaId: String): Pair<List<MediaItem>, Int>? {
    if (mediaId == SHUFFLE) {
      val all = tracks(context).shuffled()
      return if (all.isEmpty()) null else all.map(::playable) to 0
    }
    val parent = mediaId.substringBeforeLast(SEP, "")
    if (parent.isNotEmpty()) {
      val trackId = mediaId.substringAfterLast(SEP)
      val list = if (parent.startsWith("ritmo:search:")) search(context, parent.removePrefix("ritmo:search:")) else trackList(context, parent)
      val tracks = list?.takeIf { l -> l.any { it.id == trackId } } ?: tracks(context).filter { it.id == trackId }
      if (tracks.isEmpty()) return null
      return tracks.map(::playable) to tracks.indexOfFirst { it.id == trackId }.coerceAtLeast(0)
    }
    val list = trackList(context, mediaId) ?: return null
    return if (list.isEmpty()) null else list.map(::playable) to 0
  }

  /** "Ok Google, tocar X no Player Downloader": toca o resultado da busca (ou tudo no aleatório se vier vazio). */
  fun playFromSearch(context: Context, query: String): Pair<List<MediaItem>, Int>? {
    val results = search(context, query)
    return if (results.isEmpty()) null else results.map(::playable) to 0
  }

  /** ID simples de faixa a partir de um ID da navegação ("<lista>|<id>" → "<id>"). */
  fun trackId(mediaId: String): String = mediaId.substringAfterLast(SEP)

  fun track(context: Context, id: String): Track? = tracks(context).find { it.id == id }
}
