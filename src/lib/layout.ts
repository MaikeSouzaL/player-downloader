/** Colunas das grades (álbuns, vídeos): 2 no celular em pé, mais com a tela larga (deitado, tablet). */
export function gridColumns(width: number): number {
  return width >= 1000 ? 5 : width >= 800 ? 4 : width >= 560 ? 3 : 2;
}
