import CarPlay
import Foundation
import UIKit

/**
 * CarPlay (o "Android Auto" do iPhone): quatro abas — Início (aleatório, recentes, curtidas), Playlists,
 * Álbuns e Artistas — com os mesmos dados do Android Auto. Tocar uma música faz a lista dela virar a fila.
 *
 * Só aparece no carro quando o app é gerado com `carPlay: true` no plugin `withRitmoIos` (que adiciona a cena
 * e o entitlement `com.apple.developer.carplay-audio`, que a Apple precisa aprovar para a conta).
 */
@objc(RitmoCarPlaySceneDelegate)
public final class RitmoCarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
  public func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene, didConnect interfaceController: CPInterfaceController) {
    CarPlayController.shared.connect(interfaceController)
  }

  public func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didDisconnectInterfaceController interfaceController: CPInterfaceController
  ) {
    CarPlayController.shared.disconnect()
  }
}

final class CarPlayController {
  static let shared = CarPlayController()

  private var interface: CPInterfaceController?
  private var tabs: CPTabBarTemplate?

  func connect(_ controller: CPInterfaceController) {
    interface = controller
    let tabBar = CPTabBarTemplate(templates: placeholderTabs())
    tabs = tabBar
    controller.setRootTemplate(tabBar, animated: false, completion: nil)
    reload()
  }

  func disconnect() {
    interface = nil
    tabs = nil
  }

  /// Refaz as abas (dados novos do app ou biblioteca mudou). Não faz nada sem carro conectado.
  func reload() {
    guard interface != nil else { return }
    Task {
      let tracks = await BrowseCatalog.tracks()
      await MainActor.run { self.build(with: tracks) }
    }
  }

  // MARK: - Abas

  private func placeholderTabs() -> [CPListTemplate] {
    [
      tab(BrowseCatalog.label("home"), "house.fill", items: []),
      tab(BrowseCatalog.label("playlists"), "music.note.list", items: []),
      tab(BrowseCatalog.label("albums"), "square.stack.fill", items: []),
      tab(BrowseCatalog.label("artists"), "music.mic", items: []),
    ]
  }

  private func build(with tracks: [BrowseCatalog.Track]) {
    guard let tabs else { return }
    let d = BrowseCatalog.data()
    let byId = Dictionary(tracks.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    let pick: ([String]) -> [BrowseCatalog.Track] = { ids in ids.compactMap { byId[$0] } }

    let shuffle = CPListItem(text: BrowseCatalog.label("shuffle"), detailText: nil, image: UIImage(systemName: "shuffle"))
    shuffle.handler = { [weak self] _, done in
      let all = tracks.shuffled()
      if !all.isEmpty { self?.play(all, from: 0) }
      done()
    }
    let recent = folderItem(BrowseCatalog.label("recent"), "clock.fill") { [weak self] in
      self?.pushList(BrowseCatalog.label("recent"), pick(d.recent))
    }
    let liked = folderItem(BrowseCatalog.label("liked"), "heart.fill") { [weak self] in
      self?.pushList(BrowseCatalog.label("liked"), pick(d.liked))
    }

    let playlists = d.playlists.map { p in
      folderItem(p.name, "music.note.list") { [weak self] in self?.pushList(p.name, pick(p.trackIds)) }
    }

    let unknownAlbum = BrowseCatalog.label("unknownAlbum")
    let unknownArtist = BrowseCatalog.label("unknownArtist")
    let albums = Dictionary(grouping: tracks, by: \.albumId).values
      .map { list -> (String, [BrowseCatalog.Track]) in
        (list.first?.album ?? unknownAlbum, list.sorted(by: CarPlayController.trackOrder))
      }
      .sorted { $0.0.localizedCaseInsensitiveCompare($1.0) == .orderedAscending }
      .map { name, list in
        folderItem(name, "square.stack.fill", detail: list.first?.artist ?? unknownArtist) { [weak self] in self?.pushList(name, list) }
      }

    let artists = Dictionary(grouping: tracks, by: \.artistId).values
      .map { list -> (String, [BrowseCatalog.Track]) in
        (list.first?.artist ?? unknownArtist, list.sorted(by: CarPlayController.artistOrder))
      }
      .sorted { $0.0.localizedCaseInsensitiveCompare($1.0) == .orderedAscending }
      .map { name, list in folderItem(name, "music.mic") { [weak self] in self?.pushList(name, list) } }

    let templates = tabs.templates.compactMap { $0 as? CPListTemplate }
    guard templates.count == 4 else { return }
    update(templates[0], title: BrowseCatalog.label("home"), items: [shuffle, recent, liked])
    update(templates[1], title: BrowseCatalog.label("playlists"), items: playlists)
    update(templates[2], title: BrowseCatalog.label("albums"), items: albums)
    update(templates[3], title: BrowseCatalog.label("artists"), items: artists)
  }

  /// Ordem das faixas de um álbum (número da faixa, depois título).
  static func trackOrder(_ a: BrowseCatalog.Track, _ b: BrowseCatalog.Track) -> Bool {
    if a.trackNumber != b.trackNumber { return a.trackNumber < b.trackNumber }
    return a.title.localizedCaseInsensitiveCompare(b.title) == .orderedAscending
  }

  /// Ordem das faixas de um artista (álbum, depois a ordem do álbum).
  static func artistOrder(_ a: BrowseCatalog.Track, _ b: BrowseCatalog.Track) -> Bool {
    let x = a.album ?? ""
    let y = b.album ?? ""
    if x != y { return x.localizedCaseInsensitiveCompare(y) == .orderedAscending }
    return trackOrder(a, b)
  }

  private func tab(_ title: String, _ symbol: String, items: [CPListItem]) -> CPListTemplate {
    let template = CPListTemplate(title: title, sections: [CPListSection(items: items)])
    template.tabTitle = title
    template.tabImage = UIImage(systemName: symbol)
    return template
  }

  private func update(_ template: CPListTemplate, title: String, items: [CPListItem]) {
    template.tabTitle = title
    template.updateSections([CPListSection(items: Array(items.prefix(limit)))])
  }

  private var limit: Int { max(1, Int(CPListTemplate.maximumItemCount)) }

  private func folderItem(_ title: String, _ symbol: String, detail: String? = nil, open: @escaping () -> Void) -> CPListItem {
    let item = CPListItem(text: title, detailText: detail, image: UIImage(systemName: symbol))
    item.accessoryType = .disclosureIndicator
    item.handler = { _, done in
      open()
      done()
    }
    return item
  }

  private func pushList(_ title: String, _ tracks: [BrowseCatalog.Track]) {
    guard let interface else { return }
    let unknownArtist = BrowseCatalog.label("unknownArtist")
    let items = tracks.prefix(limit).enumerated().map { index, track -> CPListItem in
      let item = CPListItem(text: track.title, detailText: track.artist ?? unknownArtist)
      item.handler = { [weak self] _, done in
        self?.play(tracks, from: index)
        done()
      }
      return item
    }
    let list = CPListTemplate(title: title, sections: [CPListSection(items: items)])
    interface.pushTemplate(list, animated: true, completion: nil)
  }

  private func play(_ tracks: [BrowseCatalog.Track], from index: Int) {
    RitmoPlayer.shared.setQueue(tracks.map(BrowseCatalog.entry), startIndex: index, positionMs: 0, play: true)
    // O CarPlay recusa empilhar um template que já está na pilha.
    guard let interface, !interface.templates.contains(where: { $0 === CPNowPlayingTemplate.shared }) else { return }
    interface.pushTemplate(CPNowPlayingTemplate.shared, animated: true, completion: nil)
  }
}
