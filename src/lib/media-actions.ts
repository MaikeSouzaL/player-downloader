import { Alert } from 'react-native';

import { errorMessage } from '@/lib/errors';
import RitmoCore, { type RingtoneType } from '@/modules/ritmo-core';
import { t, tn, type StringKey } from '@/i18n';
import { logError } from '@/lib/errorlog';
import type { Track } from '@/lib/library';
import { IS_IOS } from '@/lib/platform';
import { usePlayer } from '@/store/player';
import { useUi } from '@/store/ui';

function confirm(title: string, message: string, action: string): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
      { text: action, style: 'destructive', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) })
  );
}

/** Tira da fila as faixas que acabaram de ser excluídas (de trás para frente, para os índices não mudarem). */
export async function dropFromQueue(ids: Set<string>) {
  const { queue, removeAt } = usePlayer.getState();
  const indices = queue.map((id, i) => (ids.has(id) ? i : -1)).filter((i) => i >= 0).reverse();
  for (const i of indices) await removeAt(i);
}

/**
 * Excluir músicas: no Android 11+ vão para "Excluídos recentemente" (lixeira do sistema, 30 dias);
 * no Android 10 são apagadas de vez. Em todos os casos o Android pede confirmação.
 */
export async function deleteTracks(tracks: Track[]): Promise<boolean> {
  // iPhone: músicas do app Música ("m:") não podem ser apagadas por outro app.
  if (IS_IOS && tracks.some((x) => x.id.startsWith('m:'))) {
    Alert.alert(t('ios.cantDeleteLibrary'));
    tracks = tracks.filter((x) => !x.id.startsWith('m:'));
  }
  if (tracks.length === 0) return false;
  const trash = RitmoCore.supportsTrash();
  const ok = await confirm(
    tracks.length === 1 ? t('library.delete.titleOne', { title: tracks[0].title }) : t('library.delete.titleMany', { n: tracks.length }),
    trash ? t('library.delete.trashMessage') : t('library.delete.permanentMessage'),
    t('common.delete')
  );
  if (!ok) return false;
  try {
    const ids = tracks.map((t) => t.id);
    const done = trash ? await RitmoCore.trashTracks(ids, true) : await RitmoCore.deleteTracks(ids);
    if (done) {
      await dropFromQueue(new Set(ids));
      useUi.getState().showToast(trash ? t('library.delete.movedToTrash') : t('library.delete.deleted'));
    }
    return done;
  } catch (e) {
    logError('Excluir músicas', e);
    Alert.alert(t('library.delete.failed'), errorMessage(e));
    return false;
  }
}

export async function restoreTracks(ids: string[]): Promise<boolean> {
  try {
    const done = await RitmoCore.trashTracks(ids, false);
    if (done) useUi.getState().showToast(tn('library.restore.done', ids.length));
    return done;
  } catch (e) {
    logError('Restaurar músicas', e);
    Alert.alert(t('library.restore.failed'), errorMessage(e));
    return false;
  }
}

export async function deleteForever(ids: string[]): Promise<boolean> {
  const ok = await confirm(t('library.deleteForever.title'), t('library.deleteForever.message'), t('common.delete'));
  if (!ok) return false;
  try {
    return await RitmoCore.deleteTracks(ids);
  } catch (e) {
    logError('Excluir de vez', e);
    Alert.alert(t('library.delete.failed'), errorMessage(e));
    return false;
  }
}

const RINGTONE_DONE: Record<RingtoneType, StringKey> = {
  call: 'library.ringtone.doneCall',
  notification: 'library.ringtone.doneNotification',
  alarm: 'library.ringtone.doneAlarm',
};

/** Definir como toque: o Android exige liberar "Modificar configurações do sistema" para o app. */
export async function setAsRingtone(track: Track, type: RingtoneType) {
  if (!RitmoCore.canWriteSettings()) {
    Alert.alert(
      t('library.ringtone.permissionTitle'),
      t('library.ringtone.permissionMessage'),
      [
        { text: t('library.ringtone.notNow'), style: 'cancel' },
        { text: t('library.ringtone.openSetting'), onPress: () => RitmoCore.openWriteSettings() },
      ]
    );
    return;
  }
  try {
    const ok = await RitmoCore.setRingtone(track.id, type);
    useUi.getState().showToast(ok ? t(RINGTONE_DONE[type], { title: track.title }) : t('library.ringtone.failed'));
  } catch (e) {
    logError('Definir toque', e);
    Alert.alert(t('library.ringtone.failed'), errorMessage(e));
  }
}
