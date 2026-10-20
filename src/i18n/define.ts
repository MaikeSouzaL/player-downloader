/**
 * Declara um grupo de textos nas três línguas. O português define as chaves; inglês e
 * espanhol precisam ter exatamente as mesmas (o TypeScript reclama se faltar alguma).
 * Textos com variáveis usam {nome}; plurais usam as chaves `<chave>.one` e `<chave>.many` com {n}.
 */
export function defineStrings<const T extends Record<string, string>>(pt: T, en: Record<keyof T, string>, es: Record<keyof T, string>) {
  return { pt, en, es };
}
