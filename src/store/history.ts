import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { mergeValidated } from '@/lib/merge';
import { persistStorage } from '@/store/storage';

type HistoryState = {
  queries: string[];
  add: (query: string) => void;
  remove: (query: string) => void;
  clear: () => void;
};

/** Buscas recentes, guardadas só no aparelho. */
export const useSearchHistory = create<HistoryState>()(
  persist(
    (set, get) => ({
      queries: [],
      add: (query) => {
        const q = query.trim();
        if (q.length < 2) return;
        set({ queries: [q, ...get().queries.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 12) });
      },
      remove: (query) => set({ queries: get().queries.filter((x) => x !== query) }),
      clear: () => set({ queries: [] }),
    }),
    { name: 'search-history', storage: persistStorage, version: 1, merge: mergeValidated }
  )
);
