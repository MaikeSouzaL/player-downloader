/**
 * Texto do erro para mostrar ao usuário. No iPhone o Expo embrulha a mensagem
 * ("Calling the 'x' function has failed → Caused by: …"): fica só a causa.
 */
export function errorMessage(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  const marker = 'Caused by: ';
  const at = text.lastIndexOf(marker);
  return at >= 0 ? text.slice(at + marker.length).trim() : text;
}
