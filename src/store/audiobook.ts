import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { trimSpots, type SavedSpot } from '@/lib/audiobook';
import { mergeValidated } from '@/lib/merge';
import { persistStorage } from '@/store/storage';

type SpeedEntry = { speed: number; at: number };

type AudiobookState = {
  /** Onde parou em cada arquivo longo (ID da faixa → posição). */
  spots: Record<string, SavedSpot>;
  /** Velocidade escolhida para cada arquivo longo (o resto usa a velocidade geral). */
  speeds: Record<string, SpeedEntry>;
  saveSpot: (id: string, position: number, duration: number) => void;
  setSpeed: (id: string, speed: number) => void;
};

const LIMIT = 300;

/** "Lembrar onde parou": posição e velocidade de audiolivros e podcasts, salvas entre aberturas. */
export const useAudiobook = create<AudiobookState>()(
  persist(
    (set, get) => ({
      spots: {},
      speeds: {},
      saveSpot: (id, position, duration) => {
        // Pasta privada não deixa rastro.
        if (id.startsWith('v:')) return;
        set({ spots: trimSpots({ ...get().spots, [id]: { position, duration, at: Date.now() } }, LIMIT) });
      },
      setSpeed: (id, speed) => {
        if (id.startsWith('v:')) return;
        set({ speeds: trimSpots({ ...get().speeds, [id]: { speed, at: Date.now() } }, LIMIT) });
      },
    }),
    { name: 'audiobook', storage: persistStorage, version: 1, merge: mergeValidated }
  )
);
