package expo.modules.ritmocore

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.UUID

/**
 * Pasta privada: músicas e vídeos copiados para a área interna do app (que nenhum outro app, galeria ou
 * player enxerga; fora do backup do Android, ver allowBackup no app.json). O PIN / digital fica no JS.
 * Não é criptografia: protege de olhares, não de quem tem acesso root ao aparelho.
 */
object Vault {
  private val lock = Any()

  private fun dir(context: Context) = File(context.filesDir, "vault").apply { mkdirs() }
  private fun indexFile(context: Context) = File(dir(context), "index.json")

  /** Lê o índice. Índice ilegível é erro (não vira lista vazia, senão a próxima gravação apagaria tudo). */
  private fun read(context: Context): MutableList<JSONObject> {
    val file = indexFile(context)
    if (!file.exists()) return mutableListOf()
    val arr = try {
      JSONArray(file.readText())
    } catch (e: Exception) {
      throw IOException("Índice da pasta privada ilegível", e)
    }
    return MutableList(arr.length()) { arr.getJSONObject(it) }
  }

  private fun write(context: Context, items: List<JSONObject>) {
    val tmp = File(dir(context), "index.json.tmp")
    tmp.writeText(JSONArray(items).toString())
    val target = indexFile(context)
    if (!tmp.renameTo(target)) {
      // Alguns sistemas de arquivo não trocam por cima: copia e apaga o temporário.
      tmp.copyTo(target, overwrite = true)
      tmp.delete()
    }
  }

  private fun toMap(context: Context, o: JSONObject): Map<String, Any?> = mapOf(
    "id" to o.getString("id"),
    "uri" to Uri.fromFile(File(dir(context), o.getString("file"))).toString(),
    "name" to o.optString("name"),
    "title" to o.optString("title"),
    "artist" to o.optString("artist").ifEmpty { null },
    "album" to o.optString("album").ifEmpty { null },
    "duration" to o.optDouble("duration", 0.0),
    "kind" to o.optString("kind", "audio"),
    "mime" to o.optString("mime").ifEmpty { null },
    "size" to o.optDouble("size", 0.0),
    "addedAt" to o.optDouble("addedAt", 0.0)
  )

  /** Copia o arquivo para a pasta privada. Quem chama apaga o original (com a confirmação do Android). */
  fun add(context: Context, source: Uri, meta: Map<String, Any?>): Map<String, Any?> {
    val id = UUID.randomUUID().toString()
    val name = MediaSaver.sanitize(meta["name"] as? String ?: "arquivo")
    val ext = name.substringAfterLast('.', "").takeIf { it.isNotEmpty() && it.length <= 5 }?.let { ".$it" } ?: ""
    val file = File(dir(context), id + ext)
    // Confere o índice antes de copiar (não copia um arquivo grande à toa).
    synchronized(lock) { read(context) }
    // A cópia (que pode ser grande) fica fora da trava; o nome é único, ninguém disputa o arquivo.
    MediaSaver.copyToFile(context, source, file)
    val item = JSONObject().apply {
      put("id", id)
      put("file", file.name)
      put("name", name)
      put("title", meta["title"] as? String ?: name.substringBeforeLast('.'))
      put("artist", meta["artist"] as? String ?: "")
      put("album", meta["album"] as? String ?: "")
      put("duration", (meta["duration"] as? Number)?.toDouble() ?: 0.0)
      put("kind", if (meta["kind"] == "video") "video" else "audio")
      put("mime", meta["mime"] as? String ?: MediaSaver.guessMime(name))
      put("size", file.length().toDouble())
      put("addedAt", System.currentTimeMillis().toDouble())
    }
    try {
      synchronized(lock) {
        val items = read(context)
        items += item
        write(context, items)
      }
    } catch (e: Exception) {
      file.delete()
      throw e
    }
    return toMap(context, item)
  }

  fun list(context: Context): List<Map<String, Any?>> = synchronized(lock) { read(context).map { toMap(context, it) } }

  /** Devolve à biblioteca (Music/Player Downloader ou Movies/Player Downloader) e tira da pasta privada. */
  fun restore(context: Context, id: String): String = synchronized(lock) {
    val items = read(context)
    val item = items.firstOrNull { it.getString("id") == id } ?: throw IllegalArgumentException("Item não encontrado")
    val file = File(dir(context), item.getString("file"))
    // Salva uma cópia nova na biblioteca (nunca sobrescreve nada); só depois apaga daqui.
    val saved = MediaSaver.save(context, Uri.fromFile(file), item.optString("name"), item.optString("mime"), item.optString("kind"))
    write(context, items.filter { it.getString("id") != id })
    file.delete()
    saved.toString()
  }

  /** "Esqueci o PIN": apaga tudo, inclusive um índice ilegível. */
  fun wipe(context: Context) {
    synchronized(lock) { dir(context).listFiles()?.forEach { it.deleteRecursively() } }
  }

  fun delete(context: Context, id: String) = synchronized(lock) {
    val items = read(context)
    items.firstOrNull { it.getString("id") == id }?.let { File(dir(context), it.getString("file")).delete() }
    write(context, items.filter { it.getString("id") != id })
  }
}
