package expo.modules.ritmocore

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import java.io.File
import java.util.UUID

/**
 * Downloads de links diretos pelo DownloadManager do Android: continua com o app fechado, mostra a
 * notificação do sistema e baixa para a pasta do app. Quando termina, o JS salva na biblioteca (ou
 * converte em áudio) e apaga o temporário.
 */
object Downloads {
  private fun manager(context: Context) = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager

  fun start(context: Context, url: String, fileName: String, mime: String?, title: String): Long {
    val name = MediaSaver.sanitize(fileName)
    val request = DownloadManager.Request(Uri.parse(url))
      .setTitle(title)
      .setDescription("Player Downloader")
      .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
      .setAllowedOverMetered(true)
      .setAllowedOverRoaming(true)
      .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, "ritmo/${UUID.randomUUID()}/$name")
      .addRequestHeader("User-Agent", "PlayerDownloader/1.5 (Android)")
    mime?.takeIf { it.contains('/') }?.let { request.setMimeType(it) }
    return manager(context).enqueue(request)
  }

  fun query(context: Context, ids: List<Long>): List<Map<String, Any?>> {
    if (ids.isEmpty()) return emptyList()
    val out = ArrayList<Map<String, Any?>>()
    manager(context).query(DownloadManager.Query().setFilterById(*ids.toLongArray()))?.use { c ->
      val idCol = c.getColumnIndexOrThrow(DownloadManager.COLUMN_ID)
      val statusCol = c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)
      val doneCol = c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)
      val totalCol = c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)
      val reasonCol = c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON)
      val localCol = c.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI)
      val mimeCol = c.getColumnIndexOrThrow(DownloadManager.COLUMN_MEDIA_TYPE)
      while (c.moveToNext()) {
        val status = when (c.getInt(statusCol)) {
          DownloadManager.STATUS_PENDING -> "pending"
          DownloadManager.STATUS_RUNNING -> "running"
          DownloadManager.STATUS_PAUSED -> "paused"
          DownloadManager.STATUS_SUCCESSFUL -> "done"
          else -> "failed"
        }
        out += mapOf(
          "id" to c.getLong(idCol).toString(),
          "status" to status,
          "bytes" to c.getLong(doneCol).toDouble(),
          "total" to c.getLong(totalCol).toDouble(),
          "reason" to c.getInt(reasonCol),
          "localUri" to c.getString(localCol),
          "mime" to c.getString(mimeCol)
        )
      }
    }
    return out
  }

  /** Cancela (ou tira da lista do sistema) e apaga o arquivo baixado. */
  fun cancel(context: Context, id: Long) {
    val dir = (query(context, listOf(id)).firstOrNull()?.get("localUri") as? String)?.let { Uri.parse(it).path }?.let { File(it).parentFile }
    manager(context).remove(id)
    // A pasta única do download (ritmo/<uuid>/) sai junto, se ficou vazia.
    if (dir != null && dir.name.length == 36 && dir.list()?.isEmpty() == true) dir.delete()
  }

  /** Apaga um arquivo temporário da pasta do app (só dentro dela). */
  fun deleteLocal(context: Context, uri: String): Boolean {
    val path = Uri.parse(uri).path ?: return false
    val file = File(path)
    // Só temporários (downloads e cache); nunca a área interna, onde fica a pasta privada.
    val allowed = listOfNotNull(context.getExternalFilesDir(null), context.cacheDir).map { it.canonicalPath }
    if (allowed.none { file.canonicalPath.startsWith(it + File.separator) }) return false
    val parent = file.parentFile
    val deleted = file.delete()
    // Apaga também a pasta única do download, se ficou vazia.
    if (parent != null && parent.name.length == 36 && parent.list()?.isEmpty() == true) parent.delete()
    return deleted
  }
}
