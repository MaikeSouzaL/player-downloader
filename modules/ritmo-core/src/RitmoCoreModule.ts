import { NativeModule, requireNativeModule } from 'expo';

import type {
  EqualizerInfo,
  LyricsResult,
  NativeQueue,
  NativeTrack,
  NativeVideo,
  OutputDevice,
  PlayerSnapshot,
  RingtoneType,
  QueueItem,
  RepeatMode,
  RitmoCoreEvents,
  SleepTimerState,
  MediaKind,
  NativeDownload,
  SharePayload,
  VaultItem,
  VaultMeta,
} from './RitmoCore.types';

declare class RitmoCoreModule extends NativeModule<RitmoCoreEvents> {
  queryAudio(): Promise<NativeTrack[]>;
  queryVideos(): Promise<NativeVideo[]>;
  getArtwork(albumId: string, trackUri: string | null, size: number): Promise<string | null>;
  getVideoThumbnail(videoId: string, size: number): Promise<string | null>;
  clearArtworkCache(): Promise<void>;
  /** Cor predominante da capa (hex): a mais viva e presente, e a média. Null se não der para ler a imagem. */
  artworkColor(uri: string): Promise<{ dominant: string; average: string } | null>;
  readLyrics(path: string | null, uri: string): Promise<LyricsResult>;

  queryTrashed(): Promise<NativeTrack[]>;
  supportsTrash(): boolean;
  /** trash=true move para a lixeira do sistema; false restaura. Resolve false se o usuário recusar. */
  trashTracks(ids: string[], trash: boolean): Promise<boolean>;
  deleteTracks(ids: string[]): Promise<boolean>;
  /** Apaga pela URI (vídeos e músicas). Android pede confirmação; resolve false se o usuário recusar. */
  deleteUris(uris: string[]): Promise<boolean>;
  /**
   * Grava título, artista, álbum e capa (URI da imagem) no próprio arquivo: MP3 e FLAC, só no Android.
   * null = deixa como está. O Android pede autorização antes; recusar dá 'denied'.
   */
  writeTags(uri: string, title: string | null, artist: string | null, album: string | null, cover: string | null): Promise<'written' | 'denied' | 'unsupported'>;
  /** Das URIs passadas, as que ainda existem (para desfazer só o que não foi apagado). */
  existingUris(uris: string[]): Promise<string[]>;

  canWriteSettings(): boolean;
  openWriteSettings(): void;
  setRingtone(trackId: string, type: RingtoneType): Promise<boolean>;
  getOutputDevice(): OutputDevice;

  setQueue(items: QueueItem[], startIndex: number, startPositionMs: number, play: boolean): Promise<void>;
  addToQueue(items: QueueItem[], playNext: boolean): Promise<void>;
  removeFromQueue(index: number): Promise<void>;
  moveInQueue(from: number, to: number): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seekTo(positionMs: number): Promise<void>;
  skipTo(index: number): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  setShuffle(enabled: boolean): Promise<void>;
  setRepeat(mode: RepeatMode): Promise<void>;
  setSpeed(speed: number): Promise<void>;
  getState(): Promise<PlayerSnapshot | null>;
  getQueue(): Promise<NativeQueue>;

  getEqualizer(): Promise<EqualizerInfo>;
  setEqualizerEnabled(enabled: boolean): Promise<EqualizerInfo>;
  setEqualizerBand(band: number, level: number): Promise<EqualizerInfo>;
  applyEqualizerPreset(preset: number): Promise<EqualizerInfo>;
  setBassBoost(strength: number): Promise<EqualizerInfo>;
  setLoudness(gainMb: number): Promise<EqualizerInfo>;
  restoreEqualizer(enabled: boolean, levels: number[] | null, preset: number, bass: number, loudness: number): Promise<EqualizerInfo>;

  setSleepTimer(minutes: number, endOfTrack: boolean): Promise<SleepTimerState>;
  getSleepTimer(): Promise<SleepTimerState>;
  /**
   * Transição suave (ms, 0 = desligada), álbuns contínuos sem fade, pular silêncio (só Android) e
   * volume igualado (ReplayGain: 'off' | 'track' | 'album', com ajuste fino em dB). Fica salvo no nativo.
   */
  setPlaybackTuning(crossfadeMs: number, gaplessAlbums: boolean, skipSilence: boolean, replayGain: string, preampDb: number): Promise<void>;

  /** Recarrega a última fila salva pelo serviço, se o player estiver vazio. */
  restoreSavedQueue(play: boolean): Promise<boolean>;
  clearSavedQueue(): Promise<void>;
  /** Dados para o Android Auto / CarPlay navegarem com o app fechado (JSON). */
  setBrowseData(json: string): Promise<void>;

  // Compartilhar, salvar, converter, baixar e pasta privada (Android e iOS).
  getPendingShare(): SharePayload | null;

  // Download no próprio aparelho (Android: yt-dlp/FFmpeg; iOS: yt-dlp + URLSession/AVFoundation).
  grabAvailable(): boolean;
  grabResolve(url: string, playlist: boolean): Promise<Record<string, unknown>>;
  grabSearch(query: string, limit: number): Promise<Record<string, unknown>>;
  grabStart(url: string, formatId: string, options: string): Promise<Record<string, unknown>>;
  grabJobs(ids: string[]): Promise<Record<string, unknown>>;
  grabCancel(id: string): void;
  /** Atualizador do motor iOS via PyPI. Só existe no iOS. */
  grabUpdateStatus?(): Promise<Record<string, unknown>>;
  grabUpdateCheck?(force: boolean): Promise<Record<string, unknown>>;
  grabUpdateInstall?(): Promise<Record<string, unknown>>;
  grabUpdateRollback?(): Promise<Record<string, unknown>>;
  /** Diagnóstico do motor iOS (build-only): versões e resolve opcional. Só existe no iOS. */
  grabSelfTest?(options: { resolve?: boolean; url?: string | null }): Promise<Record<string, unknown>>;
  /** Crash nativo (Kotlin/Swift) da última vez que o app abriu, para o relatório de erros. Lê uma vez só. */
  takeLastCrash(): string | null;
  /** Copia para a biblioteca (Android: Music/Player Downloader ou Movies/Player Downloader; iPhone: pasta do app). Devolve a URI salva. */
  saveToLibrary(uri: string, name: string, mime: string | null, kind: MediaKind): Promise<string>;
  /** Vídeo/áudio → AAC/M4A. bitrateKbps 0 = original. Progresso no evento onConvertProgress. */
  convertToAudio(jobId: string, uri: string, name: string, bitrateKbps: number): Promise<string>;
  cancelConversion(jobId: string): void;
  startDownload(url: string, fileName: string, mime: string | null, title: string): string;
  queryDownloads(ids: string[]): NativeDownload[];
  cancelDownload(id: string): void;
  deleteLocalFile(uri: string): boolean;
  vaultAdd(uri: string, meta: VaultMeta): Promise<VaultItem>;
  vaultList(): Promise<VaultItem[]>;
  vaultRestore(id: string): Promise<string>;
  vaultDelete(id: string): Promise<void>;
  /** Apaga a pasta privada inteira ("Esqueci o PIN"), mesmo com o índice estragado. */
  vaultWipe(): Promise<void>;

  // Só no Android: balão flutuante por cima dos outros apps.
  setFloatingBubble?(enabled: boolean): void;
  canDrawOverlays?(): boolean;
  /** Abre a tela do Android para liberar "Sobrepor a outros apps". */
  openOverlayPermission?(): void;

  // Só no iOS: acesso ao app Música e a pasta das músicas importadas.
  mediaLibraryStatus?(): 'granted' | 'denied' | 'restricted' | 'undetermined';
  requestMediaLibraryAccess?(): Promise<'granted' | 'denied' | 'restricted' | 'undetermined'>;
  musicFolderUri?(): string;
}

export default requireNativeModule<RitmoCoreModule>('RitmoCore');
