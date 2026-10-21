// R8 no build release + regras de keep do motor de download (yt-dlp/Python/FFmpeg/QuickJS),
// do módulo nativo e do Jackson.
//
// Por que isso é um plugin: o R8 só é ligado pelo build.gradle do android/ gerado. O prebuild
// apaga o android/ e recria a partir do template, então a configuração precisa morar aqui.
//
// O fallback sem R8 continua funcionando:
//   .\build-apk.ps1 -NoMinify
// (ele passa -Pandroid.enableMinifyInReleaseBuilds=false e
//  -Pandroid.enableShrinkResourcesInReleaseBuilds=false, que sobrepõem o gradle.properties).
//
// Referência das regras: https://developer.android.com/build/shrink-code
const { withDangerousMod, withGradleProperties } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const BEGIN = '# >>> ritmo: R8/keep rules (gerado por plugins/withRitmoProguard.js) >>>';
const END = '# <<< ritmo <<<';

// Regras mínimas. O bloco é reaplicado a cada prebuild e preserva o resto do arquivo
// (as regras do template, como as do react-native-reanimated).
const PROGUARD_RULES = `# Motor de download: o Python chama classes Java por nome (JNI/reflexão) e o R8 não
# consegue enxergar isso. Sem o keep, o download quebra só em runtime.
-keep class expo.modules.ritmocore.** { *; }
-keep class com.yausername.** { *; }

# commons-compress (o zip que o yt-dlp usa para descompactar o Python): o ExtraFieldUtils
# registra as classes de "campo extra" por reflexão (getMethod + newInstance). Sem o keep,
# o R8 fundia/renomeava essas classes e o motor morria no initPython com
# "class … is not a concrete class" — o download nem começava.
-keep class org.apache.commons.compress.** { *; }

# Jackson: o YoutubeDL guarda um ObjectMapper estático no <clinit> e lê anotações por
# reflexão. Se o R8 remover/renomear as anotações, o app falha ao baixar.
-keep class com.fasterxml.jackson.** { *; }
-keepclassmembers class * { @com.fasterxml.jackson.annotation.* *; }

# Assinatura/anotações para a reflexão e pilhas legíveis no "Registro de erros".
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,SourceFile,LineNumberTable

# Dependências opcionais do FFmpeg/commons que não entram no APK.
-dontwarn org.apache.commons.**

# O Jackson referencia classes do Java SE que não existem no Android (sem DOM/bootstrap de
# beans). O YoutubeDL só usa JSON, então suprimir o aviso não tira funcionalidade.
-dontwarn java.beans.**
-dontwarn org.w3c.dom.**`;

const MINIFY_PROPS = [
  ['android.enableMinifyInReleaseBuilds', 'true'],
  ['android.enableShrinkResourcesInReleaseBuilds', 'true'],
];

function withRitmoMinify(config) {
  return withGradleProperties(config, (cfg) => {
    const keys = new Set(MINIFY_PROPS.map(([key]) => key));
    // Remove duplicatas (o template pode já trazer a chave com false) e recoloca no fim,
    // que é o valor que o Gradle usa.
    cfg.modResults = cfg.modResults.filter((item) => !(item.type === 'property' && keys.has(item.key)));
    for (const [key, value] of MINIFY_PROPS) {
      cfg.modResults.push({ type: 'property', key, value });
    }
    return cfg;
  });
}

function mergeRules(existing, block) {
  const start = existing.indexOf(BEGIN);
  const end = existing.indexOf(END);
  const base = start !== -1 && end > start ? `${existing.slice(0, start)}${existing.slice(end + END.length)}` : existing;
  const trimmed = base.replace(/\s+$/, '');
  return `${trimmed ? `${trimmed}\n\n` : ''}${block}\n`;
}

function withRitmoProguardRules(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const file = path.join(cfg.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
      let existing = '';
      try {
        existing = await fs.promises.readFile(file, 'utf8');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
      }
      const block = `${BEGIN}\n${PROGUARD_RULES}\n${END}`;
      await fs.promises.writeFile(file, mergeRules(existing, block), 'utf8');
      return cfg;
    },
  ]);
}

module.exports = function withRitmoProguard(config) {
  return withRitmoMinify(withRitmoProguardRules(config));
};
