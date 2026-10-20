const fs = require('fs');
const path = require('path');
const { withDangerousMod, withEntitlementsPlist, withInfoPlist, withXcodeProject } = require('expo/config-plugins');

/**
 * Extensão "Compartilhar" do iPhone (alvo RitmoShare): o Ritmo aparece no menu Compartilhar do
 * YouTube, Instagram, Safari etc. e abre a tela de escolher vídeo/áudio com o link.
 *
 * O alvo é criado com os mesmos ajudantes do expo-widgets: eles reaproveitam a fase
 * "Embed Foundation Extensions" que o widget já criou, então as duas extensões convivem
 * (criar uma segunda fase de cópia é o que dá conflito no Xcode).
 */
const TARGET = 'RitmoShare';
const TEMPLATE_DIR = path.join(__dirname, 'ritmo-share');

let withTargetXcodeProject;
try {
  withTargetXcodeProject = require('expo-widgets/plugin/build/ios/xcode/withTargetXcodeProject').default;
} catch (e) {
  throw new Error(`withRitmoShareExtension: não achei os ajudantes de alvo do expo-widgets (${e.message}).`);
}

const infoPlist = () => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>$(DEVELOPMENT_LANGUAGE)</string>
  <key>CFBundleDisplayName</key>
  <string>Player Downloader</string>
  <key>CFBundleExecutable</key>
  <string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key>
  <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$(PRODUCT_NAME)</string>
  <key>CFBundlePackageType</key>
  <string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
  <key>CFBundleShortVersionString</key>
  <string>$(MARKETING_VERSION)</string>
  <key>CFBundleVersion</key>
  <string>$(CURRENT_PROJECT_VERSION)</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionAttributes</key>
    <dict>
      <key>NSExtensionActivationRule</key>
      <dict>
        <key>NSExtensionActivationSupportsWebURLWithMaxCount</key>
        <integer>1</integer>
        <key>NSExtensionActivationSupportsText</key>
        <true/>
      </dict>
    </dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.share-services</string>
    <key>NSExtensionPrincipalClass</key>
    <string>$(PRODUCT_MODULE_NAME).ShareViewController</string>
  </dict>
</dict>
</plist>
`;

const entitlements = (group) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.application-groups</key>
  <array>
    <string>${group}</string>
  </array>
</dict>
</plist>
`;

/** Nome que aparece no menu Compartilhar: "Player Downloader" (e não o nome do alvo). */
function withDisplayName(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const target = project.pbxTargetByName(TARGET);
    const list = target && project.pbxXCConfigurationList()[target.buildConfigurationList];
    const configurations = project.pbxXCBuildConfigurationSection();
    for (const ref of list?.buildConfigurations ?? []) {
      const settings = configurations[ref.value]?.buildSettings;
      if (!settings) continue;
      // Entre aspas: no project.pbxproj um valor com espaço sem aspas quebra o CocoaPods.
      settings.INFOPLIST_KEY_CFBundleDisplayName = '"Player Downloader"';
      settings.SWIFT_VERSION = '5.0';
    }
    return cfg;
  });
}

module.exports = function withRitmoShareExtension(config, { groupIdentifier } = {}) {
  const bundleId = config.ios?.bundleIdentifier;
  if (!bundleId) throw new Error('withRitmoShareExtension: defina ios.bundleIdentifier no app.json.');
  const group = groupIdentifier ?? `group.${bundleId}`;
  const scheme = (Array.isArray(config.scheme) ? config.scheme[0] : config.scheme) ?? 'ritmo';
  const deploymentTarget = config.ios?.deploymentTarget ?? '16.4';
  let files = [];

  // O app lê o link guardado pela extensão (quando ela não consegue abrir o Ritmo) neste App Group.
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.RitmoAppGroup = group;
    return cfg;
  });
  // O app precisa do mesmo App Group (hoje o expo-widgets já põe; aqui não depende dele).
  config = withEntitlementsPlist(config, (cfg) => {
    const key = 'com.apple.security.application-groups';
    const groups = cfg.modResults[key] ?? [];
    if (!groups.includes(group)) cfg.modResults[key] = [...groups, group];
    return cfg;
  });

  // Credenciais do EAS (builds assinados): a extensão também precisa do App Group.
  const experimental = config.extra?.eas?.build?.experimental ?? {};
  const extensions = (experimental.ios?.appExtensions ?? []).filter((ext) => ext.targetName !== TARGET);
  config.extra = {
    ...config.extra,
    eas: {
      ...config.extra?.eas,
      build: {
        ...config.extra?.eas?.build,
        experimental: {
          ...experimental,
          ios: {
            ...experimental.ios,
            appExtensions: [
              ...extensions,
              { targetName: TARGET, bundleIdentifier: `${bundleId}.${TARGET}`, entitlements: { 'com.apple.security.application-groups': [group] } },
            ],
          },
        },
      },
    },
  };

  // Arquivos da extensão em ios/RitmoShare/ (a fase "dangerous" roda antes da do projeto Xcode).
  config = withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, TARGET);
      fs.mkdirSync(dir, { recursive: true });
      const swift = fs
        .readFileSync(path.join(TEMPLATE_DIR, 'ShareViewController.swift'), 'utf8')
        .replaceAll('{{SCHEME}}', scheme)
        .replaceAll('{{GROUP}}', group);
      const controller = path.join(dir, 'ShareViewController.swift');
      fs.writeFileSync(controller, swift);
      fs.writeFileSync(path.join(dir, 'Info.plist'), infoPlist());
      fs.writeFileSync(path.join(dir, `${TARGET}.entitlements`), entitlements(group));
      files = [controller, path.join(dir, 'Info.plist')];
      return cfg;
    },
  ]);

  // Registrado antes do alvo de propósito: os mods do Xcode rodam do último para o primeiro,
  // então este ajuste roda depois que o alvo existe.
  config = withDisplayName(config);
  config = withTargetXcodeProject(config, {
    targetName: TARGET,
    bundleIdentifier: `${bundleId}.${TARGET}`,
    deploymentTarget,
    appleTeamId: config.ios?.appleTeamId,
    getFileUris: () => files,
  });
  return config;
};
