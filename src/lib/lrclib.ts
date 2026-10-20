import { normalize } from './format.ts';

/**
 * Letras do LRCLIB (lrclib.net): banco aberto e gratuito, sem chave nem cadastro.
 * Só é chamado quando a pessoa toca em "Buscar letra"; nada é enviado sozinho.
 */
const API = 'https://lrclib.net/api';
const USER_AGENT = 'Ritmo (player de música sem anúncios)';
const MAX_DURATION_DIFF_S = 4;

/** Registro como vem da API. */
export type LrclibRecord = {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string | null;
  duration: number;
  instrumental: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
};

export type LyricsMatch = {
  id: number;
  title: string;
  artist: string;
  album: string | null;
  durationSec: number;
  synced: boolean;
  instrumental: boolean;
  /** Letra pronta para salvar: a sincronizada (LRC) quando existe. */
  text: string;
};

export type LyricsQuery = { title: string; artist?: string | null; album?: string | null; durationMs?: number };

/**
 * Erro da consulta ao LRCLIB. A mensagem fica em português (para os testes e o log); a tela
 * traduz pelo `code` ('offline' = sem rede, 'http' = resposta com erro, com o `status`).
 */
export class LrclibError extends Error {
  code: 'offline' | 'http';
  status: number | null;

  constructor(code: 'offline' | 'http', message: string, status: number | null = null) {
    super(message);
    this.name = 'LrclibError';
    this.code = code;
    this.status = status;
  }
}

type Fetch = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/** Tira do título o que atrapalha a busca: extensão, número da faixa, "(Official Video)", "feat. X". */
export function cleanTitle(title: string): string {
  return title
    .replace(/\.(mp3|m4a|flac|ogg|opus|wav|aac|wma)$/i, '')
    .replace(/^\s*\d{1,3}\s*[-._)]\s*/, '')
    .replace(/[([](?:[^)\]]*\b(?:official|video|clipe|lyrics?|letra|audio|áudio|hd|hq|4k|visualizer|remaster(?:ed)?)\b[^)\]]*)[)\]]/gi, '')
    .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** "Artista desconhecido" e afins não ajudam: melhor buscar só pelo título. */
function usefulArtist(artist?: string | null): string | null {
  if (!artist) return null;
  const n = normalize(artist);
  return n === '' || n === '<unknown>' || n === 'unknown' || n.includes('desconhecido') ? null : artist.trim();
}

export function toMatch(r: LrclibRecord): LyricsMatch | null {
  const synced = r.syncedLyrics?.trim() || '';
  const plain = r.plainLyrics?.trim() || '';
  if (!synced && !plain && !r.instrumental) return null;
  return {
    id: r.id,
    title: r.trackName,
    artist: r.artistName,
    album: r.albumName ?? null,
    durationSec: r.duration,
    synced: !!synced,
    instrumental: r.instrumental,
    text: synced || plain,
  };
}

function isRecord(value: unknown): value is LrclibRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return typeof r.id === 'number' && typeof r.trackName === 'string' && typeof r.artistName === 'string' && typeof r.duration === 'number';
}

/** Pontua candidatos (título igual, artista igual, duração próxima, sincronizada) e ordena do melhor ao pior. */
export function rankMatches(records: unknown[], query: LyricsQuery): LyricsMatch[] {
  const title = normalize(cleanTitle(query.title));
  const artist = usefulArtist(query.artist);
  const wantArtist = artist ? normalize(artist) : null;
  const wantDuration = query.durationMs ? query.durationMs / 1000 : null;

  const scored: { match: LyricsMatch; score: number }[] = [];
  const seen = new Set<number>();
  for (const r of records) {
    if (!isRecord(r) || seen.has(r.id)) continue;
    seen.add(r.id);
    const match = toMatch(r);
    if (!match) continue;
    let score = 0;
    if (wantDuration !== null && r.duration > 0) {
      const diff = Math.abs(r.duration - wantDuration);
      if (diff > MAX_DURATION_DIFF_S * 4) continue; // outra versão da música
      score += diff <= MAX_DURATION_DIFF_S ? 30 : 10;
    }
    const gotTitle = normalize(cleanTitle(r.trackName));
    if (gotTitle === title) score += 40;
    else if (gotTitle.includes(title) || title.includes(gotTitle)) score += 20;
    if (wantArtist) {
      const gotArtist = normalize(r.artistName);
      if (gotArtist === wantArtist) score += 25;
      else if (gotArtist.includes(wantArtist) || wantArtist.includes(gotArtist)) score += 12;
    }
    if (match.synced) score += 8;
    if (match.instrumental) score -= 5;
    scored.push({ match, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.match);
}

async function getJson(fetchImpl: Fetch, url: string, signal?: AbortSignal): Promise<unknown | null> {
  let res;
  try {
    res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, 'Lrclib-Client': USER_AGENT }, signal });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e;
    throw new LrclibError('offline', 'Sem conexão com o LRCLIB. Verifique a internet e tente de novo.');
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new LrclibError('http', `O LRCLIB respondeu com erro ${res.status}. Tente mais tarde.`, res.status);
  return res.json();
}

/**
 * Busca a letra: primeiro a correspondência exata (/api/get, que usa a duração),
 * depois a busca ampla (/api/search). Devolve os candidatos do melhor ao pior.
 */
export async function findLyrics(query: LyricsQuery, fetchImpl: Fetch = fetch as unknown as Fetch, signal?: AbortSignal): Promise<LyricsMatch[]> {
  const title = cleanTitle(query.title);
  if (!title) return [];
  const artist = usefulArtist(query.artist);
  const found: unknown[] = [];

  if (artist && query.durationMs) {
    const params = new URLSearchParams({ track_name: title, artist_name: artist, duration: String(Math.round(query.durationMs / 1000)) });
    if (query.album) params.set('album_name', query.album);
    const exact = await getJson(fetchImpl, `${API}/get?${params}`, signal);
    if (exact) found.push(exact);
  }

  const search = artist ? new URLSearchParams({ track_name: title, artist_name: artist }) : new URLSearchParams({ q: title });
  const list = await getJson(fetchImpl, `${API}/search?${search}`, signal);
  if (Array.isArray(list)) found.push(...list.slice(0, 20));

  return rankMatches(found, query);
}
