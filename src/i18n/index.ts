import { prettyPath } from '@/lib/format';
import { UNKNOWN_ARTIST, VARIOUS_ARTISTS } from '@/lib/library';
import { useSettings } from '@/store/settings';

import { common } from './parts/common';
import { ios } from './parts/ios';
import { library } from './parts/library';
import { player } from './parts/player';
import { settings } from './parts/settings';
import { tools } from './parts/tools';

export type Lang = 'pt' | 'en' | 'es';
export type LangPreference = 'system' | Lang;

type All = typeof common.pt & typeof library.pt & typeof player.pt & typeof settings.pt & typeof ios.pt & typeof tools.pt;
export type StringKey = keyof All & string;
/** Chave base de um plural: existe `<base>.one` e `<base>.many`. */
export type PluralKey = StringKey extends infer K ? (K extends `${infer B}.one` ? B : never) : never;
type Vars = Record<string, string | number>;

const PARTS = [common, library, player, settings, ios, tools];
const DICTS: Record<Lang, Record<string, string>> = {
  pt: Object.assign({}, ...PARTS.map((p) => p.pt)),
  en: Object.assign({}, ...PARTS.map((p) => p.en)),
  es: Object.assign({}, ...PARTS.map((p) => p.es)),
};

/** Nomes de cada idioma escritos nele mesmo (para a lista em Ajustes). */
export const LANG_NAMES: Record<Lang, string> = { pt: 'Português (Brasil)', en: 'English', es: 'Español' };

export const LOCALES: Record<Lang, string> = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' };

let cachedDeviceLang: Lang | null = null;

/**
 * Idioma do aparelho (o Hermes expõe o locale do Android pelo Intl). Outras línguas usam inglês;
 * sem Intl, português. Fica em cache: `refreshDeviceLang()` relê quando o app volta ao primeiro plano.
 */
export function deviceLang(): Lang {
  if (cachedDeviceLang) return cachedDeviceLang;
  let lang: Lang = 'pt';
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
    lang = locale.startsWith('pt') ? 'pt' : locale.startsWith('es') ? 'es' : 'en';
  } catch {
    // Sem Intl: fica no padrão.
  }
  cachedDeviceLang = lang;
  return lang;
}

/** O usuário pode ter trocado o idioma do celular com o app em segundo plano. Devolve true se mudou. */
export function refreshDeviceLang(): boolean {
  const before = cachedDeviceLang;
  cachedDeviceLang = null;
  return deviceLang() !== before;
}

export function resolveLang(pref: LangPreference | undefined): Lang {
  return pref === 'pt' || pref === 'en' || pref === 'es' ? pref : deviceLang();
}

function format(lang: Lang, key: string, vars?: Vars): string {
  const template = DICTS[lang][key] ?? DICTS.pt[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = vars[name];
    return v === undefined ? `{${name}}` : typeof v === 'number' ? v.toLocaleString(LOCALES[lang]) : v;
  });
}

const pluralKey = (key: string, n: number) => `${key}.${n === 1 ? 'one' : 'many'}`;

export function currentLang(): Lang {
  return resolveLang(useSettings.getState().language);
}

/** Tradução fora de componentes (toasts, alertas, stores). */
export function t(key: StringKey, vars?: Vars): string {
  return format(currentLang(), key, vars);
}

/** Plural fora de componentes: `tn('common.songs', 3)` → "3 músicas". */
export function tn(key: PluralKey, n: number, vars?: Vars): string {
  return format(currentLang(), pluralKey(key, n), { n, ...vars });
}

export type Translator = ((key: StringKey, vars?: Vars) => string) & {
  /** Plural: `tr.n('common.songs', 3)` → "3 músicas". */
  n: (key: PluralKey, n: number, vars?: Vars) => string;
  lang: Lang;
  locale: string;
};

/** Nome do artista para mostrar: "Artista desconhecido" e "Vários artistas" no idioma do app. */
export function artistName(name: string | null | undefined): string {
  if (!name || name === UNKNOWN_ARTIST) return t('common.unknownArtist');
  if (name === VARIOUS_ARTISTS) return t('common.variousArtists');
  return name;
}

/** Caminho de pasta legível no idioma do app ("Armazenamento interno/Music", "Internal storage/Music"). */
export function localPath(path: string): string {
  return prettyPath(path, { internal: t('common.storage.internal'), card: (name) => t('common.storage.card', { name }) });
}

/** Hook: devolve o tradutor e re-renderiza quando o idioma muda. */
export function useT(): Translator {
  const lang = resolveLang(useSettings((s) => s.language));
  const tr = ((key: StringKey, vars?: Vars) => format(lang, key, vars)) as Translator;
  tr.n = (key, n, vars) => format(lang, pluralKey(key, n), { n, ...vars });
  tr.lang = lang;
  tr.locale = LOCALES[lang];
  return tr;
}
