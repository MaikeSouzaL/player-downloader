import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { t } from '@/i18n';
import { mergeValidated } from '@/lib/merge';
import { persistStorage } from '@/store/storage';

export type Playlist = { id: string; name: string; trackIds: string[]; createdAt: number; updatedAt: number };

type CollectionsState = {
  playlists: Playlist[];
  liked: string[];
  /** Mais recente primeiro, sem repetição. */
  recent: string[];
  plays: Record<string, number>;
  /** Tempo ouvido por dia (AAAA-MM-DD → ms), para "Tempo de reprodução". */
  playTime: Record<string, number>;
  createPlaylist: (name: string, trackIds?: string[]) => string;
  renamePlaylist: (id: string, name: string) => void;
  deletePlaylist: (id: string) => void;
  addToPlaylist: (id: string, trackIds: string[]) => number;
  removeFromPlaylist: (id: string, index: number) => void;
  movePlaylistItem: (id: string, from: number, to: number) => void;
  setPlaylistTracks: (id: string, trackIds: string[]) => void;
  toggleLike: (trackId: string) => void;
  recordPlay: (trackId: string) => void;
  clearHistory: () => void;
  addPlayTime: (ms: number) => void;
};

export const dayKey = (d: Date = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const RECENT_LIMIT = 100;

export const useCollections = create<CollectionsState>()(
  persist(
    (set, get) => {
      const updatePlaylist = (id: string, fn: (p: Playlist) => Playlist) =>
        set({ playlists: get().playlists.map((p) => (p.id === id ? { ...fn(p), updatedAt: Date.now() } : p)) });

      return {
        playlists: [],
        liked: [],
        recent: [],
        plays: {},
        playTime: {},

        createPlaylist: (name, trackIds = []) => {
          const id = `pl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
          const now = Date.now();
          set({ playlists: [{ id, name: name.trim() || t('library.playlist.new'), trackIds: [...new Set(trackIds)], createdAt: now, updatedAt: now }, ...get().playlists] });
          return id;
        },
        renamePlaylist: (id, name) => updatePlaylist(id, (p) => ({ ...p, name: name.trim() || p.name })),
        deletePlaylist: (id) => set({ playlists: get().playlists.filter((p) => p.id !== id) }),
        /** Devolve quantas faixas eram novas na playlist. */
        addToPlaylist: (id, trackIds) => {
          let added = 0;
          updatePlaylist(id, (p) => {
            const existing = new Set(p.trackIds);
            const fresh = trackIds.filter((t) => !existing.has(t));
            added = fresh.length;
            return { ...p, trackIds: [...p.trackIds, ...fresh] };
          });
          return added;
        },
        removeFromPlaylist: (id, index) =>
          updatePlaylist(id, (p) => ({ ...p, trackIds: p.trackIds.filter((_, i) => i !== index) })),
        movePlaylistItem: (id, from, to) =>
          updatePlaylist(id, (p) => {
            const ids = [...p.trackIds];
            const [item] = ids.splice(from, 1);
            ids.splice(to, 0, item);
            return { ...p, trackIds: ids };
          }),
        setPlaylistTracks: (id, trackIds) => updatePlaylist(id, (p) => ({ ...p, trackIds: [...new Set(trackIds)] })),
        toggleLike: (trackId) => {
          const liked = get().liked;
          set({ liked: liked.includes(trackId) ? liked.filter((l) => l !== trackId) : [trackId, ...liked] });
        },
        recordPlay: (trackId) => {
          // Pasta privada não deixa rastro em Recentes nem em Mais tocadas.
          if (trackId.startsWith('v:')) return;
          set({
            recent: [trackId, ...get().recent.filter((r) => r !== trackId)].slice(0, RECENT_LIMIT),
            plays: { ...get().plays, [trackId]: (get().plays[trackId] ?? 0) + 1 },
          });
        },
        clearHistory: () => set({ recent: [], plays: {} }),
        addPlayTime: (ms) => {
          const key = dayKey();
          set({ playTime: { ...get().playTime, [key]: (get().playTime[key] ?? 0) + ms } });
        },
      };
    },
    {
      name: 'collections',
      storage: persistStorage,
      version: 1,
      merge: (persisted, current) => {
        const merged = mergeValidated(persisted, current);
        // Playlists com formato inesperado são descartadas em vez de quebrar a tela.
        const playlists = merged.playlists.filter(
          (p): p is Playlist => !!p && typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.trackIds)
        );
        return { ...merged, playlists };
      },
    }
  )
);
