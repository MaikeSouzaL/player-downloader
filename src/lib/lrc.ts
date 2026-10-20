export type LyricLine = { time: number; text: string };

export type Lyrics =
  | { synced: true; lines: LyricLine[] }
  | { synced: false; lines: { time: -1; text: string }[] };

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const META_TAG = /^\[(ar|ti|al|by|au|length|re|ve|#):.*\]$/i;
const OFFSET_TAG = /^\[offset:\s*([+-]?\d+)\]$/i;

/**
 * Lê uma letra LRC ("[01:23.45]texto"). Linhas com vários tempos viram várias entradas.
 * Sem nenhum tempo válido, devolve o texto como letra simples (não sincronizada).
 */
export function parseLyrics(raw: string): Lyrics {
  const lines: LyricLine[] = [];
  let offset = 0;
  const plain: string[] = [];

  for (const rawLine of raw.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
    const off = OFFSET_TAG.exec(line);
    if (off) {
      offset = Number(off[1]);
      continue;
    }
    if (META_TAG.test(line)) continue;

    const times: number[] = [];
    TIME_TAG.lastIndex = 0;
    let match: RegExpExecArray | null;
    let lastEnd = 0;
    while ((match = TIME_TAG.exec(line)) && match.index === lastEnd) {
      const [, mm, ss, frac = '0'] = match;
      const ms = Number(frac.padEnd(3, '0').slice(0, 3));
      times.push(Number(mm) * 60000 + Number(ss) * 1000 + ms);
      lastEnd = TIME_TAG.lastIndex;
    }
    const text = line.slice(lastEnd).trim();
    if (times.length === 0) {
      plain.push(line);
      continue;
    }
    for (const time of times) lines.push({ time: Math.max(0, time - offset), text });
  }

  if (lines.length === 0) {
    // Remove linhas vazias do começo e do fim, mantendo os espaços entre estrofes.
    const text = plain.join('\n').trim();
    return { synced: false, lines: text ? text.split('\n').map((t) => ({ time: -1, text: t })) : [] };
  }
  lines.sort((a, b) => a.time - b.time);
  return { synced: true, lines };
}

/** Índice da linha que está tocando agora (-1 antes da primeira). Busca binária. */
export function activeLine(lines: LyricLine[], positionMs: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= positionMs) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
