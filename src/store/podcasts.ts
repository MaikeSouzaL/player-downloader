import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { mergeValidated } from '@/lib/merge';
import type { Episode, Feed } from '@/lib/rss';
import { persistStorage } from '@/store/storage';

export type Podcast = {
  id: string;
  feedUrl: string;
  title: string;
  author: string | null;
  image: string | null;
  episodes: Episode[];
  updatedAt: number;
};

type PodcastsState = {
  podcasts: Podcast[];
  /** Episódio (ID do podcast + ID do episódio) → ID do download (lista de Downloads). */
  downloads: Record<string, string>;
  /** Episódio → onde ficou salvo na biblioteca (vale mesmo depois de limpar a lista de Downloads). */
  saved: Record<string, string>;
  add: (feedUrl: string, feed: Feed) => string;
  update: (id: string, feed: Feed) => void;
  remove: (id: string) => void;
  linkDownload: (key: string, downloadId: string) => void;
  markSaved: (key: string, uri: string) => void;
};

/** Chave de um episódio no mapa de downloads. */
export const episodeKey = (podcastId: string, episodeId: string) => `${podcastId}|${episodeId}`;

/** Podcasts assinados (pelo link do feed RSS) e os downloads dos episódios. */
export const usePodcasts = create<PodcastsState>()(
  persist(
    (set, get) => ({
      podcasts: [],
      downloads: {},
      saved: {},
      add: (feedUrl, feed) => {
        const id = `pc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const podcast: Podcast = { id, feedUrl, title: feed.title, author: feed.author, image: feed.image, episodes: feed.episodes, updatedAt: Date.now() };
        set({ podcasts: [podcast, ...get().podcasts] });
        return id;
      },
      update: (id, feed) =>
        set({
          podcasts: get().podcasts.map((p) =>
            p.id === id
              ? {
                  ...p,
                  title: feed.title || p.title,
                  author: feed.author ?? p.author,
                  image: feed.image ?? p.image,
                  // Feed que voltou sem episódios (erro do servidor dele) não apaga a lista que já existia.
                  episodes: feed.episodes.length > 0 ? feed.episodes : p.episodes,
                  updatedAt: Date.now(),
                }
              : p
          ),
        }),
      remove: (id) => {
        const prefix = `${id}|`;
        set({
          podcasts: get().podcasts.filter((p) => p.id !== id),
          downloads: Object.fromEntries(Object.entries(get().downloads).filter(([key]) => !key.startsWith(prefix))),
          saved: Object.fromEntries(Object.entries(get().saved).filter(([key]) => !key.startsWith(prefix))),
        });
      },
      linkDownload: (key, downloadId) => set({ downloads: { ...get().downloads, [key]: downloadId } }),
      markSaved: (key, uri) => {
        if (get().saved[key] !== uri) set({ saved: { ...get().saved, [key]: uri } });
      },
    }),
    {
      name: 'podcasts',
      storage: persistStorage,
      version: 1,
      merge: (persisted, current) => {
        const merged = mergeValidated(persisted, current);
        // Assinatura com formato inesperado (versão antiga, arquivo estragado) sai em vez de quebrar a tela.
        const podcasts = merged.podcasts.filter((p): p is Podcast => !!p && typeof p.id === 'string' && typeof p.feedUrl === 'string' && Array.isArray(p.episodes));
        return { ...merged, podcasts };
      },
    }
  )
);
