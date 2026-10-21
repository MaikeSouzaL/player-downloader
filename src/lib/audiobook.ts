/**
 * Regras do "Lembrar onde parou" (audiolivros, podcasts, aulas). Sem React Native, para os testes do Node.
 */

/** A partir de 20 minutos o arquivo conta como longo. */
export const LONG_TRACK_MS = 20 * 60_000;

export type SavedSpot = { position: number; duration: number; at: number };

export const isLong = (durationMs: number) => durationMs >= LONG_TRACK_MS;

/**
 * De onde continuar: só se parou no meio (passou dos primeiros 15 s e faltam mais de 30 s).
 * Quem ouviu até o fim começa de novo. Duração mudou muito (outro arquivo com o mesmo ID): ignora.
 */
export function resumePosition(saved: SavedSpot | undefined, durationMs: number): number | null {
  if (!saved || !isLong(durationMs)) return null;
  if (saved.duration > 0 && Math.abs(saved.duration - durationMs) > 5_000) return null;
  if (saved.position < 15_000 || saved.position > durationMs - 30_000) return null;
  return saved.position;
}

/** Mantém só os `limit` mais recentes (o store não cresce para sempre). */
export function trimSpots<T extends { at: number }>(spots: Record<string, T>, limit: number): Record<string, T> {
  const entries = Object.entries(spots);
  if (entries.length <= limit) return spots;
  return Object.fromEntries(entries.sort((a, b) => b[1].at - a[1].at).slice(0, limit));
}
