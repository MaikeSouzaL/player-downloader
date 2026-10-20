import { noteDeepLink, setPendingFromFileUrl } from '@/store/share';

/**
 * Links que abrem o app vindos do sistema. Arquivos (iPhone: "Abrir com / Copiar para o Ritmo";
 * Android: "Abrir com" de um gerenciador de arquivos) vão para a tela /share em vez de virar rota.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (path.startsWith('file://')) {
      setPendingFromFileUrl(path);
      return '/share';
    }
    // Android: o conteúdo (content://…) é lido pelo módulo nativo na própria tela.
    if (path.startsWith('content://')) return '/share';
    // iPhone: a extensão "Compartilhar" abre ritmo://grab?url=… — guarda para não abrir duas vezes.
    const grab = /^(?:ritmo:\/\/|\/)?grab\?(.*)$/.exec(path);
    if (grab) {
      const url = new URLSearchParams(grab[1]).get('url');
      if (url) noteDeepLink(url);
    }
  } catch {
    // Link estranho: abre o app normalmente.
  }
  return path;
}
