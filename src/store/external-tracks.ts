import { create } from 'zustand';

import type { Track } from '@/lib/library';

/**
 * Músicas que tocam no player mas não estão na biblioteca (ex.: pasta privada). O player, a fila e o
 * widget procuram aqui quando o ID não está no índice da biblioteca.
 */
export const useExternalTracks = create<{ tracks: Record<string, Track>; add: (list: Track[]) => void }>()((set, get) => ({
  tracks: {},
  add: (list) => set({ tracks: { ...get().tracks, ...Object.fromEntries(list.map((t) => [t.id, t])) } }),
}));
