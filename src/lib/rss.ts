/**
 * Leitor de feed de podcast (RSS 2.0 + tags do iTunes). Tolerante a feeds "quase certos" e sem
 * dependências, para rodar no app e nos testes do Node. Só episódios com áudio entram.
 */

export type Episode = {
  /** guid do feed (ou o link do áudio, quando não há guid). */
  id: string;
  title: string;
  audioUrl: string;
  mime: string | null;
  /** Bytes informados no feed (-1 se não houver). */
  size: number;
  /** Data de publicação (ms; 0 se não houver). */
  publishedAt: number;
  /** Duração informada no feed (ms; 0 se não houver). */
  durationMs: number;
  description: string;
};

export type Feed = { title: string; author: string | null; image: string | null; episodes: Episode[] };

/** O store guarda tudo num valor só: 100 episódios por podcast basta e não pesa. */
const MAX_EPISODES = 100;
const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|flac|wav)(?:[?#]|$)/i;

/** &amp; &lt; &#39; &#x2019;… → texto. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return named[code.toLowerCase()] ?? whole;
  });
}

/** Conteúdo de texto: tira CDATA e tags HTML, decodifica entidades e junta os espaços. */
function clean(raw: string | undefined): string {
  if (!raw) return '';
  const unwrapped = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  // Tira as tags duas vezes: HTML que veio codificado (&lt;p&gt;) só vira tag depois de decodificar.
  const once = decodeEntities(unwrapped.replace(/<[^>]+>/g, ' '));
  return once.replace(/<\/?[a-z][^>]*>/gi, ' ').replace(/\s+/g, ' ').trim();
}

const escapeTag = (tag: string) => tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Texto da primeira <tag>…</tag> (aceita prefixo, ex.: itunes:author). */
function tagText(xml: string, tag: string): string {
  const m = new RegExp(`<${escapeTag(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeTag(tag)}>`, 'i').exec(xml);
  return clean(m?.[1]);
}

/** Atributo da primeira <tag …>. */
function tagAttr(xml: string, tag: string, attr: string): string | null {
  const open = new RegExp(`<${escapeTag(tag)}\\s[^>]*>`, 'i').exec(xml)?.[0];
  if (!open) return null;
  const m = new RegExp(`\\s${escapeTag(attr)}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(open);
  const value = m?.[2] ?? m?.[3];
  return value === undefined ? null : decodeEntities(value).trim();
}

/** "1:02:03", "62:03", "3723" → ms. */
export function parseDuration(text: string): number {
  const value = text.trim();
  if (!value) return 0;
  if (/^\d+(\.\d+)?$/.test(value)) return Math.round(parseFloat(value) * 1000);
  const parts = value.split(':').map((p) => parseInt(p, 10));
  if (parts.some((p) => !Number.isFinite(p))) return 0;
  return parts.reduce((total, p) => total * 60 + p, 0) * 1000;
}

/** Tipo audio/*; tipo genérico (application/octet-stream) ou ausente vale pela extensão. Vídeo fica de fora. */
const isAudio = (url: string, mime: string | null) => {
  const type = (mime ?? '').toLowerCase();
  if (type.startsWith('audio/')) return true;
  return !type.startsWith('video/') && AUDIO_EXT.test(url);
};

/** null quando o texto não é um feed RSS. */
export function parseFeed(xml: string): Feed | null {
  if (!/<rss[\s>]/i.test(xml) && !/<channel[\s>]/i.test(xml)) return null;
  const channelStart = xml.search(/<channel[\s>]/i);
  const firstItem = xml.search(/<item[\s>]/i);
  const head = xml.slice(Math.max(0, channelStart), firstItem > 0 ? firstItem : undefined);
  // <image><url> do RSS e o <itunes:image href> (este costuma ser a capa quadrada grande).
  const imageBlock = /<image(?:\s[^>]*)?>([\s\S]*?)<\/image>/i.exec(head)?.[1];
  const image = tagAttr(head, 'itunes:image', 'href') || (imageBlock ? tagText(imageBlock, 'url') : '') || null;

  const episodes: Episode[] = [];
  const itemRe = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRe.exec(xml)) && episodes.length < MAX_EPISODES) {
    const item = match[1];
    const audioUrl = tagAttr(item, 'enclosure', 'url');
    if (!audioUrl || !/^https?:\/\//i.test(audioUrl)) continue;
    const mime = tagAttr(item, 'enclosure', 'type');
    if (!isAudio(audioUrl, mime)) continue;
    const length = Number(tagAttr(item, 'enclosure', 'length'));
    const published = Date.parse(tagText(item, 'pubDate'));
    episodes.push({
      id: tagText(item, 'guid') || audioUrl,
      title: tagText(item, 'title') || tagText(item, 'itunes:title') || audioUrl,
      audioUrl,
      mime: mime || null,
      size: Number.isFinite(length) && length > 0 ? length : -1,
      publishedAt: Number.isFinite(published) ? published : 0,
      durationMs: parseDuration(tagText(item, 'itunes:duration')),
      description: (tagText(item, 'itunes:summary') || tagText(item, 'description')).slice(0, 240),
    });
  }
  const title = tagText(head, 'title');
  if (!title && episodes.length === 0) return null;
  return {
    title: title || 'Podcast',
    author: tagText(head, 'itunes:author') || tagText(head, 'managingEditor') || null,
    image,
    episodes,
  };
}

/** Episódios novos (por ID) que ainda não estavam na lista. */
export function newEpisodes(before: Episode[], after: Episode[]): Episode[] {
  const known = new Set(before.map((e) => e.id));
  return after.filter((e) => !known.has(e.id));
}
