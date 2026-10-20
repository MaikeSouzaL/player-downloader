import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { Artwork } from '@/components/Artwork';
import { IconButton } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useT } from '@/i18n';
import { useCollections } from '@/store/collections';
import { useCurrentTrack, usePlayer } from '@/store/player';
import { space, useColors } from '@/theme';

const RING = 40;
const STROKE = 2.5;

/** Botão play/pause com o anel de progresso em volta (CircleRingProgress do Lark). */
function PlayRing() {
  const colors = useColors();
  const tr = useT();
  const isPlaying = usePlayer((s) => !!s.snapshot?.isPlaying);
  const fraction = usePlayer((s) => (s.duration > 0 ? Math.min(1, s.position / s.duration) : 0));
  const toggle = usePlayer((s) => s.toggle);
  const r = (RING - STROKE) / 2;
  const circumference = 2 * Math.PI * r;
  return (
    <Pressable onPress={toggle} accessibilityRole="button" accessibilityLabel={isPlaying ? tr('common.pause') : tr('common.play')} hitSlop={6} style={styles.ring}>
      <Svg width={RING} height={RING} style={StyleSheet.absoluteFill}>
        <Circle cx={RING / 2} cy={RING / 2} r={r} stroke={colors.border} strokeWidth={STROKE} fill="none" />
        <Circle
          cx={RING / 2}
          cy={RING / 2}
          r={r}
          stroke={colors.primary}
          strokeWidth={STROKE}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - fraction)}
          rotation={-90}
          origin={`${RING / 2}, ${RING / 2}`}
        />
      </Svg>
      <Icon name={isPlaying ? 'pause' : 'play_arrow'} size={22} color={colors.text} />
    </Pressable>
  );
}

/** Barra do player fixa no rodapé; tocar nela abre o player completo. */
export function MiniPlayer({ bottomInset = true }: { bottomInset?: boolean }) {
  const colors = useColors();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const track = useCurrentTrack();
  const liked = useCollections((s) => (track ? s.liked.includes(track.id) : false));
  const toggleLike = useCollections((s) => s.toggleLike);
  const { previous, next } = usePlayer.getState();

  if (!track) return null;

  return (
    <View style={[styles.wrap, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: bottomInset ? insets.bottom : 0 }]}>
      <Pressable
        onPress={() => router.push('/player')}
        android_ripple={{ color: colors.ripple }}
        accessibilityRole="button"
        accessibilityLabel={tr('player.mini.open', { title: track.title })}
        style={styles.row}>
        <Artwork track={track} size={44} radius={6} />
        <View style={styles.texts}>
          <Text variant="label" numberOfLines={1}>
            {track.title}
          </Text>
          <Text variant="caption" muted numberOfLines={1}>
            {track.artist ?? tr('common.unknownArtist')}
          </Text>
        </View>
        <IconButton
          icon="favorite"
          label={liked ? tr('player.unlike') : tr('player.like')}
          color={liked ? colors.danger : colors.textMuted}
          size={22}
          box={38}
          onPress={() => toggleLike(track.id)}
        />
        <IconButton icon="skip_previous" label={tr('player.previous')} size={26} box={38} onPress={previous} />
        <PlayRing />
        <IconButton icon="skip_next" label={tr('player.next')} size={26} box={38} onPress={next} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingLeft: space.md, paddingRight: space.sm, height: 64 },
  texts: { flex: 1, gap: 1, marginLeft: space.xs },
  ring: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center', marginHorizontal: 2 },
});
