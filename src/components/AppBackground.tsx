import { Directory, File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { StyleSheet, View } from 'react-native';

import { logError } from '@/lib/errorlog';
import { useSettings } from '@/store/settings';
import { useIsDark } from '@/theme';

const dir = () => new Directory(Paths.document, 'backgrounds');

/** URI da foto de fundo, ou null (também se o valor salvo estiver estragado). */
export function useBackgroundUri(where: 'main' | 'player' = 'main'): string | null {
  return useSettings((s) => {
    const bg = s.background;
    if (!bg || typeof bg.uri !== 'string' || !bg.uri) return null;
    if (where === 'player' && bg.player === false) return null;
    return bg.uri;
  });
}

/** Foto de fundo do tema, desfocada e escurecida (ou clareada no tema claro) para o texto continuar legível. */
export function AppBackground({ where = 'main' }: { where?: 'main' | 'player' }) {
  const uri = useBackgroundUri(where);
  const blur = useSettings((s) => (typeof s.background?.blur === 'number' ? s.background.blur : 12));
  const dim = useSettings((s) => (typeof s.background?.dim === 'number' ? s.background.dim : 0.45));
  const isDark = useIsDark();
  if (!uri) return null;
  const veil = isDark ? `rgba(0,0,0,${Math.min(0.9, Math.max(0, dim))})` : `rgba(255,255,255,${Math.min(0.92, Math.max(0, dim) + 0.15)})`;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={blur} transition={200} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: veil }]} />
    </View>
  );
}

/** Escolhe uma foto da galeria e guarda uma cópia na pasta do app (a original pode ser apagada). */
export async function pickBackground(): Promise<boolean> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsEditing: false });
  if (result.canceled || !result.assets?.[0]) return false;
  try {
    const d = dir();
    if (!d.exists) d.create({ intermediates: true });
    const target = new File(d, `bg-${Date.now()}.jpg`);
    await new File(result.assets[0].uri).copy(target);
    const previous = useSettings.getState().background;
    useSettings.getState().set({ background: { ...previous, uri: target.uri } });
    removeFile(previous.uri);
    return true;
  } catch (e) {
    logError('Foto de fundo', e);
    throw e;
  }
}

export function clearBackground() {
  const previous = useSettings.getState().background;
  useSettings.getState().set({ background: { ...previous, uri: null } });
  removeFile(previous.uri);
}

function removeFile(uri: string | null) {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Já não existe: tudo bem.
  }
}
