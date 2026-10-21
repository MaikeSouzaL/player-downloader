import UIKit
import UniformTypeIdentifiers

/// "Compartilhar › Player Downloader" no iPhone (YouTube, Instagram, Safari, qualquer app): pega o link e abre o
/// Player Downloader direto na tela de escolher vídeo/áudio e qualidade (`ritmo://grab?url=…`).
/// Se o iOS não deixar abrir o app, guarda o link no App Group (o app pega ao abrir) e copia
/// para a área de transferência, com um aviso.
///
/// Gerado pelo plugin `plugins/withRitmoShareExtension.js` — edite o modelo em `plugins/ritmo-share/`.
final class ShareViewController: UIViewController {
  private let scheme = "{{SCHEME}}"
  private let group = "{{GROUP}}"
  private let pendingKey = "ritmo.pendingShare"
  private var handled = false

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard !handled else { return }
    handled = true
    findLink { [weak self] link in
      DispatchQueue.main.async { self?.handle(link) }
    }
  }

  // MARK: - O link

  private func handle(_ link: URL?) {
    guard let link else {
      show(Strings.noLink)
      return
    }
    // Codifica tudo que não é letra/número: um "+" ou "&" do link não pode virar outra coisa no app.
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
    guard let encoded = link.absoluteString.addingPercentEncoding(withAllowedCharacters: allowed),
      let target = URL(string: "\(scheme)://grab?url=\(encoded)")
    else {
      fallback(link)
      return
    }
    openContainingApp(target) { [weak self] opened in
      guard let self else { return }
      if opened {
        self.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
      } else {
        self.fallback(link)
      }
    } late: { [weak self] in
      // O sistema confirmou a abertura depois do prazo: o link guardado não é mais necessário.
      guard let self else { return }
      UserDefaults(suiteName: self.group)?.removeObject(forKey: self.pendingKey)
      self.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }
  }

  /// Não deu para abrir o app: guarda para a próxima abertura e copia o link.
  private func fallback(_ link: URL) {
    UserDefaults(suiteName: group)?.set(link.absoluteString, forKey: pendingKey)
    UIPasteboard.general.string = link.absoluteString
    show(Strings.copied)
  }

  private func findLink(_ done: @escaping (URL?) -> Void) {
    let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
    let providers = items.flatMap { $0.attachments ?? [] }
    let itemText = items.compactMap { $0.attributedContentText?.string }.joined(separator: " ")
    // Texto compartilhado (ou o que veio no próprio item, sem anexo): o primeiro link http(s).
    let fromText: () -> Void = {
      if let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) }) {
        provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, _ in
          done(Self.link(from: item) ?? Self.firstLink(in: itemText))
        }
      } else {
        done(Self.firstLink(in: itemText))
      }
    }
    if let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) }) {
      provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, _ in
        // Um "URL" que não é da web (ex.: youtube://) não serve: tenta o texto.
        if let link = Self.link(from: item) {
          done(link)
        } else {
          fromText()
        }
      }
      return
    }
    fromText()
  }

  private static func link(from item: NSSecureCoding?) -> URL? {
    if let url = item as? URL, url.scheme == "http" || url.scheme == "https" { return url }
    if let text = item as? String { return firstLink(in: text) }
    if let data = item as? Data, let text = String(data: data, encoding: .utf8) { return firstLink(in: text) }
    return nil
  }

  static func firstLink(in text: String) -> URL? {
    guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return nil }
    let range = NSRange(text.startIndex..., in: text)
    return detector.matches(in: text, options: [], range: range)
      .compactMap(\.url)
      .first { $0.scheme == "http" || $0.scheme == "https" }
  }

  // MARK: - Abrir o app

  /// Extensões não podem chamar `UIApplication.shared.open`; o caminho é achar o UIApplication na
  /// cadeia de responders e chamar `openURL:options:completionHandler:` pelo runtime.
  private func openContainingApp(_ url: URL, completion: @escaping (Bool) -> Void, late: @escaping () -> Void) {
    let selector = NSSelectorFromString("openURL:options:completionHandler:")
    var responder: UIResponder? = self
    while let current = responder {
      if let application = current as? UIApplication, application.responds(to: selector) {
        typealias Open = @convention(c) (AnyObject, Selector, NSURL, NSDictionary, (@convention(block) (Bool) -> Void)?) -> Void
        let open = unsafeBitCast(application.method(for: selector), to: Open.self)
        var answered = false
        let finish: (Bool) -> Void = { success in
          DispatchQueue.main.async {
            guard !answered else {
              if success { late() }
              return
            }
            answered = true
            completion(success)
          }
        }
        open(application, selector, url as NSURL, NSDictionary(), { success in finish(success) })
        // Sem resposta do sistema: trata como não aberto (o link fica guardado e copiado).
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { finish(false) }
        return
      }
      responder = current.next
    }
    completion(false)
  }

  // MARK: - Aviso

  private func show(_ message: String) {
    let card = UIView()
    card.backgroundColor = .secondarySystemBackground
    card.layer.cornerRadius = 16
    card.translatesAutoresizingMaskIntoConstraints = false

    let label = UILabel()
    label.text = message
    label.numberOfLines = 0
    label.textAlignment = .center
    label.font = .preferredFont(forTextStyle: .body)
    label.translatesAutoresizingMaskIntoConstraints = false

    let button = UIButton(type: .system)
    button.setTitle(Strings.ok, for: .normal)
    button.titleLabel?.font = .preferredFont(forTextStyle: .headline)
    button.translatesAutoresizingMaskIntoConstraints = false
    button.addTarget(self, action: #selector(close), for: .touchUpInside)

    view.backgroundColor = UIColor.black.withAlphaComponent(0.25)
    view.addSubview(card)
    card.addSubview(label)
    card.addSubview(button)
    NSLayoutConstraint.activate([
      card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      card.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
      card.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),
      label.topAnchor.constraint(equalTo: card.topAnchor, constant: 20),
      label.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 20),
      label.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -20),
      button.topAnchor.constraint(equalTo: label.bottomAnchor, constant: 12),
      button.centerXAnchor.constraint(equalTo: card.centerXAnchor),
      button.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -12),
    ])
  }

  @objc private func close() {
    extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
  }
}

private enum Strings {
  static var lang: String { String(Locale.preferredLanguages.first?.prefix(2) ?? "pt").lowercased() }

  static var noLink: String {
    switch lang {
    case "es": return "No encontré un enlace en lo que compartiste."
    case "en": return "No link found in what you shared."
    default: return "Não achei um link no que você compartilhou."
    }
  }

  static var copied: String {
    switch lang {
    case "es": return "Enlace copiado. Abre Player Downloader y pégalo en Descargar de un sitio."
    case "en": return "Link copied. Open Player Downloader and paste it in Download from a site."
    default: return "Link copiado. Abra o Player Downloader e cole em Baixar de um site."
    }
  }

  static let ok = "OK"
}
