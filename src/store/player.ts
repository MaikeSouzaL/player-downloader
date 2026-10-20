import { useMemo } from 'react';
import { create } from 'zustand';

import { t } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import RitmoCore, { type PlayerSnapshot, type QueueItem, type RepeatMode, type SleepTimerState } from '@/modules/ritmo-core';
import { logError } from '@/lib/errorlog';
import type { Track } from '@/lib/library';
import { neighborIndices } from '@/lib/queue';
import { useCollections } from '@/store/collections';
import { useExternalTracks } from '@/store/external-tracks';
import { useLibrary } from '@/store/library';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

type PlayerState = {
  snapshot: PlayerSnapshot | null;
  position: number;
  duration: number;
  /** IDs da fila na ordem em que foram adicionados. */
  queue: string[];
  /** Ordem real de reprodução (índices de `queue`); difere no modo aleatório. */
  order: number[];
  sleep: SleepTimerState | null;
  error: string | null;

  playTracks: (tracks: Track[], startIndex?: number, options?: { shuffle?: boolean }) => Promise<void>;
  toggle: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  seek: (ms: number) => Promise<void>;
  skipTo: (queueIndex: number) => Promise<void>;
  toggleShuffle: () => Promise<void>;
  setShuffle: (enabled: boolean) => Promise<void>;
  setRepeat: (mode: RepeatMode) => Promise<void>;
  cycleRepeat: () => Promise<void>;
  setSpeed: (speed: number) => Promise<void>;
  playNext: (tracks: Track[]) => Promise<void>;
  addToQueue: (tracks: Track[]) => Promise<void>;
  removeAt: (queueIndex: number) => Promise<void>;
  moveInQueue: (from: number, to: number) => Promise<void>;
  clearQueue: () => Promise<void>;
  setSleepTimer: (minutes: number, endOfTrack?: boolean) => Promise<void>;
  syncQueue: () => Promise<void>;
};

/**
 * Capa resolvida pelo carregador nativo (cache de capas do app: miniatura do álbum ou
 * imagem embutida), usada na notificação, na tela de bloqueio e no Android Auto.
 */
export const artworkUriFor = (track: Pick<Track, 'albumId' | 'uri'>) =>
  `ritmo-art://album/${encodeURIComponent(track.albumId)}?track=${encodeURIComponent(track.uri)}`;

export function toQueueItem(track: Track): QueueItem {
  return {
    id: track.id,
    uri: track.uri,
    title: track.title,
    artist: track.artist,
    album: track.album,
    artworkUri: track.cover ?? artworkUriFor(track),
  };
}

const REPEAT_CYCLE: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' };

export const usePlayer = create<PlayerState>()((set, get) => {
  const run = async (label: string, action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (e) {
      logError(`Player: ${label}`, e);
      set({ error: errorMessage(e) });
    }
  };

  return {
    snapshot: null,
    position: 0,
    duration: 0,
    queue: [],
    order: [],
    sleep: null,
    error: null,

    playTracks: async (tracks, startIndex = 0, options = {}) => {
      if (tracks.length === 0) return;
      const start = options.shuffle ? Math.floor(Math.random() * tracks.length) : Math.min(Math.max(0, startIndex), tracks.length - 1);
      set({ queue: tracks.map((t) => t.id), error: null });
      await run('tocar', async () => {
        await RitmoCore.setShuffle(!!options.shuffle);
        await RitmoCore.setQueue(tracks.map(toQueueItem), start, 0, true);
      });
      await get().syncQueue();
    },

    toggle: () => run('play/pause', () => (get().snapshot?.isPlaying ? RitmoCore.pause() : RitmoCore.play())),
    next: () => run('próxima', () => RitmoCore.next()),
    previous: () => run('anterior', () => RitmoCore.previous()),
    seek: async (ms) => {
      set({ position: ms });
      await run('buscar posição', () => RitmoCore.seekTo(ms));
    },
    skipTo: (queueIndex) => run('pular para', () => RitmoCore.skipTo(queueIndex)),
    toggleShuffle: async () => {
      await run('aleatório', () => RitmoCore.setShuffle(!get().snapshot?.shuffle));
      await get().syncQueue();
    },
    setShuffle: async (enabled) => {
      await run('aleatório', () => RitmoCore.setShuffle(enabled));
      await get().syncQueue();
    },
    setRepeat: (mode) => run('repetir', () => RitmoCore.setRepeat(mode)),
    cycleRepeat: () => run('repetir', () => RitmoCore.setRepeat(REPEAT_CYCLE[get().snapshot?.repeat ?? 'off'])),
    setSpeed: async (speed) => {
      useSettings.getState().set({ speed });
      await run('velocidade', () => RitmoCore.setSpeed(speed));
    },
    playNext: async (tracks) => {
      await run('tocar em seguida', () => RitmoCore.addToQueue(tracks.map(toQueueItem), true));
      await get().syncQueue();
    },
    addToQueue: async (tracks) => {
      await run('adicionar à fila', () => RitmoCore.addToQueue(tracks.map(toQueueItem), false));
      await get().syncQueue();
    },
    removeAt: async (queueIndex) => {
      await run('remover da fila', () => RitmoCore.removeFromQueue(queueIndex));
      await get().syncQueue();
    },
    moveInQueue: async (from, to) => {
      if (from === to) return;
      // Atualiza já na tela (arrastar fica fluido) e confirma com o nativo depois.
      const queue = [...get().queue];
      const [moved] = queue.splice(from, 1);
      queue.splice(to, 0, moved);
      set({ queue, order: queue.map((_, i) => i) });
      await run('reordenar fila', () => RitmoCore.moveInQueue(from, to));
      await get().syncQueue();
    },
    clearQueue: async () => {
      await run('limpar fila', async () => {
        await RitmoCore.pause();
        await RitmoCore.setQueue([], 0, 0, false);
        await RitmoCore.clearSavedQueue();
      });
      set({ queue: [], order: [] });
    },
    setSleepTimer: async (minutes, endOfTrack = false) => {
      try {
        set({ sleep: await RitmoCore.setSleepTimer(minutes, endOfTrack) });
      } catch (e) {
        logError('Player: timer', e);
      }
    },
    syncQueue: async () => {
      try {
        const native = await RitmoCore.getQueue();
        set({ queue: native.ids, order: native.order });
      } catch (e) {
        logError('Player: sincronizar fila', e);
      }
    },
  };
});

let lastTickAt = 0;
let pendingPlayMs = 0;
let recordedId: string | null = null;

/** Soma o tempo ouvido em memória e grava de vez em quando (cada gravação reescreve o AsyncStorage). */
function flushPlayTime() {
  if (pendingPlayMs > 0) useCollections.getState().addPlayTime(pendingPlayMs);
  pendingPlayMs = 0;
}

/** Liga os eventos do player nativo ao store. Chamado uma vez na abertura do app. */
export function attachPlayerEvents(): () => void {
  const subs = [
    RitmoCore.addListener('onState', (snapshot) => {
      const prev = usePlayer.getState().snapshot;
      usePlayer.setState({
        snapshot,
        duration: snapshot.duration || usePlayer.getState().duration,
        position: snapshot.position,
        error: snapshot.error,
      });
      const { queue } = usePlayer.getState();
      const outOfSync = snapshot.mediaId !== null && snapshot.index >= 0 && queue[snapshot.index] !== snapshot.mediaId;
      if (snapshot.queueLength !== queue.length || snapshot.shuffle !== prev?.shuffle || outOfSync) {
        usePlayer.getState().syncQueue();
      }
      // Conta como tocada só quando começa a tocar de fato (restaurar a sessão não conta).
      if (snapshot.isPlaying && snapshot.mediaId && snapshot.mediaId !== recordedId) {
        recordedId = snapshot.mediaId;
        useCollections.getState().recordPlay(snapshot.mediaId);
      }
      if (prev?.isPlaying && !snapshot.isPlaying) flushPlayTime();
    }),
    RitmoCore.addListener('onProgress', (p) => {
      usePlayer.setState({ position: p.position, duration: p.duration || usePlayer.getState().duration });
      const now = Date.now();
      // Em segundo plano o nativo manda o progresso a cada 10 s; intervalos maiores são pausas.
      if (usePlayer.getState().snapshot?.isPlaying && now - lastTickAt < 15_000) pendingPlayMs += now - lastTickAt;
      lastTickAt = now;
      if (pendingPlayMs > 30_000) flushPlayTime();
    }),
    RitmoCore.addListener('onSleepTimer', (sleep) => {
      usePlayer.setState({ sleep });
      if (sleep.fired) useUi.getState().showToast(t('player.sleep.fired'));
    }),
    RitmoCore.addListener('onIssue', (issue) => {
      logError('Reprodução', new Error(issue.message), { faixa: issue.title, codigo: issue.code });
      const name = issue.title ?? t('player.issue.fallbackName');
      useUi.getState().showToast(t(issue.type === 'skip' ? 'player.issue.skip' : 'player.issue.pause', { name }));
      usePlayer.getState().syncQueue();
    }),
  ];
  return () => subs.forEach((s) => s.remove());
}

/**
 * Se o serviço já está tocando (app reaberto), adota a fila dele.
 * Senão, recarrega a última fila salva pelo serviço, pausada, no ponto onde parou.
 */
export async function restorePlayback() {
  const { speed, equalizer: eq } = useSettings.getState();
  // Cada etapa por conta própria: um equalizador estragado não impede de recuperar a fila.
  try {
    await RitmoCore.restoreEqualizer(
      eq?.enabled === true,
      Array.isArray(eq?.levels) ? eq.levels.filter((l) => typeof l === 'number').map(Math.round) : null,
      typeof eq?.preset === 'number' ? eq.preset : -1,
      typeof eq?.bass === 'number' ? Math.round(eq.bass) : 0,
      typeof eq?.loudness === 'number' ? Math.round(eq.loudness) : 0
    );
  } catch (e) {
    logError('Restaurar equalizador', e);
  }
  try {
    const restored = await RitmoCore.restoreSavedQueue(false);
    if (!restored && speed !== 1) await RitmoCore.setSpeed(speed);
    await usePlayer.getState().syncQueue();
    const snapshot = await RitmoCore.getState();
    if (snapshot) usePlayer.setState({ snapshot, position: snapshot.position, duration: snapshot.duration });
    usePlayer.setState({ sleep: await RitmoCore.getSleepTimer() });
  } catch (e) {
    logError('Restaurar reprodução', e);
  }
}

/** Faixa tocando agora (ou carregada e pausada). */
export function useCurrentTrack(): Track | undefined {
  const mediaId = usePlayer((s) => s.snapshot?.mediaId);
  const fromLibrary = useLibrary((s) => (mediaId ? s.index.byId.get(mediaId) ?? s.allTracks.find((t) => t.id === mediaId) : undefined));
  const external = useExternalTracks((s) => (mediaId ? s.tracks[mediaId] : undefined));
  return fromLibrary ?? external;
}

/** Música anterior e próxima na ordem de reprodução, com o índice na fila (carrossel e "A seguir"). */
export function useNeighbors(): { previous?: { index: number; track: Track }; next?: { index: number; track: Track } } {
  const current = usePlayer((s) => s.snapshot?.index ?? -1);
  const repeat = usePlayer((s) => s.snapshot?.repeat ?? 'off');
  const queue = usePlayer((s) => s.queue);
  const order = usePlayer((s) => s.order);
  const byId = useLibrary((s) => s.index.byId);
  return useMemo(() => {
    const { previous, next } = neighborIndices(order, queue.length, current, repeat === 'all');
    const pick = (index: number | null) => {
      const track = index === null ? undefined : byId.get(queue[index]) ?? useExternalTracks.getState().tracks[queue[index]];
      return track && index !== null ? { index, track } : undefined;
    };
    return { previous: pick(previous), next: pick(next) };
  }, [current, repeat, queue, order, byId]);
}
