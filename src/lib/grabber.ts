import { t } from '@/i18n';
import { logError } from '@/lib/errorlog';
import { errorMessage } from '@/lib/errors';
import { useSettings } from '@/store/settings';

/**
 * Ponte com o servidor do Ritmo (pasta `backend/`): o yt-dlp roda no PC/VPS e devolve
 * as qualidades; o celular baixa o arquivo pronto pelo DownloadManager/URLSession.
 */

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

export type GrabStatus = 'queued' | 'downloading' | 'converting' | 'ready' | 'error' | 'cancelled';

export type GrabJob = {
  id: string;
  status: GrabStatus;
  progress: number;
  stage?: string;
  title?: string;
  entryId?: string;
  error?: string;
  code?: string;
  file?: { name: string; mime: string; size: number };
};

export type GrabStarted = {
  id: string;
  ids: string[];
  batchId?: string;
  jobs?: { id: string; entryId: string; title: string }[];
};

/** Sem barra no fim e com esquema: "192.168.0.10:8787" → "http://192.168.0.10:8787". */
export function normalizeServer(value: string): string {
  let server = value.trim();
  if (!server) return '';
  if (!/^https?:\/\//i.test(server)) server = `http://${server}`;
  return server.replace(/\/+$/, '');
}

export function serverUrl(): string {
  return normalizeServer(useSettings.getState().grabServer);
}

export function serverKey(): string {
  return useSettings.getState().grabKey.trim();
}

/** Servidor configurado? Enquanto não estiver, o app continua bloqueando YouTube e redes sociais. */
export function grabEnabled(): boolean {
  return /^https?:\/\/[^/]+/i.test(serverUrl());
}

function friendly(e: unknown): Error {
  const err = e as Error;
  if (err?.name === 'AbortError') return new Error(t('tools.grab.timeout'));
  if (err instanceof Error && err.message && !/network request failed/i.test(err.message)) return err;
  return new Error(t('tools.grab.network'));
}

async function request<T>(base: string, key: string, path: string, init: RequestInit = {}, timeout = 30_000): Promise<T> {
  if (!base) throw new Error(t('tools.grab.noServer'));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(key ? { 'X-Ritmo-Key': key } : {}),
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // Servidor errado (HTML) ou proxy: a mensagem genérica é melhor que "Unexpected token".
    }
    if (!res.ok) {
      const detail = (data as { detail?: unknown } | null)?.detail;
      throw new Error(typeof detail === 'string' ? detail : t('tools.grab.badResponse', { code: res.status }));
    }
    if (data === null) throw new Error(t('tools.grab.badResponse', { code: res.status }));
    return data as T;
  } catch (e) {
    throw friendly(e);
  } finally {
    clearTimeout(timer);
  }
}

function call<T>(path: string, init: RequestInit = {}, timeout = 30_000): Promise<T> {
  return request<T>(serverUrl(), serverKey(), path, init, timeout);
}

/**
 * Lê o link no servidor (metadados + qualidades). Pode demorar: o yt-dlp consulta o site e,
 * se o site mudou, o servidor se atualiza e tenta de novo. `playlist` lê a playlist inteira.
 */
export function resolveLink(url: string, playlist = false): Promise<GrabMedia> {
  return call<GrabMedia>('/resolve', { method: 'POST', body: JSON.stringify({ url, playlist }) }, 180_000);
}

export type GrabSearchItem = GrabEntry;

/** Busca no YouTube pelo servidor (a lupa do SnapTube). */
export function searchVideos(query: string): Promise<{ items: GrabSearchItem[] }> {
  return call<{ items: GrabSearchItem[] }>(`/search?q=${encodeURIComponent(query)}&limit=15`, {}, 120_000);
}

/** Cria o download no servidor. Playlist: `entries` com os vídeos escolhidos (vazio = todos). */
export function startJob(token: string, formatId: string, options: { subtitles?: string | null; entries?: string[] } = {}): Promise<GrabStarted> {
  return call<GrabStarted>('/download', {
    method: 'POST',
    body: JSON.stringify({ token, formatId, subtitles: options.subtitles ?? null, entries: options.entries ?? null }),
  });
}

export function jobStatus(id: string): Promise<GrabJob> {
  return call<GrabJob>(`/job/${encodeURIComponent(id)}`, {}, 15_000);
}

/** Vários de uma vez (playlist). Os que o servidor não conhece mais vêm em `missing`. */
export function jobsStatus(ids: string[]): Promise<{ jobs: GrabJob[]; missing: string[] }> {
  return call<{ jobs: GrabJob[]; missing: string[] }>(`/jobs?ids=${ids.map(encodeURIComponent).join(',')}`, {}, 15_000);
}

/** Cancela no servidor, ou avisa que o arquivo já foi salvo (o servidor apaga o temporário). */
export async function cancelJob(id: string): Promise<void> {
  try {
    await call(`/job/${encodeURIComponent(id)}`, { method: 'DELETE' }, 10_000);
  } catch (e) {
    logError('Servidor: cancelar', e);
  }
}

/**
 * URL que o download nativo usa. Sem a chave: o ID do download já é secreto (128 bits), e assim a
 * chave não fica gravada no histórico de downloads do Android.
 */
export function jobFileUrl(id: string): string {
  return `${serverUrl()}/file/${encodeURIComponent(id)}`;
}

/** ID do download no servidor, se a URL for de um arquivo dele. */
export function serverJobId(url: string): string | null {
  const match = /\/file\/([0-9a-f]{32})(?:[?#]|$)/i.exec(url);
  if (!match) return null;
  const base = serverUrl();
  return base && url.startsWith(`${base}/`) ? match[1] : null;
}

export type ServerHealth = { ytdlp: string; ffmpeg: boolean; node: boolean; version?: string; autoUpdate: boolean };

export async function testServer(server: string, key: string): Promise<ServerHealth> {
  const data = await request<{ ytdlp?: string; ffmpeg?: boolean; node?: boolean; version?: string; update?: { autoUpdate?: boolean } }>(
    normalizeServer(server),
    key.trim(),
    '/health',
    {},
    10_000
  );
  return { ytdlp: data.ytdlp ?? '?', ffmpeg: !!data.ffmpeg, node: !!data.node, version: data.version, autoUpdate: data.update?.autoUpdate !== false };
}

/** Pede ao servidor para atualizar o yt-dlp agora (pode levar um minuto). */
export async function updateServer(server: string, key: string): Promise<{ updated: boolean; ytdlp: string }> {
  try {
    return await request<{ updated: boolean; ytdlp: string }>(normalizeServer(server), key.trim(), '/update', { method: 'POST' }, 600_000);
  } catch (e) {
    throw new Error(errorMessage(e));
  }
}
