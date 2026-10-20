import Foundation

/// Crash nativo (exceção Objective-C, inclusive as do UIKit e do AVFoundation): grava a pilha na hora e o
/// JS manda para o relatório na próxima abertura (`takeLastCrash`). Erros fatais do Swift viram sinais do
/// sistema e não passam por aqui — gravar arquivo dentro de um sinal não é seguro.
enum CrashCatcher {
  private static var previous: NSUncaughtExceptionHandler?
  private static var installed = false

  static var fileURL: URL {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    return base.appendingPathComponent("ultimo-crash.txt")
  }

  static func install() {
    guard !installed else { return }
    installed = true
    try? FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    previous = NSGetUncaughtExceptionHandler()
    NSSetUncaughtExceptionHandler { exception in
      let text = "\(exception.name.rawValue): \(exception.reason ?? "")\n" + exception.callStackSymbols.joined(separator: "\n")
      try? String(text.prefix(12_000)).write(to: CrashCatcher.fileURL, atomically: true, encoding: .utf8)
      CrashCatcher.previous?(exception)
    }
  }

  /// O crash da última vez (e apaga, para não mandar de novo).
  static func take() -> String? {
    let url = fileURL
    guard let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
    try? FileManager.default.removeItem(at: url)
    return text.isEmpty ? nil : text
  }
}
