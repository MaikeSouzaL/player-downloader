package expo.modules.ritmocore

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.media3.common.C
import androidx.media3.common.Player
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

  fun attach(player: ExoPlayer) {
    this.player = player
    // Timer "fim da faixa" ligado antes do serviço existir vale para o player novo.
    if (endOfTrack) player.pauseAtEndOfMediaItems = true
    applyTuning()
  }

  fun detach(player: ExoPlayer) {
    if (this.player === player) {
      cancelSleepTimer()
      main.removeCallbacks(transitionTick)
      FloatingBubble.hide()
      this.player = null
    }
  }

  // ------------------------------------------------------------ volume

  // O volume final é o produto das três partes; cada uma mexe só no seu fator.
  private var sleepFactor = 1f
  private var fadeFactor = 1f
  private var gainFactor = 1f

  private fun applyVolume() {
    player?.volume = (sleepFactor * fadeFactor * gainFactor).coerceIn(0f, 1f)
  }

  // ------------------------------------------------------------ ajustes (transição, silêncio, ReplayGain)

  private var gainTags: Map<String, String> = emptyMap()

  /** Aplica PlaybackTuning.current no player (chamado ao ligar o serviço e quando o JS muda os ajustes). */
  fun applyTuning() {
    val p = player ?: return
    val tuning = PlaybackTuning.current
    p.skipSilenceEnabled = tuning.skipSilence
    gainFactor = ReplayGain.factor(ReplayGain.pick(gainTags, tuning.replayGain), tuning.preampDb)
    if (tuning.crossfadeMs <= 0) {
      fadingIn = false
      fadeFactor = 1f
    }
    applyVolume()
    scheduleTransition()
  }

  /** Tags de volume da faixa que começou (o serviço lê dos metadados do media3). */
  fun onGainTags(tags: Map<String, String>) {
    gainTags = tags
    val tuning = PlaybackTuning.current
    gainFactor = ReplayGain.factor(ReplayGain.pick(tags, tuning.replayGain), tuning.preampDb)
    applyVolume()
  }

  // ------------------------------------------------------------ transição suave

  private var fadingIn = false
  private var fadeInStart = 0L
  /** Duração da subida atual: a transição inteira no fim da música, curta quando a troca foi na mão. */
  private var fadeInMs = 0L

  fun onPlayingChanged() = scheduleTransition()

  private fun startFadeIn(durationMs: Long) {
    fadingIn = true
    fadeInStart = SystemClock.elapsedRealtime()
    fadeInMs = durationMs.coerceAtLeast(1L)
    fadeFactor = 0f
    applyVolume()
    scheduleTransition()
  }

  // Troca na mão pelo app (próxima, anterior, tocar outra da fila): abaixa rápido, troca e sobe de novo.
  private var manualAction: (() -> Unit)? = null
  private var manualStart = 0L
  private var manualFrom = 1f

  /**
   * Com a transição ligada e tocando, a troca de música pedida pelo app sai com fade: 0,35 s abaixando,
   * a troca, e a música nova (ou a mesma, no "voltar ao começo") entra subindo. Sem transição, troca na hora.
   */
  fun fadeOutThen(action: () -> Unit) {
    val p = player
    if (p == null || PlaybackTuning.current.crossfadeMs <= 0 || !p.isPlaying) {
      action()
      return
    }
    // Dois toques seguidos em "próxima": a primeira troca acontece na hora e o fade segue para a segunda.
    manualAction?.invoke()
    manualAction = action
    manualStart = SystemClock.elapsedRealtime()
    manualFrom = fadeFactor
    main.removeCallbacks(manualFade)
    main.post(manualFade)
  }

  private val manualFade = object : Runnable {
    override fun run() {
      val t = (SystemClock.elapsedRealtime() - manualStart).toFloat() / MANUAL_FADE_OUT_MS
      if (t < 1f) {
        fadeFactor = (manualFrom * (1f - t)).coerceIn(0f, 1f)
        applyVolume()
        main.postDelayed(this, MANUAL_STEP_MS)
        return
      }
      val action = manualAction
      manualAction = null
      action?.invoke()
      startFadeIn(minOf(PlaybackTuning.current.crossfadeMs, MANUAL_FADE_IN_MS))
    }
  }

  /**
   * Trocou de música. Se a anterior saiu abaixando o volume, a nova entra subindo; troca sem fade
   * (tocar outra música, álbum contínuo) entra direto no volume normal.
   */
  fun onTransition(reason: Int) {
    val ms = PlaybackTuning.current.crossfadeMs
    when {
      // O fade-out na mão ainda está correndo: a subida começa quando ele terminar.
      manualAction != null -> return
      ms <= 0 || reason == Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED -> {
        fadingIn = false
        fadeFactor = 1f
      }
      // Pulou na mão (notificação, fone, carro): a música nova entra subindo, curto.
      reason == Player.MEDIA_ITEM_TRANSITION_REASON_SEEK -> return startFadeIn(minOf(ms, MANUAL_FADE_IN_MS))
      fadeFactor < 0.98f -> return startFadeIn(ms)
      else -> {
        fadingIn = false
        fadeFactor = 1f
      }
    }
    applyVolume()
    scheduleTransition()
  }

  private fun scheduleTransition() {
    main.removeCallbacks(transitionTick)
    val p = player ?: return
    if (PlaybackTuning.current.crossfadeMs > 0 && (p.isPlaying || fadingIn)) main.post(transitionTick)
  }

  private val transitionTick = object : Runnable {
    override fun run() {
      val p = player ?: return
      val ms = PlaybackTuning.current.crossfadeMs
      if (ms <= 0) return
      // Fade-out na mão em andamento: ele cuida do volume.
      if (manualAction != null) return
      when {
        fadingIn -> {
          val t = (SystemClock.elapsedRealtime() - fadeInStart).toFloat() / fadeInMs
          if (t >= 1f) {
            fadingIn = false
            fadeFactor = 1f
          } else {
            fadeFactor = t.coerceIn(0f, 1f)
          }
        }
        p.isPlaying && shouldFadeOut(p, ms) -> fadeFactor = ((p.duration - p.currentPosition).toFloat() / ms).coerceIn(0f, 1f)
        // Voltou para trás na música ou o fim mudou: volume normal.
        else -> fadeFactor = 1f
      }
      applyVolume()
      if (!p.isPlaying && !fadingIn) return
      // Longe do fim, confere a cada 2 s no máximo (pular para perto do fim é visto rápido).
      val untilFade = if (p.duration == C.TIME_UNSET) TRANSITION_IDLE_MS else p.duration - p.currentPosition - ms
      val delay = if (fadingIn || fadeFactor < 1f) TRANSITION_STEP_MS else untilFade.coerceIn(TRANSITION_STEP_MS, TRANSITION_IDLE_MS)
      main.postDelayed(this, delay)
    }
  }

  private fun shouldFadeOut(p: ExoPlayer, ms: Long): Boolean {
    val duration = p.duration
    // Música curta (vinheta, faixa de 10 s) não ganha transição.
    if (duration == C.TIME_UNSET || duration < ms * 3) return false
    if (duration - p.currentPosition > ms) return false
    // Última da fila ou timer "fim da faixa": termina normalmente.
    if (endOfTrack || !p.hasNextMediaItem()) return false
    if (PlaybackTuning.current.gaplessAlbums && nextIsSameAlbum(p)) return false
    return true
  }

  /** Próxima faixa é do mesmo álbum (ou a mesma, no "repetir uma"): emenda sem fade. */
  private fun nextIsSameAlbum(p: ExoPlayer): Boolean {
    val next = p.nextMediaItemIndex
    if (next == C.INDEX_UNSET) return false
    if (next == p.currentMediaItemIndex) return true
    val album = p.currentMediaItem?.mediaMetadata?.albumTitle?.toString()
    return !album.isNullOrBlank() && album == p.getMediaItemAt(next).mediaMetadata.albumTitle?.toString()
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
    sleepAt = 0L
    endOfTrack = false
    if (sleepFactor != 1f) {
      sleepFactor = 1f
      applyVolume()
    }
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
        sleepAt = 0L
        sleepFactor = 1f
        applyVolume()
        onSleepTimer?.invoke(sleepState(fired = true))
        return
      }
      if (remaining <= FADE_MS && p != null) {
        // Abaixa o volume aos poucos nos últimos segundos, como o timer do Lark.
        sleepFactor = (remaining.toFloat() / FADE_MS).coerceIn(0f, 1f)
        applyVolume()
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
  private const val TRANSITION_STEP_MS = 100L
  private const val TRANSITION_IDLE_MS = 2_000L
  private const val MANUAL_FADE_OUT_MS = 350L
  private const val MANUAL_FADE_IN_MS = 1_000L
  private const val MANUAL_STEP_MS = 30L
}
