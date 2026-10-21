import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { Artwork } from '@/components/Artwork';
import { LabelPlayIcon } from '@/components/LabelPlayIcon';
import { IconButton } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { useCollections } from '@/store/collections';
import { useCurrentTrack, usePlayer } from '@/store/player';
import { space, useColors } from '@/theme';

const RING = 40;
const STROKE = 2.5;

/** Botão play/pause (rótulo do logo Vinil) com o anel de progresso em volta (CircleRingProgress do Lark). */
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
      <LabelPlayIcon playing={isPlaying} size={30} />
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

  // Arrastar para os lados troca de música sem abrir o player (para a esquerda: próxima).
  const [dragX] = useState(() => new Animated.Value(0));
  const swipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderMove: (_, g) => dragX.setValue(g.dx),
        onPanResponderRelease: (_, g) => {
          const go = g.dx < -70 || g.vx < -0.8 ? 'next' : g.dx > 70 || g.vx > 0.8 ? 'previous' : null;
          if (!go) {
            Animated.spring(dragX, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
            return;
          }
          haptic('step');
          Animated.timing(dragX, { toValue: go === 'next' ? -120 : 120, duration: 120, useNativeDriver: true }).start(() => {
            void (go === 'next' ? usePlayer.getState().next() : usePlayer.getState().previous());
            dragX.setValue(0);
          });
        },
        onPanResponderTerminate: () => Animated.spring(dragX, { toValue: 0, useNativeDriver: true }).start(),
      }),
    [dragX]
  );
  const fade = dragX.interpolate({ inputRange: [-120, 0, 120], outputRange: [0.4, 1, 0.4], extrapolate: 'clamp' });

  if (!track) return null;

  return (
    <View {...swipe.panHandlers} style={[styles.wrap, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: bottomInset ? insets.bottom : 0 }]}>
      <Pressable
        onPress={() => router.push('/player')}
        android_ripple={{ color: colors.ripple }}
        accessibilityRole="button"
        accessibilityLabel={tr('player.mini.open', { title: track.title })}
        style={styles.row}>
        <Animated.View style={[styles.swipe, { opacity: fade, transform: [{ translateX: dragX }] }]}>
          <Artwork track={track} size={44} radius={6} />
          <View style={styles.texts}>
            <Text variant="label" numberOfLines={1}>
              {track.title}
            </Text>
            <Text variant="caption" muted numberOfLines={1}>
              {track.artist ?? tr('common.unknownArtist')}
            </Text>
          </View>
        </Animated.View>
        <IconButton
          icon="favorite"
          label={liked ? tr('player.unlike') : tr('player.like')}
          color={liked ? colors.danger : colors.textMuted}
          size={22}
          box={38}
          onPress={() => {
            haptic('toggle');
            toggleLike(track.id);
          }}
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
  swipe: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.xs },
  texts: { flex: 1, gap: 1, marginLeft: space.xs },
  ring: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center', marginHorizontal: 2 },
});
