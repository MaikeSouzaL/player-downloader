import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { useArtwork, type ArtSize } from '@/hooks/artwork';
import type { Track } from '@/lib/library';
import { COVER_GRADIENTS } from '@/theme';

function gradientFor(seed: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return COVER_GRADIENTS[Math.abs(hash) % COVER_GRADIENTS.length];
}

type Props = {
  track: Pick<Track, 'albumId' | 'uri'> & { cover?: string } | undefined;
  size: number;
  radius?: number;
  quality?: ArtSize;
  style?: StyleProp<ImageStyle>;
};

/** Capa do álbum; sem capa, um degradê com nota musical (estável por álbum). */
export function Artwork({ track, size, radius = 8, quality = 'small', style }: Props) {
  const fetched = useArtwork(track?.cover ? undefined : track, quality);
  // Capa personalizada (Editar informações) vence a do álbum.
  const uri = track?.cover ?? fetched;
  const box = { width: size, height: size, borderRadius: radius };

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[box, style]}
        contentFit="cover"
        transition={120}
        recyclingKey={uri}
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View style={[box, styles.placeholder, style as StyleProp<ViewStyle>]} accessibilityElementsHidden importantForAccessibility="no">
      <LinearGradient colors={gradientFor(track?.albumId ?? 'x')} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <Icon name="music_note" size={size * 0.42} color="rgba(255,255,255,0.92)" />
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
