package expo.modules.ritmocore

import android.content.Context
import android.database.ContentObserver
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore

/**
 * Avisa quando músicas ou vídeos entram, saem ou mudam no aparelho (download terminou,
 * arquivo apagado, cartão SD montado). Junta rajadas de mudanças num aviso só.
 */
class LibraryObserver(private val context: Context, private val onChange: () -> Unit) {
  private val handler = Handler(Looper.getMainLooper())
  private val notify = Runnable { onChange() }
  private val observer = object : ContentObserver(handler) {
    override fun onChange(selfChange: Boolean, uri: Uri?) {
      handler.removeCallbacks(notify)
      handler.postDelayed(notify, DEBOUNCE_MS)
    }
  }
  private var registered = false

  fun start() {
    if (registered) return
    val resolver = context.contentResolver
    resolver.registerContentObserver(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, true, observer)
    resolver.registerContentObserver(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, true, observer)
    registered = true
  }

  fun stop() {
    if (!registered) return
    handler.removeCallbacks(notify)
    context.contentResolver.unregisterContentObserver(observer)
    registered = false
  }

  companion object {
    private const val DEBOUNCE_MS = 2_000L
  }
}
