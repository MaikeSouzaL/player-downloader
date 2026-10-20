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
  readLyrics(path: string | null, uri: string): Promise<LyricsResult>;

  queryTrashed(): Promise<NativeTrack[]>;
  supportsTrash(): boolean;
  /** trash=true move para a lixeira do sistema; false restaura. Resolve false se o usuário recusar. */
  trashTracks(ids: string[], trash: boolean): Promise<boolean>;
  deleteTracks(ids: string[]): Promise<boolean>;
  /** Apaga pela URI (vídeos e músicas). Android pede confirmação; resolve false se o usuário recusar. */
  deleteUris(uris: string[]): Promise<boolean>;
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

  /** Recarrega a última fila salva pelo serviço, se o player estiver vazio. */
  restoreSavedQueue(play: boolean): Promise<boolean>;
  clearSavedQueue(): Promise<void>;
  /** Dados para o Android Auto / CarPlay navegarem com o app fechado (JSON). */
  setBrowseData(json: string): Promise<void>;

  // Compartilhar, salvar, converter, baixar e pasta privada (Android e iOS).
  getPendingShare(): SharePayload | null;
  /** Crash nativo (Kotlin/Swift) da última vez que o app abriu, para o relatório de erros. Lê uma vez só. */
  takeLastCrash(): string | null;
  /** Copia para a biblioteca (Android: Music/Ritmo ou Movies/Ritmo; iPhone: pasta do app). Devolve a URI salva. */
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

  // Só no iOS: acesso ao app Música e a pasta das músicas importadas.
  mediaLibraryStatus?(): 'granted' | 'denied' | 'restricted' | 'undetermined';
  requestMediaLibraryAccess?(): Promise<'granted' | 'denied' | 'restricted' | 'undetermined'>;
  musicFolderUri?(): string;
}

export default requireNativeModule<RitmoCoreModule>('RitmoCore');
