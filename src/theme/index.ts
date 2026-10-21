import { useColorScheme } from 'react-native';

import type { StringKey } from '@/i18n';
import { useSettings } from '@/store/settings';

/** Paleta tirada dos recursos do Lark Player (day_* / night_*), com o laranja do logo Vinil como destaque. */
const light = {
  background: '#F2F4F5',
  surface: '#FFFFFF',
  surfaceAlt: '#E8ECEE',
  text: '#0A0A0A',
  textMuted: 'rgba(10,10,10,0.5)',
  textWeak: 'rgba(10,10,10,0.3)',
  border: 'rgba(10,10,10,0.06)',
  primary: '#FD7846',
  primaryContent: '#E2552A',
  primarySoft: '#FAE8E2',
  onPrimary: '#FFFFFF',
  danger: '#F44F5E',
  scrim: 'rgba(0,0,0,0.5)',
  ripple: 'rgba(0,0,0,0.08)',
  playerBackground: '#FFFFFF',
};

const dark: typeof light = {
  background: '#0A0A0A',
  surface: '#191919',
  surfaceAlt: '#222324',
  text: '#F3F6F8',
  textMuted: 'rgba(243,246,248,0.6)',
  textWeak: 'rgba(243,246,248,0.36)',
  border: 'rgba(243,246,248,0.06)',
  primary: '#FD7846',
  primaryContent: '#FF9A73',
  primarySoft: '#231814',
  onPrimary: '#FFFFFF',
  danger: '#F44F5E',
  scrim: 'rgba(0,0,0,0.6)',
  ripple: 'rgba(255,255,255,0.08)',
  playerBackground: '#0A0A0A',
};

export type Colors = typeof light;

/** Modo escuro com fundo preto de verdade (OLED): os pixels pretos ficam apagados. */
const black: Colors = {
  ...dark,
  background: '#000000',
  surface: '#0E0E0E',
  surfaceAlt: '#1A1A1A',
  border: 'rgba(243,246,248,0.08)',
  primarySoft: '#170E0A',
  playerBackground: '#000000',
};

export type Accent = 'blue' | 'green' | 'orange' | 'pink' | 'purple';

/**
 * Temas de cor: nome (chave de tradução), destaque, conteúdo em destaque e fundo suave (claro/escuro).
 * O laranja é o do logo Vinil e vem primeiro (é o padrão); os outros são os do Lark.
 */
export const ACCENTS: Record<Accent, { nameKey: StringKey; light: [string, string, string]; dark: [string, string, string] }> = {
  orange: { nameKey: 'settings.accent.orange', light: ['#FD7846', '#E2552A', '#FAE8E2'], dark: ['#FD7846', '#FF9A73', '#231814'] },
  blue: { nameKey: 'settings.accent.blue', light: ['#2596FF', '#0782F3', '#E2EEFA'], dark: ['#2596FF', '#54B7FF', '#12202E'] },
  green: { nameKey: 'settings.accent.green', light: ['#14EA86', '#0BA862', '#E2F8EE'], dark: ['#12C371', '#3FE29A', '#16271F'] },
  pink: { nameKey: 'settings.accent.pink', light: ['#F6606D', '#E2384A', '#FAE2E4'], dark: ['#F44F5E', '#FF7D89', '#2A181A'] },
  purple: { nameKey: 'settings.accent.purple', light: ['#ED41D3', '#C824AF', '#FAE2F6'], dark: ['#DA52C5', '#EC7FDB', '#2A1827'] },
};

export const COVER_GRADIENTS: [string, string][] = [
  ['#FD7846', '#D84B22'],
  ['#7F7FD5', '#86A8E7'],
  ['#F2994A', '#F2C94C'],
  ['#11998E', '#38EF7D'],
  ['#FC5C7D', '#6A82FB'],
  ['#ED41D3', '#FB7746'],
  ['#3A6073', '#16222A'],
];

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 4, md: 8, lg: 12, xl: 20, pill: 999 } as const;

export const font = {
  display: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '700' },
  heading: { fontSize: 16, lineHeight: 22, fontWeight: '500' },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 18, fontWeight: '500' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  micro: { fontSize: 10, lineHeight: 13, fontWeight: '500' },
} as const;

export function useIsDark(): boolean {
  return useColorScheme() === 'dark';
}

export function useColors(): Colors {
  const isDark = useIsDark();
  const accent = useSettings((s) => s.accent);
  const pureBlack = useSettings((s) => s.pureBlack);
  const base = isDark ? (pureBlack ? black : dark) : light;
  if (accent === 'orange' || !Object.hasOwn(ACCENTS, accent)) return base;
  const [primary, primaryContent, primarySoft] = ACCENTS[accent][isDark ? 'dark' : 'light'];
  return { ...base, primary, primaryContent, primarySoft };
}
