import { useMemo } from 'react';
import { create } from 'zustand';

import { t } from '@/i18n';
import { isLong, resumePosition } from '@/lib/audiobook';
import { errorMessage } from '@/lib/errors';
import { formatDuration } from '@/lib/format';
import RitmoCore, { type PlayerSnapshot, type QueueItem, type RepeatMode, type SleepTimerState } from '@/modules/ritmo-core';
import { logError } from '@/lib/errorlog';
import { haptic } from '@/lib/haptics';
import type { Track } from '@/lib/library';
import { neighborIndices } from '@/lib/queue';
import { useAudiobook } from '@/store/audiobook';
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
  /** Recarrega a fila no mesmo ponto (o arquivo da música atual mudou por baixo, ex.: tags gravadas). */
  reloadQueue: (play: boolean) => Promise<void>;
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
      // Tocar de novo o mesmo audiolivro: guarda onde ele estava e confere a retomada (o ID não muda).
      if (lastSpot) saveSpot(lastSpot.id, lastSpot.position, lastSpot.duration);
      resumeCheck = tracks[start].id;
      await run('tocar', async () => {
        await RitmoCore.setShuffle(!!options.shuffle);
        await RitmoCore.setQueue(tracks.map(toQueueItem), start, 0, true);
      });
      await get().syncQueue();
    },

    toggle: () => {
      haptic('tap');
      return run('play/pause', () => (get().snapshot?.isPlaying ? RitmoCore.pause() : RitmoCore.play()));
    },
    next: () => {
      haptic('tap');
      return run('próxima', () => RitmoCore.next());
    },
    previous: () => {
      haptic('tap');
      return run('anterior', () => RitmoCore.previous());
    },
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
      // Arquivo longo (audiolivro, podcast) guarda a velocidade só para ele; o resto muda a geral.
      const { snapshot, duration } = get();
      if (useSettings.getState().resumeLong && snapshot?.mediaId && isLong(duration)) useAudiobook.getState().setSpeed(snapshot.mediaId, speed);
      else useSettings.getState().set({ speed });
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
    reloadQueue: async (play) => {
      const { snapshot, queue } = get();
      if (!snapshot || snapshot.index < 0 || queue.length === 0) return;
      const byId = useLibrary.getState().index.byId;
      const tracks = queue.map((id) => byId.get(id) ?? useExternalTracks.getState().tracks[id]);
      if (tracks.some((t) => !t)) return;
      await run('recarregar a fila', () => RitmoCore.setQueue((tracks as Track[]).map(toQueueItem), snapshot.index, snapshot.position, play));
      await get().syncQueue();
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

// "Lembrar onde parou": a última posição conhecida e a faixa que ainda falta conferir ao ficar pronta.
let lastSpot: { id: string; position: number; duration: number } | null = null;
let lastSpotSaveAt = 0;
let resumeCheck: string | null = null;

/** Guarda onde parou, se a faixa for longa e o ajuste estiver ligado. */
function saveSpot(id: string | null | undefined, position: number, duration: number) {
  if (!id || !useSettings.getState().resumeLong || !isLong(duration)) return;
  useAudiobook.getState().saveSpot(id, position, duration);
}

/**
 * Faixa nova pronta: arquivo longo volta com a velocidade dele e continua de onde parou; ao sair dele,
 * a velocidade geral volta. Fila restaurada já no meio (reabrir o app) não é mexida.
 */
function applyLongTrack(snapshot: PlayerSnapshot) {
  const id = snapshot.mediaId;
  if (!id) return;
  const { resumeLong, speed: globalSpeed } = useSettings.getState();
  const long = resumeLong && isLong(snapshot.duration);
  const target = (long ? useAudiobook.getState().speeds[id]?.speed : undefined) ?? globalSpeed;
  if (Math.abs(snapshot.speed - target) > 0.001) RitmoCore.setSpeed(target).catch((e) => logError('Player: velocidade do arquivo', e));
  if (!long || snapshot.position > 5_000) return;
  const from = resumePosition(useAudiobook.getState().spots[id], snapshot.duration);
  if (from === null) return;
  usePlayer.setState({ position: from });
  RitmoCore.seekTo(from).catch((e) => logError('Player: continuar de onde parou', e));
  useUi.getState().showToast(t('extras.play.resumed', { time: formatDuration(from) }));
}

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
      if (prev?.isPlaying && !snapshot.isPlaying) {
        flushPlayTime();
        saveSpot(snapshot.mediaId, snapshot.position, snapshot.duration);
      }
      if (snapshot.mediaId !== (prev?.mediaId ?? null)) {
        // Saiu de uma faixa longa no meio: guarda onde estava.
        if (lastSpot && lastSpot.id !== snapshot.mediaId) saveSpot(lastSpot.id, lastSpot.position, lastSpot.duration);
        resumeCheck = snapshot.mediaId;
      }
      if (resumeCheck && snapshot.mediaId === resumeCheck && snapshot.state === 'ready' && snapshot.duration > 0) {
        resumeCheck = null;
        applyLongTrack(snapshot);
      }
    }),
    RitmoCore.addListener('onProgress', (p) => {
      usePlayer.setState({ position: p.position, duration: p.duration || usePlayer.getState().duration });
      const now = Date.now();
      // Em segundo plano o nativo manda o progresso a cada 10 s; intervalos maiores são pausas.
      if (usePlayer.getState().snapshot?.isPlaying && now - lastTickAt < 15_000) pendingPlayMs += now - lastTickAt;
      lastTickAt = now;
      if (pendingPlayMs > 30_000) flushPlayTime();
      if (p.mediaId) {
        lastSpot = { id: p.mediaId, position: p.position, duration: p.duration };
        if (now - lastSpotSaveAt > 10_000) {
          lastSpotSaveAt = now;
          saveSpot(p.mediaId, p.position, p.duration);
        }
      }
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
