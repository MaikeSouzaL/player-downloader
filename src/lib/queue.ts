/**
 * Índices (da fila) da música anterior e da próxima na ordem real de reprodução.
 * `order` é a ordem do modo aleatório; se não bater com a fila, usa a ordem natural.
 * Só dá a volta no fim da fila com "repetir tudo" (`wrap`), como o ExoPlayer.
 */
export function neighborIndices(
  order: number[],
  length: number,
  current: number,
  wrap: boolean
): { previous: number | null; next: number | null } {
  const none = { previous: null, next: null };
  if (length <= 1 || current < 0 || current >= length) return none;
  const seq = order.length === length ? order : Array.from({ length }, (_, i) => i);
  const pos = seq.indexOf(current);
  if (pos < 0) return none;
  const at = (p: number): number | null => {
    if (wrap) return seq[(p + length) % length];
    return p >= 0 && p < length ? seq[p] : null;
  };
  const previous = at(pos - 1);
  const next = at(pos + 1);
  return { previous: previous === current ? null : previous, next: next === current ? null : next };
}
