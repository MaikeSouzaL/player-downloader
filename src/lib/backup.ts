import { normalize } from './format.ts';

/**
 * Backup do Player Downloader: um JSON com playlists, curtidas, histórico, tempo de reprodução,
 * ajustes, edições e letras. Os IDs do MediaStore mudam entre aparelhos (e às vezes
 * depois de formatar), então cada música vai junto com caminho, título, artista e
 * duração para ser reencontrada na restauração.
 */
export const BACKUP_FORMAT = 'ritmo-backup';
export const BACKUP_VERSION = 1;

export type TrackRef = { path: string | null; title: string; artist: string | null; duration: number };
export type BackupPlaylist = { name: string; trackIds: string[]; createdAt: number };

export type BackupData = {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  appVersion: string;
  settings: Record<string, unknown>;
  playlists: BackupPlaylist[];
  liked: string[];
  recent: string[];
  plays: Record<string, number>;
  playTime: Record<string, number>;
  edits: Record<string, Record<string, string>>;
  lyrics: Record<string, string>;
  tracks: Record<string, TrackRef>;
};

export type BackupInput = Omit<BackupData, 'format' | 'version' | 'createdAt' | 'tracks'> & {
  /** Músicas da biblioteca; só as citadas no backup entram em `tracks`. */
  library: (TrackRef & { id: string })[];
  now?: Date;
};

export type BackupErrorCode = 'corrupt' | 'notBackup' | 'newer';

/**
 * Erro ao ler um backup. A mensagem fica em português (é o que os testes conferem); a tela
 * traduz pelo `code`, porque esta lib não pode depender do i18n nem do React Native.
 */
export class BackupError extends Error {
  code: BackupErrorCode;

  constructor(code: BackupErrorCode, message: string) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

/** O `code` de um erro de backup, ou null se o erro for de outra origem. */
export function backupErrorCode(e: unknown): BackupErrorCode | null {
  const code = e instanceof Error ? (e as { code?: unknown }).code : undefined;
  return code === 'corrupt' || code === 'notBackup' || code === 'newer' ? code : null;
}

/**
 * Ajustes que não fazem sentido levar para outro aparelho — e os do servidor de downloads, que
 * nunca saem do celular (o backup é compartilhado por WhatsApp/Drive e a chave iria junto).
 */
// grabServer/grabKey não existem mais, mas ficam aqui para backups antigos não levarem as chaves.
const LOCAL_SETTINGS = new Set(['onboarded', 'hiddenFolders', 'hiddenTracks', 'grabServer', 'grabKey', 'reportErrors']);

export function createBackup(input: BackupInput): BackupData {
  const settings = Object.fromEntries(
    Object.entries(input.settings).filter(([k, v]) => !LOCAL_SETTINGS.has(k) && typeof v !== 'function')
  );
  const used = new Set<string>([
    ...input.playlists.flatMap((p) => p.trackIds),
    ...input.liked,
    ...input.recent,
    ...Object.keys(input.plays),
    ...Object.keys(input.edits),
    ...Object.keys(input.lyrics),
  ]);
  const tracks: Record<string, TrackRef> = {};
  for (const t of input.library) {
    if (used.has(t.id)) tracks[t.id] = { path: t.path, title: t.title, artist: t.artist, duration: t.duration };
  }
  // Edições de capa apontam para arquivos deste aparelho: não viajam.
  const edits = Object.fromEntries(
    Object.entries(input.edits).map(([id, e]) => [id, Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'cover'))])
  );
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: (input.now ?? new Date()).toISOString(),
    appVersion: input.appVersion,
    settings,
    playlists: input.playlists.map((p) => ({ name: p.name, trackIds: p.trackIds, createdAt: p.createdAt })),
    liked: input.liked,
    recent: input.recent,
    plays: input.plays,
    playTime: input.playTime,
    edits,
    lyrics: input.lyrics,
    tracks,
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const numbers = (v: unknown): Record<string, number> =>
  isObject(v) ? Object.fromEntries(Object.entries(v).filter(([, n]) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) as Record<string, number> : {};

/** Lê e valida um backup; lança um erro com mensagem amigável se o arquivo não servir. */
export function parseBackup(text: string): BackupData {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError('corrupt', 'O arquivo não é um backup válido (JSON corrompido).');
  }
  if (!isObject(raw) || raw.format !== BACKUP_FORMAT) throw new BackupError('notBackup', 'Este arquivo não é um backup do Player Downloader.');
  if (typeof raw.version !== 'number' || raw.version > BACKUP_VERSION) {
    throw new BackupError('newer', 'Este backup foi feito por uma versão mais nova do Player Downloader. Atualize o app e tente de novo.');
  }

  const tracks: Record<string, TrackRef> = {};
  if (isObject(raw.tracks)) {
    for (const [id, t] of Object.entries(raw.tracks)) {
      if (!isObject(t) || typeof t.title !== 'string') continue;
      tracks[id] = {
        path: typeof t.path === 'string' ? t.path : null,
        title: t.title,
        artist: typeof t.artist === 'string' ? t.artist : null,
        duration: typeof t.duration === 'number' ? t.duration : 0,
      };
    }
  }
  const playlists: BackupPlaylist[] = Array.isArray(raw.playlists)
    ? raw.playlists.filter(isObject).flatMap((p) =>
        typeof p.name === 'string' ? [{ name: p.name, trackIds: strings(p.trackIds), createdAt: typeof p.createdAt === 'number' ? p.createdAt : 0 }] : []
      )
    : [];
  const stringMap = (v: unknown) =>
    isObject(v) ? (Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'string')) as Record<string, string>) : {};
  const edits: Record<string, Record<string, string>> = {};
  if (isObject(raw.edits)) {
    for (const [id, e] of Object.entries(raw.edits)) {
      const clean = stringMap(e);
      delete clean.cover;
      if (Object.keys(clean).length) edits[id] = clean;
    }
  }

  return {
    format: BACKUP_FORMAT,
    version: raw.version,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    appVersion: typeof raw.appVersion === 'string' ? raw.appVersion : '',
    settings: isObject(raw.settings) ? raw.settings : {},
    playlists,
    liked: strings(raw.liked),
    recent: strings(raw.recent),
    plays: numbers(raw.plays),
    playTime: numbers(raw.playTime),
    edits,
    lyrics: stringMap(raw.lyrics),
    tracks,
  };
}

const labelKey = (t: { title: string; artist: string | null }) => `${normalize(t.title)}|${normalize(t.artist ?? '')}`;

/**
 * ID antigo → ID atual. Mesmo ID com o mesmo caminho fica como está; senão procura pelo
 * caminho, depois pelo nome do arquivo + duração e por fim título + artista (+ duração).
 */
export function remapIds(refs: Record<string, TrackRef>, library: (TrackRef & { id: string })[]): Map<string, string> {
  const byId = new Map(library.map((t) => [t.id, t]));
  const byPath = new Map<string, string>();
  const byFile = new Map<string, string[]>();
  const byLabel = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, k: string, id: string) => {
    const list = map.get(k);
    if (list) list.push(id);
    else map.set(k, [id]);
  };
  for (const t of library) {
    if (t.path) {
      byPath.set(t.path.toLowerCase(), t.id);
      push(byFile, t.path.split('/').pop()!.toLowerCase(), t.id);
    }
    push(byLabel, labelKey(t), t.id);
  }
  // Só aceita um candidato inequívoco: na dúvida a música conta como "não encontrada".
  const closest = (ids: string[] | undefined, duration: number) => {
    if (!ids?.length) return undefined;
    if (ids.length === 1 && !duration) return ids[0];
    const near = ids.filter((id) => Math.abs((byId.get(id)?.duration ?? 0) - duration) <= 3000);
    return near.length === 1 ? near[0] : undefined;
  };

  const map = new Map<string, string>();
  for (const [oldId, ref] of Object.entries(refs)) {
    const same = byId.get(oldId);
    const samePath = !!ref.path && !!same?.path && same.path.toLowerCase() === ref.path.toLowerCase();
    const sameLabel = !!same && (!ref.path || !same.path) && labelKey(same) === labelKey(ref);
    if (same && (samePath || sameLabel)) {
      map.set(oldId, oldId);
      continue;
    }
    const found =
      (ref.path ? byPath.get(ref.path.toLowerCase()) : undefined) ??
      (ref.path ? closest(byFile.get(ref.path.split('/').pop()!.toLowerCase()), ref.duration) : undefined) ??
      closest(byLabel.get(labelKey(ref)), ref.duration);
    if (found) map.set(oldId, found);
  }
  return map;
}

export type CollectionsData = {
  playlists: { id: string; name: string; trackIds: string[]; createdAt: number; updatedAt: number }[];
  liked: string[];
  recent: string[];
  plays: Record<string, number>;
  playTime: Record<string, number>;
};

/**
 * Junta o backup ao que já existe, sem apagar nada: playlist com o mesmo nome recebe as
 * músicas que faltam, curtidas somam, contagens e tempo por dia ficam com o maior valor.
 */
export function mergeCollections(
  current: CollectionsData,
  backup: BackupData,
  ids: Map<string, string>,
  newId: () => string,
  now = Date.now()
): CollectionsData & { stats: { playlists: number; tracks: number; missing: number } } {
  const map = (list: string[]) => list.map((id) => ids.get(id)).filter((id): id is string => !!id);
  const known = new Set(Object.keys(backup.tracks));
  const missing = [...known].filter((id) => !ids.has(id)).length;

  const playlists = current.playlists.map((p) => ({ ...p }));
  let created = 0;
  for (const p of backup.playlists) {
    const trackIds = map(p.trackIds);
    const existing = playlists.find((x) => normalize(x.name) === normalize(p.name));
    if (existing) {
      const merged = [...new Set([...existing.trackIds, ...trackIds])];
      if (merged.length !== existing.trackIds.length) Object.assign(existing, { trackIds: merged, updatedAt: now });
    } else {
      playlists.push({ id: newId(), name: p.name, trackIds: [...new Set(trackIds)], createdAt: p.createdAt || now, updatedAt: now });
      created++;
    }
  }

  const plays = { ...current.plays };
  for (const [oldId, n] of Object.entries(backup.plays)) {
    const id = ids.get(oldId);
    if (id) plays[id] = Math.max(plays[id] ?? 0, n);
  }
  const playTime = { ...current.playTime };
  for (const [day, ms] of Object.entries(backup.playTime)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) playTime[day] = Math.max(playTime[day] ?? 0, ms);
  }

  return {
    playlists,
    liked: [...new Set([...current.liked, ...map(backup.liked)])],
    recent: [...new Set([...current.recent, ...map(backup.recent)])].slice(0, 100),
    plays,
    playTime,
    stats: { playlists: created, tracks: ids.size, missing },
  };
}
