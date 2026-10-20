import AVFoundation
import Foundation

/**
 * Equalizador do iOS sobre o AVAudioUnitEQ do player: 10 bandas + reforço de graves (shelf em 100 Hz) e ganho.
 * Usa as mesmas unidades do Android (milibéis) e os mesmos nomes de preset, para o JS não precisar saber a diferença.
 * Os ajustes ficam no UserDefaults e valem mesmo quando a música começa pelo fone ou pelo CarPlay.
 */
enum Equalizer {
  static let bandCount = 10
  static let centers: [Float] = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
  static let minLevel = -1500
  static let maxLevel = 1500

  /// Mesmos nomes do equalizador do Android (o JS traduz); níveis em milibéis por banda.
  static let presets: [(name: String, levels: [Int])] = [
    ("Normal", [300, 100, 0, 0, 0, 0, 0, 0, 100, 300]),
    ("Classical", [500, 300, 300, 200, 0, 0, 0, 200, 300, 400]),
    ("Dance", [600, 500, 300, 0, 0, 200, 400, 400, 300, 0]),
    ("Flat", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    ("Folk", [300, 200, 0, 0, 0, 200, 300, 200, 100, 0]),
    ("Heavy Metal", [400, 400, 100, 300, 0, 0, 300, 400, 300, 200]),
    ("Hip Hop", [500, 400, 200, 300, 0, 0, 100, 0, 200, 300]),
    ("Jazz", [400, 300, 100, 200, -200, -200, 0, 100, 300, 400]),
    ("Pop", [-100, 0, 200, 400, 500, 400, 200, 0, -100, -100]),
    ("Rock", [500, 400, 300, 100, -100, -100, 100, 300, 400, 500]),
  ]

  private static var enabled = false
  private static var levels = [Int](repeating: 0, count: bandCount)
  private static var preset = -1
  private static var bass = 0
  private static var loudness = 0

  private static let key = "ritmo.equalizer"

  static func configure(_ eq: AVAudioUnitEQ) {
    for (i, band) in eq.bands.enumerated() {
      if i < bandCount {
        band.filterType = .parametric
        band.frequency = centers[i]
        band.bandwidth = 1.0
      } else {
        band.filterType = .lowShelf
        band.frequency = 100
      }
      band.gain = 0
      band.bypass = false
    }
    eq.globalGain = 0
    eq.bypass = true
  }

  static func info(_ eq: AVAudioUnitEQ) -> [String: Any] {
    [
      "available": true,
      "enabled": enabled,
      "minLevel": minLevel,
      "maxLevel": maxLevel,
      "bands": (0..<bandCount).map { ["index": $0, "centerHz": Int(centers[$0]), "level": levels[$0]] },
      "presets": presets.map { $0.name },
      "preset": preset,
      "bassBoostAvailable": true,
      "bassBoost": bass,
      "loudnessAvailable": true,
      "loudnessGain": loudness,
    ]
  }

  static func setEnabled(_ eq: AVAudioUnitEQ, _ value: Bool) {
    enabled = value
    apply(eq)
  }

  static func setBand(_ eq: AVAudioUnitEQ, band: Int, level: Int) {
    guard (0..<bandCount).contains(band) else { return }
    levels[band] = min(maxLevel, max(minLevel, level))
    preset = -1
    apply(eq)
  }

  static func usePreset(_ eq: AVAudioUnitEQ, _ index: Int) {
    guard presets.indices.contains(index) else { return }
    levels = presets[index].levels
    preset = index
    apply(eq)
  }

  /// 0..1000, como o BassBoost do Android (vira até +12 dB nos graves).
  static func setBass(_ eq: AVAudioUnitEQ, _ strength: Int) {
    bass = min(1000, max(0, strength))
    apply(eq)
  }

  /// Ganho em milibéis (0..1500).
  static func setLoudness(_ eq: AVAudioUnitEQ, _ gainMb: Int) {
    loudness = min(1500, max(0, gainMb))
    apply(eq)
  }

  static func restore(_ eq: AVAudioUnitEQ, enabled: Bool, levels: [Int]?, preset: Int, bass: Int, loudness: Int) {
    self.enabled = enabled
    self.preset = presets.indices.contains(preset) ? preset : -1
    if self.preset >= 0 {
      self.levels = presets[self.preset].levels
    } else if let levels, levels.count == bandCount {
      self.levels = levels.map { min(maxLevel, max(minLevel, $0)) }
    }
    self.bass = min(1000, max(0, bass))
    self.loudness = min(1500, max(0, loudness))
    apply(eq)
  }

  static func restoreSaved(into eq: AVAudioUnitEQ) {
    guard let saved = UserDefaults.standard.dictionary(forKey: key) else { return }
    enabled = saved["enabled"] as? Bool ?? false
    if let l = saved["levels"] as? [Int], l.count == bandCount { levels = l }
    preset = saved["preset"] as? Int ?? -1
    bass = saved["bass"] as? Int ?? 0
    loudness = saved["loudness"] as? Int ?? 0
    apply(eq, save: false)
  }

  private static func apply(_ eq: AVAudioUnitEQ, save: Bool = true) {
    for i in 0..<bandCount where i < eq.bands.count {
      eq.bands[i].gain = Float(levels[i]) / 100
    }
    if eq.bands.count > bandCount { eq.bands[bandCount].gain = Float(bass) / 1000 * 12 }
    eq.globalGain = Float(loudness) / 100
    eq.bypass = !enabled
    if save {
      UserDefaults.standard.set(
        ["enabled": enabled, "levels": levels, "preset": preset, "bass": bass, "loudness": loudness],
        forKey: key
      )
    }
  }
}
