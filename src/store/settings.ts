import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { AlbumSort, ArtistSort, FolderSort, SongSort, SortSpec, VideoSort } from '@/lib/library';
import { mergeValidated } from '@/lib/merge';
import { persistStorage } from '@/store/storage';
import type { LangPreference } from '@/i18n';
import type { Accent } from '@/theme';

export type ThemePreference = 'system' | 'light' | 'dark';

export type EqualizerSettings = {
  enabled: boolean;
  levels: number[] | null;
  preset: number;
  bass: number;
  loudness: number;
};

/** Preset do equalizador salvo pelo usuário (níveis em milibéis, por banda). */
export type EqPreset = { id: string; name: string; levels: number[]; bass: number; loudness: number };

/** Foto de fundo do tema (Ajustes › Tema): desfoque em px e escurecimento de 0 a 0,9. */
export type BackgroundSettings = { uri: string | null; blur: number; dim: number; player: boolean };

export type SortState = { key: SongSort; desc: boolean };

type Settings = {
  theme: ThemePreference;
  accent: Accent;
  /** "Ocultar áudios com duração inferior a N segundos" (toques, notificações, mensagens de voz). */
  minDurationSec: number;
  hiddenFolders: string[];
  hiddenTracks: string[];
  songSort: SortState;
  albumSort: SortSpec<AlbumSort>;
  artistSort: SortSpec<ArtistSort>;
  folderSort: SortSpec<FolderSort>;
  videoSort: SortSpec<VideoSort>;
  albumView: 'grid' | 'list';
  videoView: 'list' | 'grid';
  speed: number;
  equalizer: EqualizerSettings;
  eqPresets: EqPreset[];
  /** Idioma do app: o do aparelho ou um escolhido em Ajustes. */
  language: LangPreference;
  background: BackgroundSettings;
  /** Já viu a tela de boas-vindas (explicação das permissões). */
  onboarded: boolean;
  /** Servidor de downloads (pasta `backend/`): endereço na rede e chave opcional. */
  grabServer: string;
  grabKey: string;
  /** Mandar os erros do app para esse servidor (para a gente corrigir). */
  reportErrors: boolean;
};

type SettingsState = Settings & {
  set: (patch: Partial<Settings>) => void;
  toggleHiddenFolder: (path: string) => void;
  hideTracks: (ids: string[]) => void;
  unhideTrack: (id: string) => void;
};

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: 'system',
      accent: 'blue',
      minDurationSec: 30,
      hiddenFolders: [],
      hiddenTracks: [],
      songSort: { key: 'recent', desc: false },
      albumSort: { key: 'name', desc: false },
      artistSort: { key: 'name', desc: false },
      folderSort: { key: 'name', desc: false },
      videoSort: { key: 'recent', desc: false },
      albumView: 'grid',
      videoView: 'list',
      speed: 1,
      equalizer: { enabled: false, levels: null, preset: -1, bass: 0, loudness: 0 },
      eqPresets: [],
      language: 'system',
      background: { uri: null, blur: 12, dim: 0.45, player: true },
      onboarded: false,
      grabServer: '',
      grabKey: '',
      reportErrors: true,
      set: (patch) => set(patch),
      toggleHiddenFolder: (path) => {
        const hidden = get().hiddenFolders;
        set({ hiddenFolders: hidden.includes(path) ? hidden.filter((p) => p !== path) : [...hidden, path] });
      },
      hideTracks: (ids) => set({ hiddenTracks: [...new Set([...get().hiddenTracks, ...ids])] }),
      unhideTrack: (id) => set({ hiddenTracks: get().hiddenTracks.filter((t) => t !== id) }),
    }),
    { name: 'settings', storage: persistStorage, version: 1, merge: mergeValidated }
  )
);
