/**
 * Tela aberta agora (atualizada pelo `_layout`). Serve para decidir, fora dos componentes, se o
 * app pode mudar de tela sozinho — por exemplo, abrir a aba Músicas quando um download termina,
 * mas só se a pessoa estiver nas telas de download (nunca no meio do player ou de um vídeo).
 */
let current = '/';

export function setCurrentRoute(pathname: string) {
  current = pathname;
}

export function currentRoute(): string {
  return current;
}

/** Telas de onde o app pode levar a pessoa direto para a biblioteca quando o download termina. */
const DOWNLOAD_SCREENS = ['/', '/downloads', '/grab', '/browser', '/share'];

export function onDownloadScreen(): boolean {
  return DOWNLOAD_SCREENS.includes(current);
}
