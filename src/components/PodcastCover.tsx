import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { radius, useColors } from '@/theme';

/** Capa do podcast (ou um ícone, quando o feed não tem imagem). */
export function PodcastCover({ uri, size }: { uri: string | null; size: number }) {
  const colors = useColors();
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: radius.md }} contentFit="cover" transition={120} />;
  return (
    <View style={[styles.placeholder, { width: size, height: size, backgroundColor: colors.primarySoft }]}>
      <Icon name="podcasts" size={size * 0.45} color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
