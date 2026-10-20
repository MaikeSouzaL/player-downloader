// Ajustes para gerar o APK no Windows:
// 1. O C++ gerado pelo React Native cria pastas com mais de 248 caracteres e o ninja
//    falha com "mkdir ... No such file or directory". CMAKE_OBJECT_PATH_MAX ajuda o CMake a
//    encurtar caminhos; com ninja >= 1.12 (cmake.dir no local.properties) o limite some.
// 2. O R8 fica sem Metaspace com o limite padrão do Gradle (2 GB / 512 MB).
const { withAppBuildGradle, withGradleProperties } = require('expo/config-plugins');

const JVM_ARGS = '-Xmx6g -XX:MaxMetaspaceSize=2g -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8';

function withShortObjectPaths(config) {
  return withAppBuildGradle(config, (cfg) => {
    const marker = 'CMAKE_OBJECT_PATH_MAX';
    if (!cfg.modResults.contents.includes(marker)) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /defaultConfig\s*\{/,
        (match) =>
          `${match}\n        // Windows: encurta os caminhos dos objetos C++ (limite de 260 caracteres).\n        externalNativeBuild { cmake { arguments "-D${marker}=128" } }`
      );
    }
    return cfg;
  });
}

function withGradleMemory(config) {
  return withGradleProperties(config, (cfg) => {
    const items = cfg.modResults.filter((item) => !(item.type === 'property' && item.key === 'org.gradle.jvmargs'));
    items.push({ type: 'property', key: 'org.gradle.jvmargs', value: JVM_ARGS });
    cfg.modResults = items;
    return cfg;
  });
}

module.exports = function withWindowsBuildFixes(config) {
  return withGradleMemory(withShortObjectPaths(config));
};
