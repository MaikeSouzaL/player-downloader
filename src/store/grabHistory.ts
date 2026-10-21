import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { persistStorage } from '@/store/storage';

/** Link já lido no aparelho, guardado para baixar de novo sem colar tudo outra vez. */
export type GrabRecent = {
  url: string;
  title: string;
  thumbnail?: string | null;
  at: number;
};

type GrabHistoryState = {
  recents: GrabRecent[];
  add: (item: Omit<GrabRecent, 'at'>) => void;
  clear: () => void;
};

const LIMIT = 12;

export const useGrabHistory = create<GrabHistoryState>()(
  persist(
    (set, get) => ({
      recents: [],
      add: (item) =>
        set({
          recents: [{ ...item, at: Date.now() }, ...get().recents.filter((entry) => entry.url !== item.url)].slice(0, LIMIT),
        }),
      clear: () => set({ recents: [] }),
    }),
    { name: 'grab-history', storage: persistStorage, version: 1 }
  )
);
