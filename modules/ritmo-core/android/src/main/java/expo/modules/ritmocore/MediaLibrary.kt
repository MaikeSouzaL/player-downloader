package expo.modules.ritmocore

import android.content.ContentUris
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Size
import java.io.File
import java.io.FileOutputStream

/** Consultas ao MediaStore: músicas, vídeos, capas e miniaturas. */
object MediaLibrary {

  fun audio(context: Context): List<Map<String, Any?>> = queryAudio(context, trashed = false)

  /** Músicas na lixeira do sistema (Android 11+), com a data em que somem de vez. */
  fun trashed(context: Context): List<Map<String, Any?>> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) queryAudio(context, trashed = true) else emptyList()

  private fun queryAudio(context: Context, trashed: Boolean): List<Map<String, Any?>> {
    val collection = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
    val columns = mutableListOf(
      MediaStore.Audio.Media._ID,
      MediaStore.Audio.Media.TITLE,
      MediaStore.Audio.Media.DISPLAY_NAME,
      MediaStore.Audio.Media.ARTIST,
      MediaStore.Audio.Media.ARTIST_ID,
      MediaStore.Audio.Media.ALBUM,
      MediaStore.Audio.Media.ALBUM_ID,
      MediaStore.Audio.AudioColumns.DURATION,
      MediaStore.Audio.Media.DATA,
      MediaStore.Audio.Media.SIZE,
      MediaStore.Audio.Media.DATE_ADDED,
      MediaStore.Audio.Media.TRACK,
      MediaStore.Audio.Media.YEAR,
      MediaStore.Audio.Media.MIME_TYPE,
      MediaStore.Audio.Media.IS_MUSIC
    )
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) columns += MediaStore.Audio.Media.RELATIVE_PATH
    if (trashed && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) columns += MediaStore.MediaColumns.DATE_EXPIRES

    val result = ArrayList<Map<String, Any?>>()
    val cursor = if (trashed && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val args = android.os.Bundle().apply { putInt(MediaStore.QUERY_ARG_MATCH_TRASHED, MediaStore.MATCH_ONLY) }
      context.contentResolver.query(collection, columns.toTypedArray(), args, null)
    } else {
      context.contentResolver.query(collection, columns.toTypedArray(), null, null, null)
    }
    cursor?.use { c ->
      val id = c.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
      val title = c.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
      val displayName = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME)
      val artist = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
      val artistId = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST_ID)
      val album = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
      val albumId = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID)
      val duration = c.getColumnIndexOrThrow(MediaStore.Audio.AudioColumns.DURATION)
      val data = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DATA)
      val size = c.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE)
      val added = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_ADDED)
      val track = c.getColumnIndexOrThrow(MediaStore.Audio.Media.TRACK)
      val year = c.getColumnIndexOrThrow(MediaStore.Audio.Media.YEAR)
      val mime = c.getColumnIndexOrThrow(MediaStore.Audio.Media.MIME_TYPE)
      val isMusic = c.getColumnIndexOrThrow(MediaStore.Audio.Media.IS_MUSIC)
      val relative = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) c.getColumnIndex(MediaStore.Audio.Media.RELATIVE_PATH) else -1
      val expires = if (trashed && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) c.getColumnIndex(MediaStore.MediaColumns.DATE_EXPIRES) else -1

      while (c.moveToNext()) {
        val rowId = c.getLong(id)
        val path = c.getString(data)
        val folder = path?.let { File(it).parent } ?: relativeFolder(c.getStringOrNull(relative))
        result += mapOf(
          "id" to rowId.toString(),
          "uri" to ContentUris.withAppendedId(collection, rowId).toString(),
          "title" to (c.getString(title)?.takeIf { it.isNotBlank() } ?: c.getString(displayName) ?: "Sem título"),
          "fileName" to c.getString(displayName),
          "artist" to known(c.getString(artist)),
          "artistId" to c.getLong(artistId).toString(),
          "album" to known(c.getString(album)),
          "albumId" to c.getLong(albumId).toString(),
          "duration" to c.getLong(duration).toDouble(),
          "path" to path,
          "folder" to folder,
          "size" to c.getLong(size).toDouble(),
          "dateAdded" to c.getLong(added) * 1000.0,
          "track" to c.getInt(track) % 1000,
          "year" to c.getInt(year),
          "mime" to c.getString(mime),
          "isMusic" to (c.getInt(isMusic) != 0),
          "expiresAt" to (if (expires >= 0 && !c.isNull(expires)) c.getLong(expires) * 1000.0 else null)
        )
      }
    }
    return result
  }

  fun videos(context: Context): List<Map<String, Any?>> {
    val collection = MediaStore.Video.Media.EXTERNAL_CONTENT_URI
    val hasOrientation = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
    val columns = arrayOf(
      MediaStore.Video.Media._ID,
      MediaStore.Video.Media.TITLE,
      MediaStore.Video.Media.DISPLAY_NAME,
      MediaStore.Video.VideoColumns.DURATION,
      MediaStore.Video.Media.SIZE,
      MediaStore.Video.Media.WIDTH,
      MediaStore.Video.Media.HEIGHT,
      MediaStore.Video.Media.DATA,
      MediaStore.Video.Media.DATE_ADDED,
      MediaStore.Video.Media.MIME_TYPE
    ) + (if (hasOrientation) arrayOf(MediaStore.Video.Media.ORIENTATION) else emptyArray())
    val result = ArrayList<Map<String, Any?>>()
    context.contentResolver.query(collection, columns, null, null, "${MediaStore.Video.Media.DATE_ADDED} DESC")?.use { c ->
      while (c.moveToNext()) {
        val rowId = c.getLong(0)
        val path = c.getString(7)
        // WIDTH/HEIGHT vêm sem a rotação: vídeo gravado em pé no celular tem ORIENTATION 90/270.
        val rotation = if (hasOrientation) c.getInt(10) else 0
        val sideways = rotation == 90 || rotation == 270
        result += mapOf(
          "id" to rowId.toString(),
          "uri" to ContentUris.withAppendedId(collection, rowId).toString(),
          "title" to (c.getString(1)?.takeIf { it.isNotBlank() } ?: c.getString(2) ?: "Vídeo"),
          "fileName" to c.getString(2),
          "duration" to c.getLong(3).toDouble(),
          "size" to c.getLong(4).toDouble(),
          "width" to if (sideways) c.getInt(6) else c.getInt(5),
          "height" to if (sideways) c.getInt(5) else c.getInt(6),
          "path" to path,
          "folder" to path?.let { File(it).parent },
          "dateAdded" to c.getLong(8) * 1000.0,
          "mime" to c.getString(9)
        )
      }
    }
    return result
  }

  /**
   * Capa do álbum salva em cache como JPEG; devolve a URI `file://` ou null se não houver capa.
   * Tenta a miniatura do álbum e, se falhar, a imagem embutida na própria faixa.
   */
  fun artwork(context: Context, albumId: String, trackUri: String?, size: Int): String? {
    val dir = File(context.cacheDir, "artwork").apply { mkdirs() }
    val out = File(dir, "a_${albumId}_$size.jpg")
    val none = File(dir, "a_${albumId}_$size.none")
    if (out.exists()) return Uri.fromFile(out).toString()
    if (none.exists()) return null

    val bitmap = albumThumbnail(context, albumId, size) ?: trackUri?.let { embeddedArt(context, Uri.parse(it), size) }
    if (bitmap == null) {
      none.createNewFile()
      return null
    }
    save(bitmap, out)
    return Uri.fromFile(out).toString()
  }

  fun videoThumbnail(context: Context, videoId: String, size: Int): String? {
    val dir = File(context.cacheDir, "thumbs").apply { mkdirs() }
    val out = File(dir, "v_${videoId}_$size.jpg")
    if (out.exists()) return Uri.fromFile(out).toString()
    val id = videoId.toLongOrNull() ?: return null
    val bitmap = runCatching {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        context.contentResolver.loadThumbnail(
          ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, id), Size(size, size * 9 / 16), null
        )
      } else {
        @Suppress("DEPRECATION")
        MediaStore.Video.Thumbnails.getThumbnail(context.contentResolver, id, MediaStore.Video.Thumbnails.MINI_KIND, null)
      }
    }.getOrNull() ?: return null
    save(bitmap, out)
    return Uri.fromFile(out).toString()
  }

  /** Apaga capas e miniaturas em cache (ex.: depois de trocar a capa de um álbum). */
  fun clearCache(context: Context) {
    File(context.cacheDir, "artwork").deleteRecursively()
    File(context.cacheDir, "thumbs").deleteRecursively()
  }

  private fun albumThumbnail(context: Context, albumId: String, size: Int): Bitmap? {
    val id = albumId.toLongOrNull() ?: return null
    return runCatching {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        context.contentResolver.loadThumbnail(
          ContentUris.withAppendedId(MediaStore.Audio.Albums.EXTERNAL_CONTENT_URI, id), Size(size, size), null
        )
      } else {
        @Suppress("DEPRECATION")
        context.contentResolver.query(
          MediaStore.Audio.Albums.EXTERNAL_CONTENT_URI,
          arrayOf(MediaStore.Audio.Albums.ALBUM_ART),
          "${MediaStore.Audio.Albums._ID} = ?",
          arrayOf(albumId),
          null
        )?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
          ?.let { path -> decodeScaled(File(path).readBytes(), size) }
      }
    }.getOrNull()
  }

  private fun embeddedArt(context: Context, uri: Uri, size: Int): Bitmap? = runCatching {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(context, uri)
      retriever.embeddedPicture?.let { decodeScaled(it, size) }
    } finally {
      retriever.release()
    }
  }.getOrNull()

  private fun decodeScaled(bytes: ByteArray, size: Int): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    var sample = 1
    while (bounds.outWidth / (sample * 2) >= size && bounds.outHeight / (sample * 2) >= size) sample *= 2
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
  }

  private fun save(bitmap: Bitmap, out: File) {
    val tmp = File(out.parentFile, out.name + ".tmp")
    FileOutputStream(tmp).use { bitmap.compress(Bitmap.CompressFormat.JPEG, 88, it) }
    tmp.renameTo(out)
  }

  private fun known(value: String?): String? =
    value?.takeIf { it.isNotBlank() && it != MediaStore.UNKNOWN_STRING }

  private fun relativeFolder(relative: String?): String? = relative?.trimEnd('/')?.let { "/storage/emulated/0/$it" }

  private fun android.database.Cursor.getStringOrNull(index: Int): String? =
    if (index < 0 || isNull(index)) null else getString(index)
}
