import { create } from 'zustand';

import type { Track } from '@/lib/library';

/** Abas da tela inicial. */
export type HomeTab = 'songs' | 'playlists' | 'folders' | 'albums' | 'artists' | 'videos';

/** De onde o menu foi aberto, para mostrar ações extras (ex.: remover da playlist). */
export type MenuContext = { playlistId?: string; playlistIndex?: number; queueIndex?: number; fromPlayer?: boolean };

type UiState = {
  menu: { track: Track; context: MenuContext } | null;
  /** Faixas esperando a escolha de uma playlist. */
  addToPlaylist: Track[] | null;
  toast: string | null;
  /** Aba aberta na tela inicial (o app abre Músicas ou Vídeo quando um download termina). */
  homeTab: HomeTab;
  setHomeTab: (tab: HomeTab) => void;
  openMenu: (track: Track, context?: MenuContext) => void;
  closeMenu: () => void;
  pickPlaylist: (tracks: Track[]) => void;
  closePicker: () => void;
  showToast: (message: string) => void;
};

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useUi = create<UiState>()((set) => ({
  menu: null,
  addToPlaylist: null,
  toast: null,
  homeTab: 'songs',
  setHomeTab: (tab) => set({ homeTab: tab }),
  openMenu: (track, context = {}) => set({ menu: { track, context } }),
  closeMenu: () => set({ menu: null }),
  pickPlaylist: (tracks) => set({ addToPlaylist: tracks, menu: null }),
  closePicker: () => set({ addToPlaylist: null }),
  showToast: (message) => {
    clearTimeout(toastTimer);
    set({ toast: message });
    toastTimer = setTimeout(() => set({ toast: null }), 2200);
  },
}));
