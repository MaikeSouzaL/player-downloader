import type { Brand } from '@/components/BrandIcon';

/** Sites com atalho no navegador interno: logo, cor da marca e endereço (versão para celular quando existe). */
export type BrandSite = { brand: Brand; name: string; url: string; color: string; hosts: string[] };

export const BRAND_SITES: BrandSite[] = [
  { brand: 'youtube', name: 'YouTube', url: 'https://m.youtube.com', color: '#FF0000', hosts: ['youtube.com', 'youtu.be'] },
  { brand: 'instagram', name: 'Instagram', url: 'https://www.instagram.com', color: '#E4405F', hosts: ['instagram.com'] },
  { brand: 'tiktok', name: 'TikTok', url: 'https://www.tiktok.com', color: '#000000', hosts: ['tiktok.com'] },
  { brand: 'facebook', name: 'Facebook', url: 'https://m.facebook.com', color: '#0866FF', hosts: ['facebook.com', 'fb.watch'] },
  { brand: 'x', name: 'X', url: 'https://x.com', color: '#000000', hosts: ['x.com', 'twitter.com'] },
  { brand: 'reddit', name: 'Reddit', url: 'https://www.reddit.com', color: '#FF4500', hosts: ['reddit.com', 'redd.it'] },
  { brand: 'vimeo', name: 'Vimeo', url: 'https://vimeo.com', color: '#1AB7EA', hosts: ['vimeo.com'] },
  { brand: 'dailymotion', name: 'Dailymotion', url: 'https://www.dailymotion.com', color: '#0D0D0D', hosts: ['dailymotion.com', 'dai.ly'] },
  { brand: 'soundcloud', name: 'SoundCloud', url: 'https://m.soundcloud.com', color: '#FF5500', hosts: ['soundcloud.com'] },
  { brand: 'twitch', name: 'Twitch', url: 'https://m.twitch.tv', color: '#9146FF', hosts: ['twitch.tv'] },
  { brand: 'pinterest', name: 'Pinterest', url: 'https://www.pinterest.com', color: '#BD081C', hosts: ['pinterest.com', 'pin.it'] },
  { brand: 'bilibili', name: 'Bilibili', url: 'https://m.bilibili.com', color: '#00A1D6', hosts: ['bilibili.com', 'b23.tv'] },
];

/** Site da marca de um link (para mostrar o logo ao lado), ou null. */
export function brandForUrl(url: string): BrandSite | null {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.+$/, '');
  } catch {
    return null;
  }
  return BRAND_SITES.find((site) => site.hosts.some((h) => host === h || host.endsWith(`.${h}`))) ?? null;
}
