package expo.modules.ritmocore

import android.content.Context
import android.os.Build
import android.util.Log
import java.io.File

/**
 * Crash nativo (Kotlin/Java): grava a pilha num arquivo na hora do crash e deixa o Android seguir
 * normal. Na próxima abertura o JS lê (`takeLastCrash`) e manda para o relatório de erros.
 */
object CrashCatcher {
  private const val FILE = "ultimo-crash.txt"
  private const val MAX_CHARS = 12_000

  @Volatile private var installed = false

  fun install(context: Context) {
    if (installed) return
    synchronized(this) {
      if (installed) return
      installed = true
    }
    val app = context.applicationContext
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, error ->
      runCatching {
        val text = buildString {
          append(error.javaClass.name).append(": ").append(error.message ?: "").append('\n')
          append("thread: ").append(thread.name).append(" · Android ").append(Build.VERSION.RELEASE)
          append(" · ").append(Build.MANUFACTURER).append(' ').append(Build.MODEL).append('\n')
          append(Log.getStackTraceString(error))
        }
        File(app.filesDir, FILE).writeText(text.take(MAX_CHARS))
      }
      previous?.uncaughtException(thread, error)
    }
  }

  /** O crash da última vez (e apaga, para não mandar de novo). */
  fun take(context: Context): String? {
    val file = File(context.filesDir, FILE)
    if (!file.exists()) return null
    val text = runCatching { file.readText() }.getOrNull()
    file.delete()
    return text?.takeIf { it.isNotBlank() }
  }
}
