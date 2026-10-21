/**
 * Retrospectiva do mês: tempo ouvido, dias com música e as músicas/artistas mais tocados.
 * Sem React Native, para os testes do Node.
 */

/** "2026-10" para outubro de 2026. */
export const monthKey = (d: Date = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Mês anterior (-1) ou seguinte (+1) de "AAAA-MM". */
export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Mantém só os `limit` meses mais recentes (o histórico não cresce para sempre). */
export function keepRecentMonths<T>(months: Record<string, T>, limit: number): Record<string, T> {
  const keys = Object.keys(months).sort().reverse();
  if (keys.length <= limit) return months;
  return Object.fromEntries(keys.slice(0, limit).map((k) => [k, months[k]]));
}

export type RecapRank = { id: string; count: number };
export type Recap = {
  /** Tempo ouvido no mês (ms). */
  listenedMs: number;
  /** Dias do mês com pelo menos 1 minuto ouvido. */
  days: number;
  /** Total de músicas iniciadas no mês. */
  plays: number;
  topTracks: RecapRank[];
  /** Por nome do artista (`id` é o nome). */
  topArtists: RecapRank[];
};

const byCount = (a: RecapRank, b: RecapRank) => b.count - a.count || a.id.localeCompare(b.id);

/**
 * `plays`: ID da faixa → vezes tocada no mês. `playTime`: "AAAA-MM-DD" → ms ouvidos.
 * `artistOf` devolve o artista de uma faixa (null: faixa sumiu da biblioteca e não entra no ranking de artistas).
 */
export function buildRecap(
  month: string,
  plays: Record<string, number> | undefined,
  playTime: Record<string, number>,
  artistOf: (id: string) => string | null,
  limit = 10
): Recap {
  let listenedMs = 0;
  let days = 0;
  for (const [day, ms] of Object.entries(playTime)) {
    if (!day.startsWith(`${month}-`)) continue;
    listenedMs += ms;
    if (ms >= 60_000) days++;
  }
  const entries = Object.entries(plays ?? {}).filter(([, n]) => n > 0);
  const artists = new Map<string, number>();
  for (const [id, n] of entries) {
    const artist = artistOf(id);
    if (artist) artists.set(artist, (artists.get(artist) ?? 0) + n);
  }
  return {
    listenedMs,
    days,
    plays: entries.reduce((sum, [, n]) => sum + n, 0),
    topTracks: entries.map(([id, count]) => ({ id, count })).sort(byCount).slice(0, limit),
    topArtists: [...artists].map(([id, count]) => ({ id, count })).sort(byCount).slice(0, limit),
  };
}
