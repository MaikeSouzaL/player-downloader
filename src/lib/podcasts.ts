import { t } from '@/i18n';
import { startDownload } from '@/lib/downloads';
import { extensionOf, fileNameFor } from '@/lib/links';
import type { Track } from '@/lib/library';
import { newEpisodes, parseFeed, type Episode, type Feed } from '@/lib/rss';
import { withTimeout } from '@/lib/timeout';
import { useDownloads, type DownloadJob } from '@/store/downloads';
import { useLibrary } from '@/store/library';
import { episodeKey, usePodcasts, type Podcast } from '@/store/podcasts';

const FEED_TIMEOUT_MS = 25_000;

/** Lê o feed na internet. Erros já vêm com o texto para mostrar. */
export async function fetchFeed(url: string): Promise<Feed> {
  let text: string;
  try {
    const res = await withTimeout(fetch(url, { headers: { Accept: 'application/rss+xml, application/xml, text/xml, */*' } }), FEED_TIMEOUT_MS);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await withTimeout(res.text(), FEED_TIMEOUT_MS);
  } catch {
    throw new Error(t('extras.podcast.network'));
  }
  const feed = parseFeed(text);
  if (!feed) throw new Error(t('extras.podcast.invalid'));
  return feed;
}

const normalizeFeedUrl = (raw: string) => {
  const value = raw.trim();
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
};

/** Assina pelo link do feed. Devolve o ID do podcast. */
export async function subscribe(rawUrl: string): Promise<string> {
  const url = normalizeFeedUrl(rawUrl);
  if (usePodcasts.getState().podcasts.some((p) => p.feedUrl === url)) throw new Error(t('extras.podcast.exists'));
  const feed = await fetchFeed(url);
  return usePodcasts.getState().add(url, feed);
}

/** Relê o feed; devolve quantos episódios novos apareceram. */
export async function refreshPodcast(podcast: Podcast): Promise<number> {
  const feed = await fetchFeed(podcast.feedUrl);
  const fresh = newEpisodes(podcast.episodes, feed.episodes).length;
  usePodcasts.getState().update(podcast.id, feed);
  return fresh;
}

/** Baixa o episódio pelo download de link direto (Downloads), que salva na biblioteca ao terminar. */
export function downloadEpisode(podcast: Podcast, episode: Episode): string {
  const ext = extensionOf(fileNameFor(episode.audioUrl, null, episode.mime)) || 'mp3';
  const name = `${podcast.title} - ${episode.title}`.slice(0, 150);
  const id = startDownload(
    { kind: 'media', url: episode.audioUrl, media: 'audio', name: `${name}.${ext}`, mime: episode.mime, size: episode.size },
    'save'
  );
  usePodcasts.getState().linkDownload(episodeKey(podcast.id, episode.id), id);
  return id;
}

/** Duas URIs do mesmo arquivo? O MediaStore devolve volumes diferentes (external × external_primary) para o mesmo ID. */
export function sameMediaUri(a: string, b: string): boolean {
  const media = /^content:\/\/media\/[^/]+\/(audio|video)\/media\/(\d+)/i;
  const ma = media.exec(a);
  const mb = media.exec(b);
  if (ma && mb) return ma[1].toLowerCase() === mb[1].toLowerCase() && ma[2] === mb[2];
  const path = (u: string) => {
    try {
      return decodeURIComponent(u.replace(/^file:\/\//i, ''));
    } catch {
      return u.replace(/^file:\/\//i, '');
    }
  };
  return path(a) === path(b);
}

export type EpisodeState =
  | { kind: 'none' }
  | { kind: 'downloading'; progress: number; jobId: string }
  | { kind: 'failed'; jobId: string }
  | { kind: 'saved'; track: Track | undefined };

/**
 * Situação do download de um episódio: o download em andamento (lista de Downloads) ou onde ele ficou
 * salvo (vale depois de limpar a lista). Arquivo que saiu da biblioteca volta a poder ser baixado.
 */
export function episodeState(
  podcastId: string,
  episodeId: string,
  downloads: Record<string, string>,
  saved: Record<string, string>,
  jobs: DownloadJob[],
  tracks: Track[]
): EpisodeState {
  const key = episodeKey(podcastId, episodeId);
  const jobId = downloads[key];
  const job = jobId ? jobs.find((j) => j.id === jobId) : undefined;
  if (job && (job.status === 'running' || job.status === 'saving' || job.status === 'converting')) {
    return { kind: 'downloading', progress: job.progress, jobId: job.id };
  }
  const uri = saved[key] ?? (job?.status === 'done' ? job.savedUri : undefined);
  const track = uri ? tracks.find((tr) => sameMediaUri(tr.uri, uri)) : undefined;
  // Recém-baixado: a varredura da biblioteca pode ainda não ter achado a faixa.
  if (track || job?.status === 'done') return { kind: 'saved', track };
  if (job && (job.status === 'failed' || job.status === 'cancelled')) return { kind: 'failed', jobId: job.id };
  return { kind: 'none' };
}

/** Guarda onde cada episódio foi salvo assim que o download termina (a lista de Downloads pode ser limpa). */
export function watchPodcastDownloads(): () => void {
  const sync = () => {
    const { downloads, markSaved } = usePodcasts.getState();
    const jobs = useDownloads.getState().jobs;
    for (const [key, jobId] of Object.entries(downloads)) {
      const job = jobs.find((j) => j.id === jobId);
      if (job?.status === 'done' && job.savedUri) markSaved(key, job.savedUri);
    }
  };
  sync();
  return useDownloads.subscribe(sync);
}

/** Faixa da biblioteca para um episódio já baixado (ou undefined, se ainda não apareceu na varredura). */
export function episodeTrack(podcastId: string, episodeId: string): Track | undefined {
  const { downloads, saved } = usePodcasts.getState();
  const state = episodeState(podcastId, episodeId, downloads, saved, useDownloads.getState().jobs, useLibrary.getState().allTracks);
  return state.kind === 'saved' ? state.track : undefined;
}
