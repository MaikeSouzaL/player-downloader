import { create } from 'zustand';

import { errorMessage } from '@/lib/errors';
import RitmoCore, { type NativeVideo } from '@/modules/ritmo-core';
import { logError } from '@/lib/errorlog';
import { applyEdits, buildIndex, filterTracks, type LibraryIndex, type Track } from '@/lib/library';
import { hasAudioPermission, hasVideoPermission, requestMediaPermissions } from '@/lib/permissions';
import { useEdits } from '@/store/edits';
import { useSettings } from '@/store/settings';

type LibraryState = {
  permission: 'unknown' | 'granted' | 'denied';
  videoPermission: boolean;
  scanning: boolean;
  loaded: boolean;
  /** Tudo o que o MediaStore devolveu, sem filtros. */
  allTracks: Track[];
  /** Faixas que passam pelos filtros (duração mínima, pastas ocultas). */
  tracks: Track[];
  index: LibraryIndex;
  videos: NativeVideo[];
  error: string | null;
  checkPermission: () => Promise<boolean>;
  requestPermission: () => Promise<boolean>;
  scan: () => Promise<void>;
  applyFilters: () => void;
};

const EMPTY = buildIndex([]);

export const useLibrary = create<LibraryState>()((set, get) => ({
  permission: 'unknown',
  videoPermission: false,
  scanning: false,
  loaded: false,
  allTracks: [],
  tracks: [],
  index: EMPTY,
  videos: [],
  error: null,

  checkPermission: async () => {
    const [audio, video] = await Promise.all([hasAudioPermission(), hasVideoPermission()]);
    set({ permission: audio ? 'granted' : 'denied', videoPermission: video });
    return audio;
  },

  requestPermission: async () => {
    const { audio, video } = await requestMediaPermissions();
    set({ permission: audio ? 'granted' : 'denied', videoPermission: video });
    if (audio) await get().scan();
    return audio;
  },

  scan: async () => {
    if (get().scanning) return;
    set({ scanning: true, error: null });
    try {
      const [tracks, videos] = await Promise.all([
        RitmoCore.queryAudio(),
        get().videoPermission ? RitmoCore.queryVideos() : Promise.resolve([] as NativeVideo[]),
      ]);
      set({ allTracks: tracks, videos, loaded: true });
      get().applyFilters();
    } catch (e) {
      logError('Biblioteca: varredura', e);
      set({ error: errorMessage(e), loaded: true });
    } finally {
      set({ scanning: false });
      // Chegou aviso de mudança durante esta varredura: confere de novo.
      if (rescanPending) {
        rescanPending = false;
        scheduleRescan();
      }
    }
  },

  applyFilters: () => {
    const { minDurationSec, hiddenFolders, hiddenTracks } = useSettings.getState();
    const edited = applyEdits(get().allTracks, useEdits.getState().edits);
    const tracks = filterTracks(edited, { minDurationMs: minDurationSec * 1000, hiddenFolders, hiddenTracks });
    set({ tracks, index: buildIndex(tracks) });
  },
}));

// Editou informações de uma faixa: refaz o índice.
useEdits.subscribe((state, prev) => {
  if (state.edits !== prev.edits) useLibrary.getState().applyFilters();
});

// Mudou o filtro nas configurações: refaz o índice sem reler o MediaStore.
useSettings.subscribe((state, prev) => {
  if (
    state.minDurationSec !== prev.minDurationSec ||
    state.hiddenFolders !== prev.hiddenFolders ||
    state.hiddenTracks !== prev.hiddenTracks
  ) {
    useLibrary.getState().applyFilters();
  }
});

let rescanTimer: ReturnType<typeof setTimeout> | undefined;
let rescanPending = false;

/** Refaz a varredura quando o MediaStore avisa que algo mudou (download, exclusão, cartão SD). */
function scheduleRescan() {
  clearTimeout(rescanTimer);
  rescanTimer = setTimeout(async () => {
    const library = useLibrary.getState();
    if (library.permission !== 'granted') return;
    if (library.scanning) {
      rescanPending = true;
      return;
    }
    await library.scan();
  }, 1500);
}

export function watchLibraryChanges(): () => void {
  const sub = RitmoCore.addListener('onLibraryChanged', scheduleRescan);
  return () => {
    clearTimeout(rescanTimer);
    sub.remove();
  };
}

/** Ao voltar para o app: a permissão pode ter sido revogada (ou concedida) nas configurações. */
export async function recheckPermission() {
  const library = useLibrary.getState();
  const before = library.permission;
  const granted = await library.checkPermission();
  if (granted && before !== 'granted') await library.scan();
  if (!granted && before === 'granted') useLibrary.setState({ tracks: [], allTracks: [], videos: [], index: buildIndex([]) });
}
