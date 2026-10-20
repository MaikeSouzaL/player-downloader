import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';

import { t, tn } from '@/i18n';
import { logError } from '@/lib/errorlog';
import { useLibrary } from '@/store/library';
import { useUi } from '@/store/ui';

/** Nome livre na pasta do app: "música.mp3" → "música (2).mp3" se já existir. */
function freeTarget(dir: Directory, name: string): File {
  const safe = name.replace(/[\\/:*?"<>|]+/g, '_') || 'musica';
  const dot = safe.lastIndexOf('.');
  const base = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : '';
  let target = new File(dir, safe);
  for (let i = 2; target.exists; i++) target = new File(dir, `${base} (${i})${ext}`);
  return target;
}

/**
 * iPhone: escolhe músicas (e vídeos) no app Arquivos / iCloud Drive e copia para a pasta do Ritmo
 * (Documents, que aparece em Arquivos › No meu iPhone › Ritmo). Depois relê a biblioteca.
 */
export async function importFiles(): Promise<number> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['audio/*', 'video/*', 'text/plain', 'application/octet-stream'],
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets?.length) return 0;
  const dir = Paths.document;
  let imported = 0;
  for (const asset of result.assets) {
    try {
      const source = new File(asset.uri);
      await source.move(freeTarget(dir, asset.name));
      imported++;
    } catch (e) {
      logError('Importar músicas', e, { name: asset.name });
      useUi.getState().showToast(t('ios.importFailed', { name: asset.name }));
    }
  }
  if (imported > 0) {
    useUi.getState().showToast(tn('ios.imported', imported));
    await useLibrary.getState().scan();
  }
  return imported;
}
