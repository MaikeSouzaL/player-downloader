package expo.modules.ritmocore

import android.content.Context
import android.content.SharedPreferences
import android.media.audiofx.BassBoost
import android.media.audiofx.Equalizer
import android.media.audiofx.LoudnessEnhancer
import android.util.Log

/**
 * Equalizador, reforço de graves e amplificação ligados à sessão de áudio do player.
 * Os ajustes ficam salvos em SharedPreferences: valem mesmo quando a música começa sem o app
 * aberto (fone Bluetooth, widget, retomada pela notificação).
 */
object AudioEffects {
  private const val TAG = "RitmoAudioEffects"
  private const val PREFS = "ritmo_effects"

  private var prefs: SharedPreferences? = null

  private var sessionId = 0
  private var equalizer: Equalizer? = null
  private var bassBoost: BassBoost? = null
  private var loudness: LoudnessEnhancer? = null

  var enabled = false
    private set
  private var bandLevels: ShortArray? = null
  private var preset: Int = -1
  private var bassStrength: Int = 0
  private var loudnessGainMb: Int = 0

  @Synchronized
  fun attach(context: Context, audioSessionId: Int) {
    release()
    if (prefs == null) {
      prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      load()
    }
    sessionId = audioSessionId
    equalizer = runCatching { Equalizer(0, audioSessionId) }.onFailure { Log.w(TAG, "Equalizer indisponível", it) }.getOrNull()
    bassBoost = runCatching { BassBoost(0, audioSessionId) }.onFailure { Log.w(TAG, "BassBoost indisponível", it) }.getOrNull()
    loudness = runCatching { LoudnessEnhancer(audioSessionId) }.onFailure { Log.w(TAG, "Loudness indisponível", it) }.getOrNull()
    apply()
  }

  @Synchronized
  fun release() {
    equalizer?.release()
    bassBoost?.release()
    loudness?.release()
    equalizer = null
    bassBoost = null
    loudness = null
  }

  @Synchronized
  fun info(): Map<String, Any?> {
    val eq = equalizer
    val bands = if (eq == null) emptyList() else (0 until eq.numberOfBands).map { i ->
      val band = i.toShort()
      mapOf(
        "index" to i,
        "centerHz" to eq.getCenterFreq(band) / 1000,
        "level" to (bandLevels?.getOrNull(i) ?: eq.getBandLevel(band)).toInt()
      )
    }
    val range = eq?.bandLevelRange
    val presets = if (eq == null) emptyList() else (0 until eq.numberOfPresets).map { eq.getPresetName(it.toShort()) }
    return mapOf(
      "available" to (eq != null),
      "enabled" to enabled,
      "minLevel" to (range?.get(0)?.toInt() ?: -1500),
      "maxLevel" to (range?.get(1)?.toInt() ?: 1500),
      "bands" to bands,
      "presets" to presets,
      "preset" to preset,
      "bassBoostAvailable" to (bassBoost?.strengthSupported == true),
      "bassBoost" to bassStrength,
      "loudnessAvailable" to (loudness != null),
      "loudnessGain" to loudnessGainMb
    )
  }

  @Synchronized
  fun setEnabled(value: Boolean) {
    enabled = value
    apply()
  }

  @Synchronized
  fun setBandLevel(band: Int, level: Int) {
    val eq = equalizer ?: return
    val levels = bandLevels ?: ShortArray(eq.numberOfBands.toInt()) { eq.getBandLevel(it.toShort()) }
    if (band !in levels.indices) return
    levels[band] = level.toShort()
    bandLevels = levels
    preset = -1
    apply()
  }

  @Synchronized
  fun usePreset(index: Int) {
    val eq = equalizer ?: return
    if (index !in 0 until eq.numberOfPresets) return
    runCatching {
      eq.usePreset(index.toShort())
      preset = index
      bandLevels = ShortArray(eq.numberOfBands.toInt()) { eq.getBandLevel(it.toShort()) }
      save()
    }.onFailure { Log.w(TAG, "Preset falhou", it) }
  }

  /** 0..1000 */
  @Synchronized
  fun setBassBoost(strength: Int) {
    bassStrength = strength.coerceIn(0, 1000)
    apply()
  }

  /** Ganho em milibéis (0..1500). */
  @Synchronized
  fun setLoudness(gainMb: Int) {
    loudnessGainMb = gainMb.coerceIn(0, 1500)
    apply()
  }

  /** Restaura os ajustes salvos pelo app (chamado na abertura). */
  @Synchronized
  fun restore(enabled: Boolean, levels: List<Int>?, preset: Int, bass: Int, loudnessGain: Int) {
    this.enabled = enabled
    this.preset = preset
    this.bandLevels = levels?.map { it.toShort() }?.toShortArray()
    this.bassStrength = bass.coerceIn(0, 1000)
    this.loudnessGainMb = loudnessGain.coerceIn(0, 1500)
    apply()
  }

  private fun load() {
    val p = prefs ?: return
    runCatching {
      enabled = p.getBoolean("enabled", false)
      preset = p.getInt("preset", -1)
      bandLevels = p.getString("levels", null)?.takeIf { it.isNotBlank() }?.split(',')?.map { it.trim().toInt().toShort() }?.toShortArray()
      bassStrength = p.getInt("bass", 0).coerceIn(0, 1000)
      loudnessGainMb = p.getInt("loudness", 0).coerceIn(0, 1500)
    }.onFailure { Log.w(TAG, "Ajustes salvos ilegíveis; usando o padrão", it) }
  }

  private fun save() {
    prefs?.edit()
      ?.putBoolean("enabled", enabled)
      ?.putInt("preset", preset)
      ?.putString("levels", bandLevels?.joinToString(",") ?: "")
      ?.putInt("bass", bassStrength)
      ?.putInt("loudness", loudnessGainMb)
      ?.apply()
  }

  private fun apply() {
    save()
    runCatching {
      equalizer?.let { eq ->
        val levels = bandLevels
        if (preset >= 0 && preset < eq.numberOfPresets) {
          eq.usePreset(preset.toShort())
        } else if (levels != null) {
          levels.forEachIndexed { i, level -> if (i < eq.numberOfBands) eq.setBandLevel(i.toShort(), level) }
        }
        eq.enabled = enabled
      }
      bassBoost?.let { bb ->
        if (bb.strengthSupported) bb.setStrength(bassStrength.toShort())
        bb.enabled = enabled && bassStrength > 0
      }
      loudness?.let { le ->
        le.setTargetGain(loudnessGainMb)
        le.enabled = enabled && loudnessGainMb > 0
      }
    }.onFailure { Log.w(TAG, "Falha ao aplicar efeitos na sessão $sessionId", it) }
  }
}
