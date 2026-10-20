import RitmoCore from '@/modules/ritmo-core';
import { t } from '@/i18n';
import { logError } from '@/lib/errorlog';
import { useCollections } from '@/store/collections';
import { useEdits } from '@/store/edits';
import { useSettings } from '@/store/settings';

/**
 * Manda para o nativo o que o Android Auto precisa para navegar com o app fechado:
 * playlists, curtidas, recentes, filtros (pastas/músicas ocultas, duração mínima),
 * informações editadas e os nomes das seções (no idioma do app).
 */
function snapshot(): string {
  const c = useCollections.getState();
  const s = useSettings.getState();
  const edits = useEdits.getState().edits;
  return JSON.stringify({
    labels: {
      home: t('settings.auto.home'),
      recent: t('settings.auto.recent'),
      liked: t('settings.auto.liked'),
      playlists: t('settings.auto.playlists'),
      albums: t('settings.auto.albums'),
      artists: t('settings.auto.artists'),
      shuffle: t('settings.auto.shuffle'),
      unknownArtist: t('common.unknownArtist'),
      unknownAlbum: t('common.unknownAlbum'),
    },
    playlists: c.playlists.map((p) => ({ id: p.id, name: p.name, trackIds: p.trackIds })),
    liked: c.liked,
    recent: c.recent,
    hiddenFolders: s.hiddenFolders,
    hiddenTracks: s.hiddenTracks,
    minDurationMs: s.minDurationSec * 1000,
    edits: Object.fromEntries(
      Object.entries(edits).map(([id, e]) => [id, { title: e.title ?? '', artist: e.artist ?? '', album: e.album ?? '' }])
    ),
  });
}

let timer: ReturnType<typeof setTimeout> | undefined;
let last = '';

function push() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const json = snapshot();
    if (json === last) return;
    RitmoCore.setBrowseData(json)
      .then(() => {
        last = json;
      })
      .catch((e) => logError('Android Auto: dados', e));
  }, 1000);
}

/** Liga a sincronização (chamado na abertura, depois de carregar os stores). */
export function syncBrowseData(): () => void {
  push();
  const subs = [
    useCollections.subscribe((s, p) => {
      if (s.playlists !== p.playlists || s.liked !== p.liked || s.recent !== p.recent) push();
    }),
    useSettings.subscribe((s, p) => {
      if (s.hiddenFolders !== p.hiddenFolders || s.hiddenTracks !== p.hiddenTracks || s.minDurationSec !== p.minDurationSec || s.language !== p.language) push();
    }),
    useEdits.subscribe((s, p) => {
      if (s.edits !== p.edits) push();
    }),
  ];
  return () => {
    clearTimeout(timer);
    subs.forEach((u) => u());
  };
}
