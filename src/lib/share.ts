import { Directory, File, Paths } from 'expo-file-system';
import { shareAsync } from 'expo-sharing';

import { t } from '@/i18n';
import type { Track } from '@/lib/library';

/** Copia o áudio para o cache (o compartilhamento do Android precisa de um arquivo do app) e abre "Compartilhar". */
export async function shareTrack(track: Track): Promise<void> {
  // iPhone: o app Música não entrega o arquivo para outros apps.
  if (track.uri.startsWith('ipod-library:')) throw new Error(t('ios.shareNotFile'));
  const dir = new Directory(Paths.cache, 'share');
  if (dir.exists) dir.delete();
  dir.create({ intermediates: true });
  const name = (track.fileName ?? `${track.title}.mp3`).replace(/[\\/:*?"<>|]/g, '_');
  const target = new File(dir, name);
  await new File(track.uri).copy(target);
  await shareAsync(target.uri, { mimeType: track.mime ?? 'audio/*', dialogTitle: track.title });
}
