const { withXcodeProject } = require('expo/config-plugins');

/**
 * Fase de build que instala a stdlib do Python e os pacotes puros dentro do .app.
 *
 * O Python.xcframework é embutido pelo CocoaPods (RitmoCore.podspec). Esta fase só
 * copia o conteúdo que o XCFramework não pode carregar (stdlib e app_packages) e
 * transforma as extensões .so em .fwork assinados, como o Python-Apple-support exige.
 *
 * O ios/ é gerado pelo `expo prebuild`; não edite o projeto à mão.
 */

const PHASE_NAME = 'Install Python (GrabCore)';
const SCRIPT = `set -e
/bin/sh "$PROJECT_DIR/../modules/ritmo-core/ios/GrabCore/install_python.sh"
`;

function findAppTarget(project) {
  const targets = project.pbxNativeTargetSection();
  for (const [uuid, target] of Object.entries(targets)) {
    if (!target || typeof target !== 'object') continue;
    const productType = String(target.productType || '').replace(/"/g, '');
    if (productType === 'com.apple.product-type.application') {
      return { uuid, target };
    }
  }
  return null;
}

function phaseAlreadyExists(project) {
  const phases = project.hash.project.objects.PBXShellScriptBuildPhase || {};
  return Object.values(phases).some(
    (phase) =>
      phase &&
      typeof phase === 'object' &&
      String(phase.name || '').replace(/"/g, '') === PHASE_NAME
  );
}

function allowScriptSandboxing(project, target) {
  const configurations = project.pbxXCBuildConfigurationSection();
  const lists = project.hash.project.objects.XCConfigurationList || {};
  const listId = String(target.buildConfigurationList || '').replace(/"/g, '');
  const list = lists[listId];
  const refs = list?.buildConfigurations || [];

  if (!refs.length) {
    // Fallback: desliga em todas as configurações. É uma configuração de build,
    // não muda nada no app em execução.
    for (const config of Object.values(configurations)) {
      if (config && typeof config === 'object' && config.buildSettings) {
        config.buildSettings.ENABLE_USER_SCRIPT_SANDBOXING = 'NO';
      }
    }
    return;
  }

  for (const ref of refs) {
    const configId = typeof ref === 'string' ? ref : ref?.value;
    const config = configurations[String(configId).replace(/"/g, '')];
    if (config?.buildSettings) {
      config.buildSettings.ENABLE_USER_SCRIPT_SANDBOXING = 'NO';
    }
  }
}

module.exports = function withGrabIos(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const app = findAppTarget(project);

    if (!app) {
      throw new Error('withGrabIos: não encontrei o alvo do aplicativo no projeto Xcode.');
    }

    allowScriptSandboxing(project, app.target);

    if (phaseAlreadyExists(project)) {
      return cfg;
    }

    const added = project.addBuildPhase([], 'PBXShellScriptBuildPhase', PHASE_NAME, app.uuid, {
      shellPath: '/bin/sh',
      shellScript: SCRIPT,
      inputPaths: [],
      outputPaths: [],
    });

    if (added?.buildPhase) {
      // Sempre roda: a stdlib e os pacotes podem mudar sem o projeto mudar.
      added.buildPhase.alwaysOutOfDate = 1;
    }

    return cfg;
  });
};
