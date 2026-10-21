package expo.modules.ritmocore

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns

/**
 * "Compartilhar" e "Abrir com" vindos de outros apps (WhatsApp, Telegram, Arquivos, navegador).
 * Converte o Intent no formato que o JS entende e marca como lido, para não abrir de novo
 * quando a Activity for recriada.
 */
object ShareIntents {
  private const val CONSUMED = "expo.modules.ritmocore.SHARE_CONSUMED"

  fun parse(context: Context, intent: Intent?): Map<String, Any?>? =
    try {
      parseUnsafe(context, intent)
    } catch (e: Exception) {
      // Intent malformado de outro app: ignora (não pode derrubar o app).
      null
    }

  private fun parseUnsafe(context: Context, intent: Intent?): Map<String, Any?>? {
    intent ?: return null
    if (intent.getBooleanExtra(CONSUMED, false)) return null
    // Reaberto pela tela de recentes: o Intent antigo volta sem a marca de lido.
    if ((intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return null
    val uris = mutableListOf<Uri>()
    var text: String? = null
    when (intent.action) {
      Intent.ACTION_SEND -> {
        text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
        stream(intent)?.let { uris += it }
      }
      Intent.ACTION_SEND_MULTIPLE -> uris += streams(intent)
      Intent.ACTION_VIEW -> {
        val data = intent.data ?: return null
        if (data.scheme == "http" || data.scheme == "https") {
          // "Abrir com o Player Downloader" em um link do YouTube (filtro VIEW do manifesto).
          text = data.toString()
        } else {
          // Só content://: file:// de outro app poderia apontar para os arquivos internos do app.
          if (data.scheme != "content") return null
          uris += data
        }
      }
      else -> return null
    }
    uris.retainAll { it.scheme == "content" }
    if (uris.isEmpty() && text.isNullOrBlank()) return null
    intent.putExtra(CONSUMED, true)
    return mapOf(
      "text" to text,
      "subject" to intent.getStringExtra(Intent.EXTRA_SUBJECT),
      "items" to uris.map { describe(context, it, intent.type) }
    )
  }

  private fun describe(context: Context, uri: Uri, fallbackMime: String?): Map<String, Any?> {
    var name: String? = null
    var size = -1L
    runCatching {
      context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
        if (c.moveToFirst()) {
          name = c.getString(0)
          if (!c.isNull(1)) size = c.getLong(1)
        }
      }
    }
    val mime = runCatching { context.contentResolver.getType(uri) }.getOrNull()
      ?: fallbackMime?.takeIf { !it.endsWith("/*") }
      ?: MediaSaver.guessMime(name ?: uri.lastPathSegment ?: "")
    return mapOf(
      "uri" to uri.toString(),
      "name" to (name ?: uri.lastPathSegment ?: "arquivo"),
      "size" to size.toDouble(),
      "mime" to mime
    )
  }

  private fun stream(intent: Intent): Uri? =
    if (Build.VERSION.SDK_INT >= 33) {
      intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
    } else {
      @Suppress("DEPRECATION")
      intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri
    }

  private fun streams(intent: Intent): List<Uri> =
    if (Build.VERSION.SDK_INT >= 33) {
      intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java) ?: emptyList()
    } else {
      @Suppress("DEPRECATION")
      intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM) ?: emptyList()
    }
}
