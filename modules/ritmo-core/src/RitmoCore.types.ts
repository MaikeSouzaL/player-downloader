export type NativeTrack = {
  id: string;
  uri: string;
  title: string;
  fileName: string | null;
  artist: string | null;
  artistId: string;
  album: string | null;
  albumId: string;
  duration: number;
  path: string | null;
  folder: string | null;
  size: number;
  dateAdded: number;
  track: number;
  year: number;
  mime: string | null;
  isMusic: boolean;
  /** Só na lixeira: quando o Android apaga de vez. */
  expiresAt?: number | null;
};

export type OutputDevice = { kind: 'bluetooth' | 'wired' | 'speaker'; name: string | null };

export type RingtoneType = 'call' | 'notification' | 'alarm';

export type NativeVideo = {
  id: string;
  uri: string;
  title: string;
  fileName: string | null;
  duration: number;
  size: number;
  width: number;
  height: number;
  path: string | null;
  folder: string | null;
  dateAdded: number;
  mime: string | null;
};

/** O que o player nativo precisa para tocar e montar a notificação. */
export type QueueItem = {
  id: string;
  uri: string;
  title: string;
  artist?: string | null;
  album?: string | null;
  artworkUri?: string | null;
};

export type RepeatMode = 'off' | 'one' | 'all';

export type PlayerSnapshot = {
  isPlaying: boolean;
  playWhenReady: boolean;
  state: 'idle' | 'buffering' | 'ready' | 'ended';
  index: number;
  mediaId: string | null;
  position: number;
  duration: number;
  shuffle: boolean;
  repeat: RepeatMode;
  speed: number;
  queueLength: number;
  error: string | null;
};

export type ProgressEvent = { mediaId: string | null; position: number; duration: number; buffered: number };

export type SleepTimerState = { active: boolean; endOfTrack: boolean; remainingMs: number; fired: boolean };

export type EqualizerInfo = {
  available: boolean;
  enabled: boolean;
  minLevel: number;
  maxLevel: number;
  bands: { index: number; centerHz: number; level: number }[];
  presets: string[];
  preset: number;
  bassBoostAvailable: boolean;
  bassBoost: number;
  loudnessAvailable: boolean;
  loudnessGain: number;
};

export type NativeQueue = { ids: string[]; order: number[]; index: number };

export type LyricsResult = { source: 'lrc' | 'embedded'; text: string } | null;

/** O serviço tirou uma faixa da fila porque não conseguiu tocar (arquivo apagado, formato, permissão). */
export type PlaybackIssue = { type: 'skip' | 'stop'; mediaId: string | null; title: string | null; code: string; message: string };

/** Item recebido pelo "Compartilhar" / "Abrir com". */
export type SharedItem = { uri: string; name: string; size: number; mime: string | null };
export type SharePayload = { text: string | null; subject: string | null; items: SharedItem[] };

export type DownloadState = 'pending' | 'running' | 'paused' | 'done' | 'failed';
export type NativeDownload = { id: string; status: DownloadState; bytes: number; total: number; reason: number; localUri: string | null; mime: string | null };

export type MediaKind = 'audio' | 'video';
export type VaultItem = {
  id: string;
  uri: string;
  name: string;
  title: string;
  artist: string | null;
  album: string | null;
  duration: number;
  kind: MediaKind;
  mime: string | null;
  size: number;
  addedAt: number;
};
export type VaultMeta = { name: string; title?: string; artist?: string | null; album?: string | null; duration?: number; kind: MediaKind; mime?: string | null };

export type RitmoCoreEvents = {
  onShare: (payload: SharePayload) => void;
  onConvertProgress: (event: { jobId: string; progress: number }) => void;
  onState: (state: PlayerSnapshot) => void;
  onProgress: (progress: ProgressEvent) => void;
  onSleepTimer: (state: SleepTimerState) => void;
  onIssue: (issue: PlaybackIssue) => void;
  /** Músicas ou vídeos mudaram no aparelho (MediaStore). */
  onLibraryChanged: (payload: Record<string, never>) => void;
};
