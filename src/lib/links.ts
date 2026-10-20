/**
 * Classificação de links recebidos pelo "Compartilhar" ou colados em Downloads.
 * O Ritmo só baixa arquivos de mídia diretos (um .mp3, um .mp4, o arquivo de um podcast…).
 * Serviços de streaming e redes sociais protegem os arquivos e não permitem baixar: ficam de fora.
 */

export type LinkKind = 'media' | 'blocked' | 'page' | 'invalid';
export type MediaType = 'audio' | 'video';

/** Domínios que não permitem baixar o conteúdo (termos de uso / direitos autorais). */
const BLOCKED: { service: string; hosts: string[] }[] = [
  // Inclui os servidores de arquivos (CDN) de cada serviço: o link "direto" de lá também é protegido.
  { service: 'YouTube', hosts: ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'googlevideo.com', 'ytimg.com', 'ggpht.com'] },
  { service: 'Facebook', hosts: ['facebook.com', 'fb.watch', 'fb.com', 'fbwat.ch', 'fbcdn.net', 'messenger.com'] },
  { service: 'Instagram', hosts: ['instagram.com', 'instagr.am', 'cdninstagram.com', 'threads.net'] },
  { service: 'TikTok', hosts: ['tiktok.com', 'tiktokv.com', 'tiktokcdn.com', 'tiktokcdn-us.com', 'byteoversea.com', 'muscdn.com'] },
  { service: 'X (Twitter)', hosts: ['twitter.com', 'x.com', 't.co', 'twimg.com'] },
  { service: 'Reddit', hosts: ['reddit.com', 'redd.it', 'redditmedia.com'] },
  { service: 'Spotify', hosts: ['spotify.com', 'spotify.link', 'scdn.co', 'spotifycdn.com'] },
  { service: 'Deezer', hosts: ['deezer.com', 'deezer.page.link', 'dzcdn.net'] },
  { service: 'SoundCloud', hosts: ['soundcloud.com', 'on.soundcloud.com', 'sndcdn.com'] },
  { service: 'Apple Music', hosts: ['music.apple.com', 'itunes.apple.com'] },
  { service: 'Amazon Music', hosts: ['music.amazon.com', 'music.amazon.com.br'] },
  { service: 'Netflix', hosts: ['netflix.com', 'nflxvideo.net'] },
  { service: 'Kwai', hosts: ['kwai.com', 'kw.ai', 'kwaicdn.com'] },
  { service: 'Vimeo', hosts: ['vimeo.com', 'vimeocdn.com'] },
  { service: 'Twitch', hosts: ['twitch.tv', 'ttvnw.net'] },
  { service: 'Dailymotion', hosts: ['dailymotion.com', 'dai.ly', 'dmcdn.net'] },
];

const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'wav', 'wma', 'amr', 'aiff', 'aif', 'alac'];
const VIDEO_EXT = ['mp4', 'm4v', 'mkv', 'webm', 'mov', '3gp', 'avi'];

/** Primeiro link http(s) dentro de um texto compartilhado ("Olha isso: https://…"). */
export function extractUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = /https?:\/\/[^\s<>"']+/i.exec(text);
  if (!match) return null;
  let url = match[0];
  const count = (c: string) => url.split(c).length - 1;
  // Tira a pontuação do fim da frase; ")" e "]" só saem se não fecharem um "(" / "[" do próprio link (ex.: Wikipédia).
  for (;;) {
    const last = url.at(-1);
    if (last && ',.;:!?…”’»'.includes(last)) url = url.slice(0, -1);
    else if (last === ')' && count('(') < count(')')) url = url.slice(0, -1);
    else if (last === ']' && count('[') < count(']')) url = url.slice(0, -1);
    else return url;
  }
}

function parse(url: string): URL | null {
  try {
    const u = new URL(url.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

/** Serviço bloqueado do link (ex.: "YouTube"), ou null. */
export function blockedService(url: string): string | null {
  const u = parse(url);
  if (!u) return null;
  // "youtube.com." (com ponto final) também é o YouTube.
  const host = u.hostname.toLowerCase().replace(/\.+$/, '').replace(/^www\.|^m\./, '');
  for (const entry of BLOCKED) {
    if (entry.hosts.some((h) => host === h || host.endsWith(`.${h}`))) return entry.service;
  }
  return null;
}

/** Extensão do arquivo no caminho do link (sem a query string). */
export function extensionOf(nameOrPath: string): string {
  const clean = nameOrPath.split(/[?#]/)[0];
  const last = clean.slice(clean.lastIndexOf('/') + 1);
  const dot = last.lastIndexOf('.');
  return dot > 0 ? last.slice(dot + 1).toLowerCase() : '';
}

/** Áudio ou vídeo pelo tipo MIME ou pela extensão; null se não for mídia. */
export function mediaTypeOf(mime: string | null | undefined, nameOrUrl?: string): MediaType | null {
  const m = (mime ?? '').toLowerCase().split(';')[0].trim();
  if (m.startsWith('audio/') || m === 'application/ogg') return 'audio';
  if (m.startsWith('video/')) return 'video';
  const ext = nameOrUrl ? extensionOf(nameOrUrl) : '';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  if (VIDEO_EXT.includes(ext)) return 'video';
  return null;
}

/**
 * O que fazer com um link: `media` (arquivo de áudio/vídeo direto), `blocked` (streaming/rede social),
 * `page` (página comum, sem arquivo) ou `invalid`.
 * `contentType` vem de uma requisição HEAD, quando deu para fazer.
 */
export function classifyLink(url: string, contentType?: string | null): { kind: LinkKind; service?: string; media?: MediaType } {
  const u = parse(url);
  if (!u) return { kind: 'invalid' };
  const service = blockedService(url);
  if (service) return { kind: 'blocked', service };
  // O servidor disse que é uma página (HTML, texto): a extensão do link não importa.
  if (isPageType(contentType)) return { kind: 'page' };
  const media = mediaTypeOf(contentType, u.pathname);
  if (media) return { kind: 'media', media };
  return { kind: 'page' };
}

/** Tipo de página (HTML, texto, JSON, XML), não de arquivo de mídia. */
export function isPageType(contentType: string | null | undefined): boolean {
  const type = (contentType ?? '').toLowerCase();
  return type.startsWith('text/') || type.includes('html') || type.includes('json') || type.includes('xml');
}

/** Formatos que o iPhone toca (AVFoundation); ogg, webm, mkv, wma, avi… não abrem lá. */
const IOS_PLAYABLE = ['mp3', 'm4a', 'aac', 'wav', 'aif', 'aiff', 'aifc', 'caf', 'flac', 'm4b', 'alac', 'opus', 'mp4', 'mov', 'm4v', '3gp'];

export function playableOnIos(name: string): boolean {
  const ext = extensionOf(name);
  return !ext || IOS_PLAYABLE.includes(ext);
}

/** Nome do arquivo: Content-Disposition, senão o fim do caminho; garante a extensão. */
export function fileNameFor(url: string, contentDisposition?: string | null, mime?: string | null): string {
  let name = '';
  if (contentDisposition) {
    const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(contentDisposition);
    const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(contentDisposition);
    const raw = (star?.[1] ?? plain?.[1] ?? '').trim().replace(/^"|"$/g, '');
    try {
      name = decodeURIComponent(raw);
    } catch {
      name = raw;
    }
  }
  if (!name) {
    const u = parse(url);
    const last = u ? u.pathname.slice(u.pathname.lastIndexOf('/') + 1) : '';
    try {
      name = decodeURIComponent(last);
    } catch {
      name = last;
    }
  }
  // Sem "." / ".." nem pontos nas pontas (o nome vem do servidor).
  name = name.replace(/[\\/:*?"<>|]+/g, '_').trim().replace(/^\.+|\.+$/g, '').trim() || 'download';
  if (!extensionOf(name)) {
    const m = (mime ?? '').toLowerCase().split(';')[0].trim();
    const ext = m.includes('mpeg') && m.startsWith('audio') ? 'mp3' : m.includes('mp4') && m.startsWith('audio') ? 'm4a' : m.startsWith('video/mp4') ? 'mp4' : m.split('/')[1];
    if (ext && /^[a-z0-9]{2,5}$/.test(ext)) name = `${name}.${ext}`;
  }
  return name.slice(0, 120);
}

/** Nome do arquivo de áudio gerado a partir de um vídeo: "clipe.mp4" → "clipe.m4a". */
export function audioNameFor(name: string): string {
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}.m4a`;
}
