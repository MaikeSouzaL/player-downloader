import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { mergeValidated } from '@/lib/merge';
import { persistStorage } from '@/store/storage';

type Progress = { position: number; duration: number; updatedAt: number };

type VideoProgressState = {
  /** Onde cada vídeo parou (segundos), para "continuar assistindo". */
  progress: Record<string, Progress>;
  save: (id: string, position: number, duration: number) => void;
  clear: (id: string) => void;
};

const LIMIT = 300;

export const useVideoProgress = create<VideoProgressState>()(
  persist(
    (set, get) => ({
      progress: {},
      save: (id, position, duration) => {
        const progress = { ...get().progress };
        // Perto do fim (ou do começo) não vale a pena retomar: esquece.
        if (duration > 0 && (position < 5 || position > duration - 10)) delete progress[id];
        else progress[id] = { position, duration, updatedAt: Date.now() };
        const ids = Object.keys(progress);
        if (ids.length > LIMIT) {
          ids.sort((a, b) => progress[a].updatedAt - progress[b].updatedAt);
          for (const old of ids.slice(0, ids.length - LIMIT)) delete progress[old];
        }
        set({ progress });
      },
      clear: (id) => {
        const progress = { ...get().progress };
        delete progress[id];
        set({ progress });
      },
    }),
    { name: 'video-progress', storage: persistStorage, version: 1, merge: mergeValidated }
  )
);
