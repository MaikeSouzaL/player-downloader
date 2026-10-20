import { PermissionsAndroid, Platform, type Permission } from 'react-native';

import RitmoCore from '@/modules/ritmo-core';

const sdk = Platform.OS === 'android' ? (Platform.Version as number) : 0;
const AUDIO = sdk >= 33 ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;
const VIDEO = sdk >= 33 ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;

// No iPhone as músicas importadas ficam na pasta do próprio app (sem permissão); só o app Música pede acesso.
export async function hasAudioPermission(): Promise<boolean> {
  if (Platform.OS === 'ios') return true;
  if (Platform.OS !== 'android') return false;
  return PermissionsAndroid.check(AUDIO);
}

export async function hasVideoPermission(): Promise<boolean> {
  if (Platform.OS === 'ios') return true;
  if (Platform.OS !== 'android') return false;
  return PermissionsAndroid.check(VIDEO);
}

/** Pede acesso às músicas e vídeos (e às notificações no Android 13+, para os controles do player). */
export async function requestMediaPermissions(): Promise<{ audio: boolean; video: boolean }> {
  if (Platform.OS === 'ios') {
    if (RitmoCore.mediaLibraryStatus?.() === 'undetermined') await RitmoCore.requestMediaLibraryAccess?.().catch(() => null);
    return { audio: true, video: true };
  }
  if (Platform.OS !== 'android') return { audio: false, video: false };
  const wanted: Permission[] = [AUDIO, VIDEO];
  if (sdk >= 33) wanted.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  const result = await PermissionsAndroid.requestMultiple([...new Set(wanted)]);
  return {
    audio: result[AUDIO] === PermissionsAndroid.RESULTS.GRANTED,
    video: result[VIDEO] === PermissionsAndroid.RESULTS.GRANTED,
  };
}
