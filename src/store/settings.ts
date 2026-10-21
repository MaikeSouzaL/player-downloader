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

/** Volume igualado pelas tags ReplayGain: por faixa, pelo álbum inteiro ou desligado. */
export type ReplayGainMode = 'off' | 'track' | 'album';

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
  /** No modo escuro, fundo preto de verdade (economiza bateria em telas OLED). */
  pureBlack: boolean;
  /** Vibração leve nos toques principais (tocar, pausar, curtir, trocar de música). */
  haptics: boolean;
  /** Player com as cores da capa da música. */
  coverColors: boolean;
  /** Deixa a tela girar (celular deitado e tablet). */
  rotation: boolean;
  /** Transição suave entre músicas, em segundos (0 = desligada). */
  crossfadeSec: number;
  /** Com a transição ligada, faixas seguidas do mesmo álbum emendam sem fade (álbuns ao vivo, contínuos). */
  gaplessAlbums: boolean;
  /** Pular os trechos em silêncio (Android). */
  skipSilence: boolean;
  /** Lembrar onde parou em arquivos longos (audiolivros, podcasts) e a velocidade de cada um. */
  resumeLong: boolean;
  replayGain: ReplayGainMode;
  /** Ajuste fino do ReplayGain, em dB (-6 a +6). */
  replayGainPreamp: number;
  /** Balão flutuante com a música por cima dos outros apps (Android). */
  bubble: boolean;
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
      accent: 'orange',
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
      pureBlack: false,
      haptics: true,
      coverColors: true,
      rotation: false,
      crossfadeSec: 0,
      gaplessAlbums: true,
      skipSilence: false,
      resumeLong: true,
      replayGain: 'off',
      replayGainPreamp: 0,
      bubble: true,

      set: (patch) => set(patch),
      toggleHiddenFolder: (path) => {
        const hidden = get().hiddenFolders;
        set({ hiddenFolders: hidden.includes(path) ? hidden.filter((p) => p !== path) : [...hidden, path] });
      },
      hideTracks: (ids) => set({ hiddenTracks: [...new Set([...get().hiddenTracks, ...ids])] }),
      unhideTrack: (id) => set({ hiddenTracks: get().hiddenTracks.filter((t) => t !== id) }),
    }),
    {
      name: 'settings',
      storage: persistStorage,
      // 2: o destaque padrão virou o laranja do logo Vinil; quem estava no azul (o padrão antigo) passa para ele.
      version: 2,
      migrate: (persisted, version) => {
        const saved = persisted as Partial<Settings> | null;
        return (version < 2 && saved?.accent === 'blue' ? { ...saved, accent: 'orange' } : persisted) as SettingsState;
      },
      merge: mergeValidated,
    }
  )
);
