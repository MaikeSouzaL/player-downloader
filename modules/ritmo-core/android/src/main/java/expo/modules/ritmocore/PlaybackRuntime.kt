package expo.modules.ritmocore

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.media3.exoplayer.ExoPlayer

/**
 * Estado do player que vive enquanto o processo vive (não depende da parte JS do app).
 * O serviço registra o player aqui; o módulo JS só lê e manda comandos.
 * Tudo roda na thread principal.
 */
object PlaybackRuntime {
  private val main = Handler(Looper.getMainLooper())

  var player: ExoPlayer? = null
    private set

  /** Eventos para o JS (timer disparou, música pulada por erro). Null quando o JS não está ativo. */
  var onSleepTimer: ((Map<String, Any?>) -> Unit)? = null
  var onIssue: ((Map<String, Any?>) -> Unit)? = null

  private var sleepAt = 0L
  private var endOfTrack = false
  private var fading = false

  fun attach(player: ExoPlayer) {
    this.player = player
    // Timer "fim da faixa" ligado antes do serviço existir vale para o player novo.
    if (endOfTrack) player.pauseAtEndOfMediaItems = true
  }

  fun detach(player: ExoPlayer) {
    if (this.player === player) {
      cancelSleepTimer()
      this.player = null
    }
  }

  // ------------------------------------------------------------ timer

  /** minutos > 0: para depois desse tempo (com fade nos últimos segundos); endOfTrack: para ao fim da faixa. */
  fun setSleepTimer(minutes: Double, endOfTrack: Boolean): Map<String, Any?> {
    cancelSleepTimer()
    val p = player
    if (endOfTrack) {
      this.endOfTrack = true
      p?.pauseAtEndOfMediaItems = true
    } else if (minutes > 0) {
      val ms = (minutes * 60_000).toLong()
      sleepAt = SystemClock.elapsedRealtime() + ms
      main.postDelayed(tick, minOf(ms, TICK_MS))
    }
    return sleepState(fired = false)
  }

  fun cancelSleepTimer() {
    main.removeCallbacks(tick)
    if (endOfTrack) player?.pauseAtEndOfMediaItems = false
    if (fading) player?.volume = 1f
    sleepAt = 0L
    endOfTrack = false
    fading = false
  }

  fun sleepState(fired: Boolean): Map<String, Any?> = mapOf(
    "active" to (sleepAt > 0 || endOfTrack),
    "endOfTrack" to endOfTrack,
    "remainingMs" to (if (sleepAt > 0) (sleepAt - SystemClock.elapsedRealtime()).coerceAtLeast(0) else 0L).toDouble(),
    "fired" to fired
  )

  /** O serviço avisa quando o player pausou sozinho no fim da faixa (timer "fim da faixa"). */
  fun onPausedAtEndOfItem() {
    if (!endOfTrack) return
    cancelSleepTimer()
    onSleepTimer?.invoke(sleepState(fired = true))
  }

  private val tick = object : Runnable {
    override fun run() {
      val p = player
      val remaining = sleepAt - SystemClock.elapsedRealtime()
      if (sleepAt == 0L) return
      if (remaining <= 0) {
        p?.pause()
        p?.volume = 1f
        sleepAt = 0L
        fading = false
        onSleepTimer?.invoke(sleepState(fired = true))
        return
      }
      if (remaining <= FADE_MS && p != null) {
        // Abaixa o volume aos poucos nos últimos segundos, como o timer do Lark.
        fading = true
        p.volume = (remaining.toFloat() / FADE_MS).coerceIn(0f, 1f)
        main.postDelayed(this, FADE_STEP_MS)
      } else {
        main.postDelayed(this, minOf(remaining - FADE_MS, TICK_MS).coerceAtLeast(FADE_STEP_MS))
      }
    }
  }

  // ------------------------------------------------------------ problemas

  fun reportIssue(issue: Map<String, Any?>) {
    onIssue?.invoke(issue)
  }

  private const val TICK_MS = 30_000L
  private const val FADE_MS = 20_000L
  private const val FADE_STEP_MS = 250L
}
