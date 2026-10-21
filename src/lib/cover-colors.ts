/**
 * Cores do player tiradas da capa (testado no Node). O nativo devolve a cor predominante; aqui ela
 * vira o tom do degradê por cima da capa desfocada e a cor de destaque, sempre com contraste legível.
 */

export type Rgb = { r: number; g: number; b: number };

export type CoverPalette = {
  /** Topo do degradê (rgba) por cima da capa desfocada. */
  tint: string;
  /** Destaque (botão de tocar, barra de progresso). null: capa sem cor, fica a do tema. */
  accent: string | null;
  /** Ícone/texto em cima do destaque. */
  onAccent: string;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** "#0A0A0A" + 0.9 → "rgba(10,10,10,0.9)". Cor inválida vira preto. */
export function rgbaOf(hex: string, alpha: number): string {
  const { r, g, b } = parseHex(hex) ?? { r: 0, g: 0, b: 0 };
  return `rgba(${r},${g},${b},${alpha})`;
}

function rgbToHsl({ r, g, b }: Rgb) {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rn ? ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60 : max === gn ? ((bn - rn) / d + 2) * 60 : ((rn - gn) / d + 4) * 60;
  return { h, s, l };
}

function hslToRgb({ h, s, l }: { h: number; s: number; l: number }): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

/** Luminância relativa (WCAG). */
export function luminance({ r, g, b }: Rgb): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/**
 * Paleta do player a partir da cor predominante da capa. `background` é o fundo do player
 * (muda com o tema claro/escuro/preto puro): o destaque precisa ter contraste 3:1 com ele.
 */
export function coverPalette(dominant: string, isDark: boolean, background: string): CoverPalette | null {
  const rgb = parseHex(dominant);
  if (!rgb) return null;
  const { h, s, l } = rgbToHsl(rgb);
  const bg = parseHex(background) ?? (isDark ? BLACK : WHITE);
  const tint = hslToRgb({ h, s: Math.min(s, isDark ? 0.6 : 0.55), l: isDark ? clamp(l, 0.16, 0.28) : clamp(l, 0.82, 0.9) });
  const tintText = `rgba(${Math.round(tint.r)},${Math.round(tint.g)},${Math.round(tint.b)},${isDark ? 0.7 : 0.75})`;
  // Capa acinzentada: o tom muda, mas o destaque continua o do tema (cinza como destaque some).
  if (s < 0.15) return { tint: tintText, accent: null, onAccent: '#FFFFFF' };

  const sat = clamp(s, 0.5, 0.9);
  let lightness = isDark ? 0.6 : 0.42;
  let accent = hslToRgb({ h, s: sat, l: lightness });
  for (let i = 0; i < 12 && contrast(accent, bg) < 3; i++) {
    lightness = clamp(lightness + (isDark ? 0.04 : -0.04), 0.05, 0.95);
    accent = hslToRgb({ h, s: sat, l: lightness });
  }
  const onAccent = contrast(accent, WHITE) >= contrast(accent, BLACK) ? '#FFFFFF' : '#000000';
  return { tint: tintText, accent: toHex(accent), onAccent };
}
