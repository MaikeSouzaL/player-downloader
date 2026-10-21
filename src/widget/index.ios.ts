import { addUserInteractionListener, createWidget, widgetsDirectory, type Widget } from 'expo-widgets';
import { Directory, File } from 'expo-file-system';

import { t } from '@/i18n';
import { logError } from '@/lib/errorlog';
import RitmoCore from '@/modules/ritmo-core';
import { useExternalTracks } from '@/store/external-tracks';
import { useLibrary } from '@/store/library';
import { usePlayer } from '@/store/player';
import { useSettings } from '@/store/settings';
import { ACCENTS } from '@/theme';
import { NowPlayingWidget, type NowPlayingProps } from '@/widget/NowPlayingWidget';

/**
 * Criado só quando a sincronização começa e protegido: instalado com um Apple ID grátis (Sideloadly) o app pode
 * ficar sem o App Group do widget, e isso não pode derrubar o app.
 */
let widget: Widget<NowPlayingProps> | null = null;

const sharedDir = () => {
  if (!widgetsDirectory) throw new Error('Widget sem pasta compartilhada (App Group)');
  return new Directory(widgetsDirectory.startsWith('file://') ? widgetsDirectory : `file://${widgetsDirectory}`);
};

/** O widget só lê arquivos da pasta compartilhada (App Group): copia a capa atual para lá. */
async function coverForWidget(albumId: string, uri: string, custom?: string): Promise<string | null> {
  const source = custom ?? (await RitmoCore.getArtwork(albumId, uri, 256).catch(() => null));
  if (!source) return null;
  const dir = sharedDir();
  if (!dir.exists) dir.create({ intermediates: true });
  const key = custom ? `c${custom.length}-${custom.slice(-24)}` : albumId;
  const name = `cover-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`;
  const target = new File(dir, name);
  if (!target.exists) {
    // Guarda só a capa atual (a pasta do widget é pequena).
    for (const old of dir.list()) if (old instanceof File && old.name.startsWith('cover-')) old.delete();
    await new File(source).copy(target);
  }
  return target.uri;
}

let last = '';

async function refresh() {
  if (!widget) return;
  const { snapshot } = usePlayer.getState();
  // Pasta privada: o widget não mostra o nome nem a capa.
  const track = snapshot?.mediaId && !snapshot.mediaId.startsWith('v:')
    ? useLibrary.getState().index.byId.get(snapshot.mediaId) ?? useExternalTracks.getState().tracks[snapshot.mediaId]
    : undefined;
  const accent = (ACCENTS[useSettings.getState().accent] ?? ACCENTS.orange).light[0];
  const props: NowPlayingProps = track
    ? {
        title: track.title,
        artist: track.artist ?? t('common.unknownArtist'),
        isPlaying: !!snapshot?.isPlaying,
        cover: await coverForWidget(track.albumId, track.uri, track.cover).catch(() => null),
        accent,
      }
    : { title: 'Player Downloader', artist: t('ios.widgetEmpty'), isPlaying: false, cover: null, accent };
  const key = JSON.stringify(props);
  if (key === last) return;
  last = key;
  widget.updateSnapshot(props);
}

function safeAddInteractionListener(listener: Parameters<typeof addUserInteractionListener>[0]) {
  try {
    return addUserInteractionListener(listener);
  } catch (e) {
    logError('Widget: botões', e);
    return { remove: () => {} };
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
const schedule = () => {
  clearTimeout(timer);
  timer = setTimeout(() => refresh().catch((e) => logError('Widget', e)), 400);
};

/** Mantém o widget igual ao player e responde aos botões dele (enquanto o app estiver aberto ou tocando). */
export function startWidgetSync(): () => void {
  try {
    // Nome igual ao do plugin `expo-widgets` no app.json.
    widget ??= createWidget<NowPlayingProps>('NowPlaying', NowPlayingWidget, {
      title: 'Player Downloader',
      artist: '',
      isPlaying: false,
      cover: null,
      accent: ACCENTS.orange.light[0],
    });
  } catch (e) {
    logError('Widget: criar', e);
    return () => {};
  }
  schedule();
  const unsubPlayer = usePlayer.subscribe((s, p) => {
    if (s.snapshot?.mediaId !== p.snapshot?.mediaId || s.snapshot?.isPlaying !== p.snapshot?.isPlaying) schedule();
  });
  const unsubLibrary = useLibrary.subscribe((s, p) => {
    if (s.index !== p.index) schedule();
  });
  const interaction = safeAddInteractionListener((event) => {
    const player = usePlayer.getState();
    if (event.target === 'toggle') player.toggle();
    else if (event.target === 'next') player.next();
    else if (event.target === 'previous') player.previous();
  });
  return () => {
    clearTimeout(timer);
    unsubPlayer();
    unsubLibrary();
    interaction.remove();
  };
}
