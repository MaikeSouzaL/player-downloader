const { withEntitlementsPlist, withInfoPlist, withXcodeProject } = require('expo/config-plugins');

/**
 * Ajustes do iOS que o app.json não cobre.
 *
 * `carPlay: true` liga o CarPlay: adiciona a cena do CarPlay ao Info.plist (o template do SDK 58 já usa cenas)
 * e o entitlement `com.apple.developer.carplay-audio`. Só ligue depois que a Apple aprovar o CarPlay para a
 * conta de desenvolvedor — sem a aprovação o perfil de assinatura não tem esse entitlement e o build falha.
 */
const CARPLAY_ROLE = 'CPTemplateApplicationSceneSessionRoleApplication';

function withCarPlay(config) {
  config = withInfoPlist(config, (cfg) => {
    const plist = cfg.modResults;
    const manifest = plist.UIApplicationSceneManifest ?? {};
    const configurations = manifest.UISceneConfigurations ?? {};
    // O template do SDK 58 já traz a cena da janela do app; garante que ela exista para não abrir com tela preta.
    if (!configurations.UIWindowSceneSessionRoleApplication) {
      configurations.UIWindowSceneSessionRoleApplication = [
        {
          UISceneConfigurationName: 'Default Configuration',
          UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
        },
      ];
    }
    configurations[CARPLAY_ROLE] = [
      {
        UISceneClassName: 'CPTemplateApplicationScene',
        UISceneConfigurationName: 'CarPlay',
        UISceneDelegateClassName: 'RitmoCarPlaySceneDelegate',
      },
    ];
    manifest.UISceneConfigurations = configurations;
    // A cena do CarPlay só conecta com várias cenas habilitadas.
    manifest.UIApplicationSupportsMultipleScenes = true;
    plist.UIApplicationSceneManifest = manifest;
    return cfg;
  });
  return withEntitlementsPlist(config, (cfg) => {
    cfg.modResults['com.apple.developer.carplay-audio'] = true;
    return cfg;
  });
}

/**
 * O app fica em pé, mas o player de vídeo gira para paisagem (expo-screen-orientation). No iOS só dá para girar
 * para orientações listadas no Info.plist, e o `orientation: "portrait"` do app.json deixa só retrato.
 * A trava em retrato na abertura vem do plugin do expo-screen-orientation (`initialOrientation`).
 */
function withVideoRotation(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.UISupportedInterfaceOrientations = [
      'UIInterfaceOrientationPortrait',
      'UIInterfaceOrientationLandscapeLeft',
      'UIInterfaceOrientationLandscapeRight',
    ];
    cfg.modResults['UISupportedInterfaceOrientations~ipad'] = [
      'UIInterfaceOrientationPortrait',
      'UIInterfaceOrientationPortraitUpsideDown',
      'UIInterfaceOrientationLandscapeLeft',
      'UIInterfaceOrientationLandscapeRight',
    ];
    return cfg;
  });
}

/**
 * Servidor de downloads na rede local (http://192.168.x.x:8787): o ATS do iOS bloqueia HTTP.
 * `NSAllowsLocalNetworking` libera endereços locais, mas no iOS 17+ um IP puro também precisa
 * estar em `NSExceptionDomains` — daí as três faixas privadas. O texto abaixo é o aviso que o
 * iOS mostra na primeira conexão com o PC.
 */
const PRIVATE_RANGES = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];

function withLocalServer(config) {
  return withInfoPlist(config, (cfg) => {
    const current = cfg.modResults.NSAppTransportSecurity ?? {};
    cfg.modResults.NSAppTransportSecurity = {
      ...current,
      NSAllowsLocalNetworking: true,
      // Navegador interno: sites http comuns abrem dentro do WebView (só nele, não no resto do app).
      NSAllowsArbitraryLoadsInWebContent: true,
      NSExceptionDomains: {
        ...(current.NSExceptionDomains ?? {}),
        ...Object.fromEntries(
          PRIVATE_RANGES.map((range) => [range, { NSExceptionAllowsInsecureHTTPLoads: true, NSIncludesSubdomains: false }])
        ),
      },
    };
    cfg.modResults.NSLocalNetworkUsageDescription =
      'O Player Downloader baixa os vídeos do servidor que roda no seu computador, na mesma rede Wi-Fi.';
    return cfg;
  });
}

/**
 * O expo-widgets cria a extensão do widget com o nome do alvo ("ExpoWidgetsTarget"), que era o nome mostrado
 * dela. Troca pelo nome do app. Roda depois do plugin do widget (mods do mesmo tipo vão do último registrado
 * para o primeiro). Entre aspas: valor com espaço sem aspas no project.pbxproj quebra o CocoaPods.
 */
function withWidgetDisplayName(config) {
  return withXcodeProject(config, (cfg) => {
    const name = `"${cfg.name}"`;
    for (const entry of Object.values(cfg.modResults.pbxXCBuildConfigurationSection())) {
      const settings = entry && typeof entry === 'object' ? entry.buildSettings : undefined;
      const plist = typeof settings?.INFOPLIST_FILE === 'string' ? settings.INFOPLIST_FILE.replace(/"/g, '') : '';
      if (plist.startsWith('ExpoWidgetsTarget/')) settings.INFOPLIST_KEY_CFBundleDisplayName = name;
    }
    return cfg;
  });
}

module.exports = function withRitmoIos(config, { carPlay = false } = {}) {
  config = withVideoRotation(config);
  config = withWidgetDisplayName(config);
  config = withLocalServer(config);
  if (carPlay) config = withCarPlay(config);
  return config;
};
