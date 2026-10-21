const { AndroidConfig, withAndroidManifest, withGradleProperties } = require('expo/config-plugins');

/**
 * "Compartilhar com o Player Downloader" e "Abrir com o Player Downloader" no Android: a tela principal passa a receber
 *  - SEND de texto (links), áudio e vídeo;
 *  - SEND_MULTIPLE de áudio e vídeo;
 *  - VIEW de arquivos de áudio e vídeo (gerenciador de arquivos, WhatsApp, Telegram…);
 *  - VIEW de links do YouTube (o "Abrir com" do Chrome e de outros navegadores).
 * O módulo nativo lê o Intent (ShareIntents.kt) e o JS abre a tela /share ou /grab.
 *
 * Também libera HTTP sem TLS: o servidor de downloads roda no PC da rede local
 * (http://192.168.x.x:8787). Se um dia só usar HTTPS, troque para "false".
 */
const FILTERS = [
  { action: 'android.intent.action.SEND', categories: ['android.intent.category.DEFAULT'], data: [{ mimeType: 'text/plain' }, { mimeType: 'audio/*' }, { mimeType: 'video/*' }] },
  { action: 'android.intent.action.SEND_MULTIPLE', categories: ['android.intent.category.DEFAULT'], data: [{ mimeType: 'audio/*' }, { mimeType: 'video/*' }] },
  {
    action: 'android.intent.action.VIEW',
    categories: ['android.intent.category.DEFAULT'],
    data: [{ scheme: 'content' }, { mimeType: 'audio/*' }, { mimeType: 'video/*' }],
  },
  {
    action: 'android.intent.action.VIEW',
    categories: ['android.intent.category.DEFAULT', 'android.intent.category.BROWSABLE'],
    data: [
      { scheme: 'https', host: 'youtube.com' },
      { scheme: 'https', host: 'www.youtube.com' },
      { scheme: 'https', host: 'm.youtube.com' },
      { scheme: 'https', host: 'music.youtube.com' },
      { scheme: 'https', host: 'youtu.be' },
    ],
  },
];

const key = (f) =>
  `${f.action}|${f.data.map((d) => [d.mimeType, d.scheme, d.host].filter(Boolean).join(':')).join(',')}`;

module.exports = function withRitmoAndroid(config) {
  config = withAndroidManifest(config, (cfg) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    // DownloadManager/URLSession falando com o servidor local por http://.
    application.$['android:usesCleartextTraffic'] = 'true';

    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults);
    const existing = new Set(
      (activity['intent-filter'] ?? []).map((f) =>
        key({
          action: f.action?.[0]?.$?.['android:name'],
          data: (f.data ?? []).map((d) => ({
            mimeType: d.$?.['android:mimeType'],
            scheme: d.$?.['android:scheme'],
            host: d.$?.['android:host'],
          })),
        })
      )
    );
    activity['intent-filter'] = activity['intent-filter'] ?? [];
    for (const f of FILTERS) {
      if (existing.has(key(f))) continue;
      activity['intent-filter'].push({
        action: [{ $: { 'android:name': f.action } }],
        category: f.categories.map((c) => ({ $: { 'android:name': c } })),
        data: f.data.map((d) => ({
          $: d.mimeType ? { 'android:mimeType': d.mimeType } : { 'android:scheme': d.scheme, ...(d.host ? { 'android:host': d.host } : {}) },
        })),
      });
    }
    return cfg;
  });

  // youtubedl-android carrega Python/FFmpeg/QuickJS das libs nativas empacotadas. O AGP novo
  // recusa `android:extractNativeLibs="true"` no manifesto; o Expo já tem o
  // `jniLibs.useLegacyPackaging` no template, ligado por esta propriedade.
  config = withGradleProperties(config, (cfg) => {
    const key = 'expo.useLegacyPackaging';
    const entry = cfg.modResults.find((item) => item.type === 'property' && item.key === key);
    if (entry) entry.value = 'true';
    else cfg.modResults.push({ type: 'property', key, value: 'true' });
    return cfg;
  });

  return config;
};
