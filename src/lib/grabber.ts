import { Platform } from 'react-native';

import { t } from '@/i18n';
import { withTimeout } from '@/lib/timeout';
import RitmoCore from '@/modules/ritmo-core';

/**
 * Download no próprio aparelho: yt-dlp embutido e aceleração nativa em cada plataforma.
 * Não há servidor, chave, cookies nem requisições para Render: o celular fala direto com o site
 * e baixa pela conexão do usuário (Wi‑Fi ou 4G).
 */

/** O botão "Baixar" não pode ficar travado se o motor não responder ao criar o job. */
const START_TIMEOUT_MS = 30_000;
/** O poller da fila não pode ficar preso numa promessa nativa. */
const STATUS_TIMEOUT_MS = 20_000;

export type GrabFormat = {
  id: string;
  label: string;
  ext: string;
  height?: number;
  fps?: number | null;
  filesize?: number;
  hasAudio?: boolean;
  bitrate?: number;
  /** "H.264", "VP9", "AV1"… */
  codec?: string | null;
  /** false = VP9/AV1 (2K/4K do YouTube), que iPhones antigos podem não tocar. */
  compatible?: boolean;
};

export type GrabSubtitle = { id: string; lang: string; name: string; auto: boolean };

export type GrabEntry = {
  id: string;
  url: string;
  title: string;
  uploader?: string | null;
  duration: number;
  thumbnail?: string | null;
};

export type GrabMedia = {
  kind: 'video' | 'playlist';
  token: string;
  url: string;
  title: string;
  uploader?: string | null;
  duration: number;
  thumbnail?: string | null;
  extractor?: string | null;
  playlist?: { title: string; count: number; entries: GrabEntry[] } | null;
  /** Vídeo aberto de dentro de uma playlist do YouTube: link da playlist inteira. */
  playlistUrl?: string | null;
  formats: GrabFormat[];
  audio: GrabFormat[];
  subtitles: GrabSubtitle[];
};

export type GrabStatus = 'queued' | 'downloading' | 'converting' | 'saving' | 'done' | 'ready' | 'error' | 'cancelled';

export type GrabJob = {
  id: string;
  status: GrabStatus;
  progress: number;
  stage?: string;
  title?: string;
  entryId?: string;
  /** O motor pode mandar a URL do job (versões novas); sem ela usamos o entryId/URL da página. */
  url?: string;
  error?: string;
  code?: string;
  /** O arquivo já foi salvo na biblioteca do aparelho. */
  file?: { name: string; mime: string; size: number };
};

export type GrabStarted = {
  id: string;
  ids: string[];
  batchId?: string;
  jobs?: { id: string; entryId: string; title: string; url?: string }[];
};

/**
 * Motor local: Android (yt-dlp/FFmpeg) e iOS (yt-dlp embutido + URLSession/AVFoundation).
 * O iPhone precisa de iOS 16.4+ e do build nativo; no Expo Go não existe.
 */
export function grabEnabled(): boolean {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return false;
  try {
    return typeof RitmoCore.grabAvailable === 'function' && RitmoCore.grabAvailable();
  } catch {
    return false;
  }
}

/**
 * Lê o link no próprio aparelho (metadados + qualidades). A primeira chamada pode demorar:
 * o yt-dlp embutido está inicializando. `playlist` lê a playlist inteira.
 */
export function resolveLink(url: string, playlist = false): Promise<GrabMedia> {
  const timeout = playlist ? 120_000 : 60_000;
  return withTimeout(RitmoCore.grabResolve(url, playlist) as unknown as Promise<GrabMedia>, timeout, t('tools.grab.timeout'));
}

export type GrabSearchItem = GrabEntry;

/** Busca no YouTube pelo yt-dlp do aparelho (a lupa do SnapTube). */
export function searchVideos(query: string): Promise<{ items: GrabSearchItem[] }> {
  return withTimeout(
    RitmoCore.grabSearch(query, 15) as unknown as Promise<{ items: GrabSearchItem[] }>,
    45_000,
    t('tools.grab.timeout')
  );
}

export type StartOptions = {
  subtitles?: string | null;
  /** Playlist: os vídeos escolhidos, com URL (o motor local baixa cada um). */
  videos?: GrabEntry[];
  /** O formato de vídeo escolhido já tem áudio? Evita baixar/duplicar a faixa. */
  hasAudio?: boolean;
  title?: string;
  kind?: 'video' | 'audio';
};

/** Enfileira o download no motor local. Devolve os IDs para acompanhar o progresso. */
export function startJob(url: string, formatId: string, options: StartOptions = {}): Promise<GrabStarted> {
  const payload = JSON.stringify({
    subtitles: options.subtitles ?? null,
    videos: (options.videos ?? []).map((entry) => ({ id: entry.id, url: entry.url, title: entry.title })),
    hasAudio: !!options.hasAudio,
    title: options.title ?? '',
    kind: options.kind ?? 'video',
  });
  return withTimeout(
    RitmoCore.grabStart(url, formatId, payload) as unknown as Promise<GrabStarted>,
    START_TIMEOUT_MS,
    t('tools.grab.timeout')
  );
}

/** Vários de uma vez (playlist). Os que o motor não conhece mais vêm em `missing`. */
export function jobsStatus(ids: string[]): Promise<{ jobs: GrabJob[]; missing: string[] }> {
  return withTimeout(
    RitmoCore.grabJobs(ids) as unknown as Promise<{ jobs: GrabJob[]; missing: string[] }>,
    STATUS_TIMEOUT_MS,
    t('tools.grab.timeout')
  );
}

export async function jobStatus(id: string): Promise<GrabJob> {
  const { jobs } = await jobsStatus([id]);
  const job = jobs[0];
  if (!job) throw new Error(t('tools.grab.lost'));
  return job;
}

/** Cancela o processo do yt-dlp no aparelho. */
export function cancelJob(id: string): void {
  try {
    RitmoCore.grabCancel(id);
  } catch {
    // processo já terminou
  }
}
