import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { t, tn } from '@/i18n';
import { backupErrorCode, createBackup, mergeCollections, parseBackup, remapIds, type BackupData } from '@/lib/backup';
import { logError } from '@/lib/errorlog';
import { errorMessage } from '@/lib/errors';
import type { TrackEdit } from '@/lib/library';
import { saveLyrics } from '@/lib/lyrics-store';
import { matchEntries, parseM3U, writeM3U } from '@/lib/m3u';
import { dayKey, useCollections } from '@/store/collections';
import { useEdits } from '@/store/edits';
import { useLibrary } from '@/store/library';
import { useSettings, type EqPreset } from '@/store/settings';
import { ACCENTS } from '@/theme';

const APP_VERSION = Constants.expoConfig?.version ?? '';

/** Letras salvas pelo usuário (Paths.document/lyrics/<id>.lrc). */
async function customLyrics(): Promise<Record<string, string>> {
  const dir = new Directory(Paths.document, 'lyrics');
  if (!dir.exists) return {};
  const out: Record<string, string> = {};
  for (const entry of dir.list()) {
    if (entry instanceof File && entry.name.endsWith('.lrc')) out[entry.name.slice(0, -4)] = await entry.text();
  }
  return out;
}

function settingsSnapshot(): Record<string, unknown> {
  const all = useSettings.getState() as unknown as Record<string, unknown>;
  return Object.fromEntries(Object.entries(all).filter(([, v]) => typeof v !== 'function'));
}

async function shareFile(name: string, text: string, mimeType: string, dialogTitle: string) {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  await file.write(text);
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle });
}

async function pickText(types: string[]): Promise<{ name: string; text: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: types, copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  return { name: asset.name, text: await new File(asset.uri).text() };
}

/**
 * Backup e restauração dependem das músicas para ligar os IDs: espera a varredura em
 * andamento (ou faz uma) e recusa se a biblioteca estiver vazia.
 */
async function ensureLibrary(): Promise<void> {
  const library = useLibrary.getState();
  if (library.permission !== 'granted') throw new Error(t('settings.backupNeedPermission'));
  if (library.scanning) {
    await new Promise<void>((resolve) => {
      const unsubscribe = useLibrary.subscribe((s) => {
        if (!s.scanning) {
          unsubscribe();
          resolve();
        }
      });
    });
  } else if (!library.loaded) {
    await library.scan();
  }
  if (useLibrary.getState().allTracks.length === 0) throw new Error(t('settings.backupNoLibrary'));
}

const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T => typeof value === 'string' && (allowed as readonly string[]).includes(value);
const sortOk = (value: unknown, keys: readonly string[]) =>
  !!value && typeof value === 'object' && oneOf((value as { key?: unknown }).key, keys) && typeof (value as { desc?: unknown }).desc === 'boolean';
const presetOk = (p: unknown): p is EqPreset =>
  !!p &&
  typeof p === 'object' &&
  typeof (p as EqPreset).name === 'string' &&
  Array.isArray((p as EqPreset).levels) &&
  (p as EqPreset).levels.every((l) => typeof l === 'number') &&
  typeof (p as EqPreset).bass === 'number' &&
  typeof (p as EqPreset).loudness === 'number';

/**
 * Só os ajustes que fazem sentido em outro aparelho e com valores conhecidos por esta versão.
 * Equalizador, velocidade e foto de fundo são do aparelho; presets salvos são somados pelo nome.
 */
function restorableSettings(raw: Record<string, unknown>) {
  const current = useSettings.getState();
  const patch: Record<string, unknown> = {};
  if (oneOf(raw.theme, ['system', 'light', 'dark'] as const)) patch.theme = raw.theme;
  // hasOwn: "constructor", "toString" etc. também estão "in" um objeto e quebrariam o tema.
  if (typeof raw.accent === 'string' && Object.hasOwn(ACCENTS, raw.accent)) patch.accent = raw.accent;
  if (oneOf(raw.language, ['system', 'pt', 'en', 'es'] as const)) patch.language = raw.language;
  if (oneOf(raw.albumView, ['grid', 'list'] as const)) patch.albumView = raw.albumView;
  if (oneOf(raw.videoView, ['grid', 'list'] as const)) patch.videoView = raw.videoView;
  if (typeof raw.minDurationSec === 'number' && raw.minDurationSec >= 0 && raw.minDurationSec <= 600) patch.minDurationSec = raw.minDurationSec;
  if (sortOk(raw.songSort, ['recent', 'title', 'artist', 'album', 'duration', 'size'])) patch.songSort = raw.songSort;
  if (sortOk(raw.albumSort, ['name', 'artist', 'year', 'count'])) patch.albumSort = raw.albumSort;
  if (sortOk(raw.artistSort, ['name', 'count'])) patch.artistSort = raw.artistSort;
  if (sortOk(raw.folderSort, ['name', 'count'])) patch.folderSort = raw.folderSort;
  if (sortOk(raw.videoSort, ['recent', 'name', 'duration', 'size'])) patch.videoSort = raw.videoSort;
  if (Array.isArray(raw.eqPresets)) {
    const names = new Set(current.eqPresets.map((p) => p.name.trim().toLowerCase()));
    const added = raw.eqPresets.filter(presetOk).filter((p) => !names.has(p.name.trim().toLowerCase()));
    if (added.length) {
      patch.eqPresets = [
        ...current.eqPresets,
        ...added.map((p, i) => ({ id: `${Date.now()}-${i}`, name: p.name.slice(0, 30), levels: p.levels, bass: p.bass, loudness: p.loudness })),
      ];
    }
  }
  return patch;
}

/** Mensagem de um erro de backup no idioma atual (a lib de backup só informa o `code`). */
export function backupErrorMessage(e: unknown): string {
  switch (backupErrorCode(e)) {
    case 'corrupt':
      return t('settings.errCorrupt');
    case 'notBackup':
      return t('settings.errNotBackup');
    case 'newer':
      return t('settings.errNewer');
    default:
      return errorMessage(e);
  }
}

/** Gera o backup e abre o "Compartilhar" (salvar no Drive, mandar por e-mail, Arquivos…). */
export async function exportBackup(): Promise<void> {
  await ensureLibrary();
  const c = useCollections.getState();
  const data = createBackup({
    appVersion: APP_VERSION,
    settings: settingsSnapshot(),
    playlists: c.playlists,
    liked: c.liked,
    recent: c.recent,
    plays: c.plays,
    playTime: c.playTime,
    edits: useEdits.getState().edits as Record<string, Record<string, string>>,
    lyrics: await customLyrics(),
    library: useLibrary.getState().allTracks,
  });
  await shareFile(`PlayerDownloader-backup-${dayKey()}.json`, JSON.stringify(data), 'application/json', t('settings.backupShareTitle'));
}

/** Restaura um backup escolhido pelo usuário, mesclando com o que já existe. Devolve um resumo. */
export async function importBackup(): Promise<string | null> {
  const picked = await pickText(['application/json', 'text/plain', '*/*']);
  if (!picked) return null;
  const backup: BackupData = parseBackup(picked.text);
  await ensureLibrary();
  const library = useLibrary.getState().allTracks;
  const ids = remapIds(backup.tracks, library);

  // Coleções: mescla sem apagar nada.
  const c = useCollections.getState();
  const merged = mergeCollections(c, backup, ids, () => `pl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  useCollections.setState({ playlists: merged.playlists, liked: merged.liked, recent: merged.recent, plays: merged.plays, playTime: merged.playTime });

  // Ajustes: só os portáteis, com valores que esta versão conhece.
  useSettings.getState().set(restorableSettings(backup.settings));

  // Edições e letras com os IDs deste aparelho (as que já existem aqui ganham).
  const edits: Record<string, TrackEdit> = { ...useEdits.getState().edits };
  for (const [oldId, edit] of Object.entries(backup.edits)) {
    const id = ids.get(oldId);
    if (id && !edits[id]) edits[id] = edit;
  }
  useEdits.getState().replaceAll(edits);
  let lyrics = 0;
  for (const [oldId, text] of Object.entries(backup.lyrics)) {
    const id = ids.get(oldId);
    // Letra já salva aqui ganha (pode ser mais nova que a do backup).
    if (!id || new File(Paths.document, 'lyrics', `${id}.lrc`).exists) continue;
    try {
      await saveLyrics(id, text);
      lyrics++;
    } catch (e) {
      logError('Backup: letra', e, { id });
    }
  }

  const { playlists, tracks, missing } = merged.stats;
  const parts = [tn('settings.restoredTracks', tracks)];
  if (playlists) parts.push(tn('settings.restoredPlaylists', playlists));
  if (lyrics) parts.push(tn('settings.restoredLyrics', lyrics));
  if (missing) parts.push(tn('settings.restoredMissing', missing));
  return t('settings.restored', { parts: parts.join(', ') });
}

/** Exporta uma playlist como .m3u8 (abre o "Compartilhar"). */
export async function exportPlaylistM3U(playlistId: string): Promise<void> {
  const playlist = useCollections.getState().playlists.find((p) => p.id === playlistId);
  if (!playlist) return;
  const byId = useLibrary.getState().index.byId;
  const tracks = playlist.trackIds.map((id) => byId.get(id)).filter((t) => !!t);
  const safe = playlist.name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'playlist';
  await shareFile(`${safe}.m3u8`, writeM3U(playlist.name, tracks), 'audio/x-mpegurl', t('settings.exportPlaylist', { name: playlist.name }));
}

/** Importa um .m3u/.m3u8 como playlist nova. Devolve o ID e um resumo, ou null se cancelou. */
export async function importPlaylistM3U(): Promise<{ id: string; message: string } | null> {
  const picked = await pickText(['audio/x-mpegurl', 'audio/mpegurl', 'application/vnd.apple.mpegurl', 'application/x-mpegurl', '*/*']);
  if (!picked) return null;
  await ensureLibrary();
  const { name, entries } = parseM3U(picked.text);
  if (entries.length === 0) throw new Error(t('settings.m3uEmpty'));
  const { matched, missing } = matchEntries(entries, useLibrary.getState().allTracks);
  if (matched.length === 0) throw new Error(t('settings.m3uNoMatch'));
  const title = name ?? picked.name.replace(/\.m3u8?$/i, '');
  const id = useCollections.getState().createPlaylist(title, matched.map((t) => t.id));
  const songs = tn('common.songs', matched.length);
  const message = missing.length
    ? t('settings.m3uImportedMissing', { title, songs, missing: tn('settings.m3uNotFound', missing.length) })
    : t('settings.m3uImported', { title, songs });
  return { id, message };
}
