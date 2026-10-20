/**
 * Junta o que estava salvo com os valores padrão aceitando só campos do mesmo tipo:
 * dados corrompidos ou de uma versão antiga não derrubam o app.
 */
export function mergeValidated<T extends object>(persisted: unknown, current: T): T {
  if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) return current;
  const out = { ...current } as Record<string, unknown>;
  const defaults = current as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(persisted as Record<string, unknown>)) {
    if (!(key in defaults) || typeof defaults[key] === 'function') continue;
    const def = defaults[key];
    const ok =
      def === null || def === undefined
        ? true
        : Array.isArray(def)
          ? Array.isArray(value)
          : value !== null && typeof value === typeof def && Array.isArray(value) === Array.isArray(def);
    if (ok) out[key] = value;
  }
  return out as unknown as T;
}
