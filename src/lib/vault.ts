import { Alert, Platform } from 'react-native';

import { t, tn } from '@/i18n';
import { logError } from '@/lib/errorlog';
import { errorMessage } from '@/lib/errors';
import type { Track } from '@/lib/library';
import { dropFromQueue } from '@/lib/media-actions';
import RitmoCore, { type NativeVideo, type SharedItem, type VaultItem } from '@/modules/ritmo-core';
import { useLibrary } from '@/store/library';
import { useUi } from '@/store/ui';
import { mediaTypeOf } from '@/lib/links';

/** Vira "Track" para o player poder tocar itens da pasta privada (IDs "v:<id>"). */
export function vaultTrack(item: VaultItem): Track {
  return {
    id: `v:${item.id}`,
    uri: item.uri,
    title: item.title || item.name,
    fileName: item.name,
    artist: item.artist,
    artistId: 'vault',
    album: item.album,
    albumId: `vault-${item.id}`,
    duration: item.duration,
    path: null,
    folder: null,
    size: item.size,
    dateAdded: item.addedAt,
    track: 0,
    year: 0,
    mime: item.mime,
    isMusic: true,
  };
}

/**
 * Leva músicas da biblioteca para a pasta privada: copia e depois apaga o original
 * (o Android pede confirmação). Se a exclusão for recusada, desfaz a cópia.
 */
export async function moveTracksToVault(tracks: Track[]): Promise<number> {
  const movable = Platform.OS === 'ios' ? tracks.filter((x) => !x.id.startsWith('m:')) : tracks;
  if (movable.length < tracks.length) Alert.alert(t('tools.vault.musicApp'));
  return move(
    movable.map((x) => ({
      uri: x.uri,
      deleteUri: x.uri,
      libraryId: x.id,
      meta: { name: x.fileName ?? `${x.title}.mp3`, title: x.title, artist: x.artist, album: x.album, duration: x.duration, kind: 'audio' as const, mime: x.mime },
    }))
  );
}

export async function moveVideosToVault(videos: NativeVideo[]): Promise<number> {
  return move(
    videos.map((v) => ({
      uri: v.uri,
      deleteUri: v.uri,
      libraryId: v.id,
      meta: { name: v.fileName ?? `${v.title}.mp4`, title: v.title, duration: v.duration, kind: 'video' as const, mime: v.mime },
    }))
  );
}

/** Arquivo recebido de outro app: só copia (o original é do outro app). */
export async function addSharedToVault(item: SharedItem): Promise<boolean> {
  try {
    const kind = mediaTypeOf(item.mime, item.name) ?? 'audio';
    await RitmoCore.vaultAdd(item.uri, { name: item.name, kind, mime: item.mime });
    useUi.getState().showToast(t('tools.vault.added', { name: item.name }));
    return true;
  } catch (e) {
    logError('Pasta privada: adicionar', e);
    Alert.alert(t('tools.vault.addFailed'), errorMessage(e));
    return false;
  }
}

type Movable = { uri: string; deleteUri: string; libraryId: string; meta: Parameters<typeof RitmoCore.vaultAdd>[1] };

/**
 * Desfaz cópias para a pasta privada. Onde o original ainda existe, apaga a cópia; onde não existe mais
 * (no iPhone, o que veio pela caixa de entrada é movido, não copiado), devolve o arquivo à biblioteca.
 */
async function undo(items: Movable[], added: VaultItem[]) {
  let remaining: Set<string>;
  try {
    remaining = new Set(await RitmoCore.existingUris(items.map((i) => i.deleteUri)));
  } catch {
    // Sem como conferir: devolver duplica, apagar poderia perder o único exemplar.
    remaining = new Set();
  }
  for (const [k, item] of items.entries()) {
    const copy = added[k];
    try {
      if (remaining.has(item.deleteUri)) await RitmoCore.vaultDelete(copy.id);
      else await RitmoCore.vaultRestore(copy.id);
    } catch (e) {
      logError('Pasta privada: desfazer', e);
    }
  }
}

async function move(items: Movable[]): Promise<number> {
  if (items.length === 0) return 0;
  const added: VaultItem[] = [];
  try {
    for (const item of items) added.push(await RitmoCore.vaultAdd(item.uri, item.meta));
  } catch (e) {
    logError('Pasta privada: copiar', e);
    await undo(items.slice(0, added.length), added);
    Alert.alert(t('tools.vault.addFailed'), errorMessage(e));
    return 0;
  }
  let removed = false;
  try {
    removed = await RitmoCore.deleteUris(items.map((i) => i.deleteUri));
  } catch (e) {
    logError('Pasta privada: apagar original', e);
  }
  // A exclusão pode ter sido recusada ou só parcial: confere um a um quais originais ainda existem.
  let remaining: Set<string>;
  try {
    remaining = new Set(await RitmoCore.existingUris(items.map((i) => i.deleteUri)));
  } catch (e) {
    logError('Pasta privada: conferir originais', e);
    remaining = new Set(removed ? [] : items.map((i) => i.deleteUri));
  }
  // Onde o original ficou, desfaz a cópia (senão o arquivo estaria nos dois lugares).
  const moved: Movable[] = [];
  for (const [k, item] of items.entries()) {
    if (remaining.has(item.deleteUri)) await RitmoCore.vaultDelete(added[k].id).catch(() => {});
    else moved.push(item);
  }
  if (moved.length === 0) {
    useUi.getState().showToast(t('tools.vault.cancelled'));
    return 0;
  }
  await dropFromQueue(new Set(moved.map((i) => i.libraryId)));
  useUi.getState().showToast(tn('tools.vault.moved', moved.length));
  void useLibrary.getState().scan();
  return moved.length;
}

export async function restoreFromVault(item: VaultItem): Promise<boolean> {
  try {
    await RitmoCore.vaultRestore(item.id);
    useUi.getState().showToast(t('tools.vault.restored', { name: item.title || item.name }));
    void useLibrary.getState().scan();
    return true;
  } catch (e) {
    logError('Pasta privada: restaurar', e);
    Alert.alert(t('tools.vault.restoreFailed'), errorMessage(e));
    return false;
  }
}
