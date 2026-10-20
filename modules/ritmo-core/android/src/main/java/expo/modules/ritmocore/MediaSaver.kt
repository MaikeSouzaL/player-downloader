package expo.modules.ritmocore

import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File
import java.io.IOException

/**
 * Salva um arquivo (recebido, baixado ou convertido) na biblioteca do aparelho: Music/Ritmo para áudio e
 * Movies/Ritmo para vídeo. No Android 10+ vai pelo MediaStore (sem permissão de escrita); antes disso fica
 * na pasta do app e é indexado pelo MediaScanner. Em todos os casos aparece em qualquer player.
 */
object MediaSaver {
  fun save(context: Context, source: Uri, name: String, mime: String?, kind: String): Uri {
    val isVideo = kind == "video"
    val safeName = sanitize(name)
    val type = mime?.takeIf { it.startsWith(if (isVideo) "video/" else "audio/") } ?: guessMime(safeName)
    val resolver = context.contentResolver

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val collection = if (isVideo) {
        MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
      } else {
        MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
      }
      val values = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, safeName)
        put(MediaStore.MediaColumns.MIME_TYPE, type)
        put(MediaStore.MediaColumns.RELATIVE_PATH, (if (isVideo) Environment.DIRECTORY_MOVIES else Environment.DIRECTORY_MUSIC) + "/Ritmo")
        put(MediaStore.MediaColumns.IS_PENDING, 1)
      }
      val target = resolver.insert(collection, values) ?: throw IOException("Não foi possível criar o arquivo na biblioteca")
      try {
        copy(context, source, target)
        values.clear()
        values.put(MediaStore.MediaColumns.IS_PENDING, 0)
        resolver.update(target, values, null, null)
      } catch (e: Exception) {
        runCatching { resolver.delete(target, null, null) }
        throw e
      }
      return target
    }

    val base = context.getExternalFilesDir(if (isVideo) Environment.DIRECTORY_MOVIES else Environment.DIRECTORY_MUSIC)
      ?: throw IOException("Armazenamento indisponível")
    val dir = File(base, "Ritmo").apply { mkdirs() }
    val file = unique(dir, safeName)
    try {
      (resolver.openInputStream(source) ?: throw IOException("Não foi possível ler o arquivo")).use { input ->
        file.outputStream().use { input.copyTo(it) }
      }
    } catch (e: Exception) {
      file.delete()
      throw e
    }
    MediaScannerConnection.scanFile(context, arrayOf(file.path), arrayOf(type), null)
    return Uri.fromFile(file)
  }

  fun copy(context: Context, source: Uri, target: Uri) {
    val resolver = context.contentResolver
    (resolver.openInputStream(source) ?: throw IOException("Não foi possível ler o arquivo")).use { input ->
      (resolver.openOutputStream(target) ?: throw IOException("Não foi possível gravar o arquivo")).use { output ->
        input.copyTo(output, 256 * 1024)
      }
    }
  }

  /** Copia para um arquivo; abre a origem antes e apaga o destino se a cópia falhar (ex.: sem espaço). */
  fun copyToFile(context: Context, source: Uri, target: File) {
    target.parentFile?.mkdirs()
    try {
      (context.contentResolver.openInputStream(source) ?: throw IOException("Não foi possível ler o arquivo")).use { input ->
        target.outputStream().use { input.copyTo(it, 256 * 1024) }
      }
    } catch (e: Exception) {
      target.delete()
      throw e
    }
  }

  fun sanitize(name: String): String {
    val clean = name.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]+"), "_").trim().trim('.')
    return clean.take(120).ifEmpty { "arquivo" }
  }

  private fun unique(dir: File, name: String): File {
    var file = File(dir, name)
    if (!file.exists()) return file
    val dot = name.lastIndexOf('.')
    val base = if (dot > 0) name.substring(0, dot) else name
    val ext = if (dot > 0) name.substring(dot) else ""
    var i = 2
    while (file.exists()) file = File(dir, "$base ($i)$ext").also { i++ }
    return file
  }

  fun guessMime(name: String): String =
    when (name.substringAfterLast('.', "").lowercase()) {
      "mp3" -> "audio/mpeg"
      "m4a", "aac" -> "audio/mp4"
      "ogg", "oga" -> "audio/ogg"
      "opus" -> "audio/opus"
      "flac" -> "audio/flac"
      "wav" -> "audio/wav"
      "amr" -> "audio/amr"
      "mp4", "m4v" -> "video/mp4"
      "mkv" -> "video/x-matroska"
      "webm" -> "video/webm"
      "3gp" -> "video/3gpp"
      "mov" -> "video/quicktime"
      else -> "application/octet-stream"
    }
}
