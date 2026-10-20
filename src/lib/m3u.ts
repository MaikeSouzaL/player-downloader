import { normalize } from './format.ts';

/** Uma linha de música de um arquivo .m3u/.m3u8, com o #EXTINF quando existe. */
export type M3UEntry = { path: string; title: string | null; artist: string | null; durationSec: number | null };

/** O mínimo de uma música para ligar uma entrada do M3U à biblioteca. */
export type M3UTrack = { id: string; path: string | null; fileName: string | null; title: string; artist: string | null; duration: number };

/** Lê um M3U simples ou estendido (#EXTM3U, #EXTINF, #PLAYLIST). */
export function parseM3U(text: string): { name: string | null; entries: M3UEntry[] } {
  let name: string | null = null;
  let info: Omit<M3UEntry, 'path'> | null = null;
  const entries: M3UEntry[] = [];

  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const extinf = /^#EXTINF:\s*(-?\d+(?:\.\d+)?)?[^,]*,(.*)$/i.exec(line);
      if (extinf) {
        const seconds = extinf[1] !== undefined ? Number(extinf[1]) : NaN;
        const label = extinf[2].trim();
        const dash = label.indexOf(' - ');
        info = {
          durationSec: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
          artist: dash > 0 ? label.slice(0, dash).trim() : null,
          title: (dash > 0 ? label.slice(dash + 3) : label).trim() || null,
        };
      } else if (/^#PLAYLIST:/i.test(line)) {
        name = line.slice('#PLAYLIST:'.length).trim() || null;
      }
      continue;
    }
    entries.push({ path: cleanPath(line), title: info?.title ?? null, artist: info?.artist ?? null, durationSec: info?.durationSec ?? null });
    info = null;
  }
  return { name, entries };
}

/** file://, %20, barras do Windows → caminho comum com "/". */
export function cleanPath(path: string): string {
  let p = path.trim();
  if (/^file:\/\//i.test(p)) p = p.replace(/^file:\/\//i, '');
  if (/%[0-9a-f]{2}/i.test(p)) {
    try {
      p = decodeURIComponent(p);
    } catch {
      // Mantém como veio se a codificação estiver quebrada.
    }
  }
  return p.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
}

const key = (path: string) => cleanPath(path).toLowerCase();
const tail = (path: string, parts: number) => key(path).split('/').filter(Boolean).slice(-parts).join('/');

/**
 * Liga as entradas às músicas do aparelho: caminho exato, depois pasta + nome do arquivo,
 * depois só o nome do arquivo (se for único) e por fim título + artista do #EXTINF.
 */
export function matchEntries<T extends M3UTrack>(entries: M3UEntry[], tracks: T[]): { matched: T[]; missing: M3UEntry[] } {
  const byPath = new Map<string, T>();
  const byTail2 = new Map<string, T | null>();
  const byName = new Map<string, T | null>();
  const byLabel = new Map<string, T | null>();
  const addUnique = (map: Map<string, T | null>, k: string, t: T) => map.set(k, map.has(k) ? null : t);

  for (const t of tracks) {
    if (t.path) {
      byPath.set(key(t.path), t);
      addUnique(byTail2, tail(t.path, 2), t);
      addUnique(byName, tail(t.path, 1), t);
    } else if (t.fileName) {
      addUnique(byName, t.fileName.toLowerCase(), t);
    }
    addUnique(byLabel, `${normalize(t.title)}|${normalize(t.artist ?? '')}`, t);
  }

  const matched: T[] = [];
  const missing: M3UEntry[] = [];
  for (const e of entries) {
    const found =
      byPath.get(key(e.path)) ??
      byTail2.get(tail(e.path, 2)) ??
      byName.get(tail(e.path, 1)) ??
      (e.title ? byLabel.get(`${normalize(e.title)}|${normalize(e.artist ?? '')}`) : undefined);
    if (found) matched.push(found);
    else missing.push(e);
  }
  return { matched, missing };
}

/** Gera um M3U estendido com caminhos absolutos (outros players do aparelho conseguem abrir). */
export function writeM3U(name: string, tracks: M3UTrack[]): string {
  const lines = ['#EXTM3U', `#PLAYLIST:${name.replace(/[\r\n]+/g, ' ')}`];
  for (const t of tracks) {
    if (!t.path) continue;
    const label = t.artist ? `${t.artist} - ${t.title}` : t.title;
    lines.push(`#EXTINF:${Math.round(t.duration / 1000)},${label.replace(/[\r\n]+/g, ' ')}`, t.path);
  }
  return lines.join('\n') + '\n';
}
