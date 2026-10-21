import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBackground, useBackgroundUri } from '@/components/AppBackground';
import { Artwork } from '@/components/Artwork';
import { LABEL_COLOR, LabelPlayIcon } from '@/components/LabelPlayIcon';
import { LyricsView } from '@/components/LyricsView';
import { SeekBar } from '@/components/SeekBar';
import { IconButton } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Marquee } from '@/components/ui/Marquee';
import { EmptyState } from '@/components/ui/misc';
import { Text } from '@/components/ui/Text';
import { useArtwork } from '@/hooks/artwork';
import { useCoverPalette } from '@/hooks/cover-palette';
import { useT } from '@/i18n';
import { rgbaOf } from '@/lib/cover-colors';
import { haptic } from '@/lib/haptics';
import { useCollections } from '@/store/collections';
import { useCurrentTrack, useNeighbors, usePlayer } from '@/store/player';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { radius, space, useColors, useIsDark } from '@/theme';

/** Botão único de modo, como no Lark: repetir todas → repetir uma faixa → embaralhar tudo. */
function useMode() {
  const tr = useT();
  const repeat = usePlayer((s) => s.snapshot?.repeat ?? 'off');
  const shuffle = usePlayer((s) => !!s.snapshot?.shuffle);
  const mode: 'all' | 'one' | 'shuffle' = shuffle ? 'shuffle' : repeat === 'one' ? 'one' : 'all';
  const icon: IconName = mode === 'shuffle' ? 'shuffle' : mode === 'one' ? 'repeat_one' : 'repeat';
  const label = mode === 'shuffle' ? tr('player.mode.shuffle') : mode === 'one' ? tr('player.mode.repeatOne') : tr('player.mode.repeatAll');
  const cycle = async () => {
    const p = usePlayer.getState();
    if (mode === 'all') {
      await p.setRepeat('one');
    } else if (mode === 'one') {
      await p.setRepeat('all');
      await p.setShuffle(true);
    } else {
      await p.setShuffle(false);
      await p.setRepeat('all');
    }
    useUi.getState().showToast(mode === 'all' ? tr('player.mode.repeatOne') : mode === 'one' ? tr('player.mode.shuffle') : tr('player.mode.repeatAll'));
  };
  return { icon, label, cycle };
}

export default function PlayerScreen() {
  const colors = useColors();
  const tr = useT();
  const isDark = useIsDark();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const track = useCurrentTrack();
  const isPlaying = usePlayer((s) => !!s.snapshot?.isPlaying);
  const speed = usePlayer((s) => s.snapshot?.speed ?? 1);
  const sleep = usePlayer((s) => s.sleep);
  const liked = useCollections((s) => (track ? s.liked.includes(track.id) : false));
  const eqOn = useSettings((s) => s.equalizer.enabled);
  const [showLyrics, setShowLyrics] = useState(false);
  const mode = useMode();
  const background = useArtwork(track, 'large');
  const photo = !!useBackgroundUri('player');
  const palette = useCoverPalette(photo ? undefined : track);
  const accent = palette?.accent ?? colors.primary;
  const { toggle, next, previous } = usePlayer.getState();

  const neighbors = useNeighbors();
  // Deitado (celular girado ou tablet): capa à esquerda, controles à direita.
  const landscape = width > height;
  const coverSize = landscape
    ? Math.min(height - insets.top - insets.bottom - 96, (width - insets.left - insets.right) * 0.42)
    : Math.min(width - space.xl * 2, height * 0.42);
  const step = coverSize + space.lg;

  // Arrastar a capa para os lados troca de música (o carrossel do Lark), mostrando a anterior e a próxima.
  const [dragX] = useState(() => new Animated.Value(0));
  const coverPan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderMove: Animated.event([null, { dx: dragX }], {
          useNativeDriver: false,
        }),
        onPanResponderRelease: (_, g) => {
          const target = g.dx < -80 || g.vx < -0.8 ? neighbors.next : g.dx > 80 || g.vx > 0.8 ? neighbors.previous : undefined;
          if (!target) {
            Animated.spring(dragX, {
              toValue: 0,
              useNativeDriver: false,
              bounciness: 6,
            }).start();
            return;
          }
          const toValue = target === neighbors.next ? -step : step;
          Animated.timing(dragX, {
            toValue,
            duration: 160,
            useNativeDriver: false,
          }).start(() => {
            haptic('step');
            usePlayer.getState().skipTo(target.index);
            // Se a troca não chegar (erro), a capa volta ao lugar mesmo assim.
            setTimeout(() => dragX.setValue(0), 800);
          });
        },
        onPanResponderTerminate: () =>
          Animated.spring(dragX, {
            toValue: 0,
            useNativeDriver: false,
          }).start(),
      }),
    [dragX, neighbors, step]
  );
  // A música mudou: a capa nova assume o centro.
  const trackId = track?.id;
  useEffect(() => {
    dragX.setValue(0);
  }, [trackId, dragX]);

  // Arrastar para baixo fecha o player.
  const [dragY] = useState(() => new Animated.Value(0));
  const closePan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dy > 14 && g.dy > Math.abs(g.dx) * 1.5,
        onPanResponderMove: (_, g) => dragY.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          if (g.dy > 140 || g.vy > 1) {
            Animated.timing(dragY, {
              toValue: height,
              duration: 180,
              useNativeDriver: true,
            }).start(() => router.back());
          } else {
            Animated.spring(dragY, {
              toValue: 0,
              useNativeDriver: true,
              bounciness: 4,
            }).start();
          }
        },
        onPanResponderTerminate: () => Animated.spring(dragY, { toValue: 0, useNativeDriver: true }).start(),
      }),
    [dragY, height]
  );

  if (!track) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, backgroundColor: colors.playerBackground }]}>
        <IconButton icon="keyboard_arrow_down" label={tr('common.close')} onPress={() => router.back()} />
        <EmptyState icon="music_note" title={tr('player.nothingPlaying')} message={tr('player.nothingPlayingHint')} />
      </View>
    );
  }

  const peek = (offset: number) => ({
    opacity: 0.45,
    transform: [{ translateX: Animated.add(dragX, offset) }, { scale: 0.86 }],
  });

  return (
    <Animated.View
      style={[
        styles.root,
        {
          backgroundColor: colors.playerBackground,
          transform: [{ translateY: dragY }],
        },
      ]}>
      {photo && <AppBackground where="player" />}
      {!photo && background && (
        <>
          <Image source={{ uri: background }} style={StyleSheet.absoluteFill} blurRadius={40} contentFit="cover" />
          <LinearGradient
            colors={[palette?.tint ?? rgbaOf(colors.playerBackground, isDark ? 0.55 : 0.6), rgbaOf(colors.playerBackground, isDark ? 0.92 : 0.94)]}
            style={StyleSheet.absoluteFill}
          />
        </>
      )}
      <View
        style={[
          styles.content,
          {
            paddingTop: insets.top + space.xs,
            paddingBottom: insets.bottom + space.md,
            paddingLeft: space.xl + insets.left,
            paddingRight: space.xl + insets.right,
          },
        ]}>
        <View {...closePan.panHandlers} style={styles.top}>
          <IconButton icon="keyboard_arrow_down" label={tr('player.closePlayer')} size={30} onPress={() => router.back()} />
          <View style={{ flex: 1 }} />
          {sleep?.active && (
            <Pressable
              onPress={() => router.push('/sleep-timer')}
              style={[styles.pill, { backgroundColor: colors.surfaceAlt }]}
              accessibilityRole="button">
              <Icon name="bedtime" size={16} color={colors.primary} />
              <Text variant="caption" color={colors.primary}>
                {sleep.endOfTrack ? tr('player.sleep.endOfTrack') : tr('player.sleep.minShort', { n: Math.ceil(sleep.remainingMs / 60000) })}
              </Text>
            </Pressable>
          )}
          <IconButton icon="timer" label={tr('player.timer')} onPress={() => router.push('/sleep-timer')} />
        </View>

        <View style={landscape ? styles.landscape : styles.portrait}>
          <View {...(showLyrics ? {} : closePan.panHandlers)} style={[styles.middle, landscape && styles.clip]}>
            {showLyrics ? (
              <LyricsView track={track} height={coverSize + 40} />
            ) : (
              <>
                {neighbors.previous && (
                  <Animated.View pointerEvents="none" style={[styles.peek, peek(-step)]}>
                    <Artwork track={neighbors.previous.track} size={coverSize} radius={radius.lg} quality="large" />
                  </Animated.View>
                )}
                {neighbors.next && (
                  <Animated.View pointerEvents="none" style={[styles.peek, peek(step)]}>
                    <Artwork track={neighbors.next.track} size={coverSize} radius={radius.lg} quality="large" />
                  </Animated.View>
                )}
                <Animated.View {...coverPan.panHandlers} style={{ transform: [{ translateX: dragX }] }}>
                  <Pressable onPress={() => setShowLyrics(true)} accessibilityLabel={tr('player.coverHint')}>
                    <Artwork track={track} size={coverSize} radius={radius.lg} quality="large" style={styles.cover} />
                  </Pressable>
                </Animated.View>
              </>
            )}
          </View>

          <View style={landscape ? styles.panel : undefined}>
            <View style={styles.info}>
              <View style={{ flex: 1 }}>
                <Marquee key={track.id} text={track.title} />
                <Text variant="body" muted numberOfLines={1}>
                  {track.artist ?? tr('common.unknownArtist')}
                </Text>
              </View>
              <IconButton
                icon="favorite"
                label={liked ? tr('player.unlike') : tr('player.like')}
                color={liked ? colors.danger : colors.textMuted}
                onPress={() => {
                  haptic('toggle');
                  useCollections.getState().toggleLike(track.id);
                  useUi.getState().showToast(liked ? tr('player.likedRemoved') : tr('player.likedAdded'));
                }}
              />
              <IconButton
                icon="more_vert"
                label={tr('common.more')}
                color={colors.textMuted}
                onPress={() => useUi.getState().openMenu(track, { fromPlayer: true })}
              />
            </View>

            <Pressable
              onPress={() => router.push({ pathname: '/sleep-timer', params: { mode: 'speed' } })}
              style={[styles.speed, { borderColor: colors.border }]}
              accessibilityRole="button"
              accessibilityLabel={tr('player.speedLabel', { speed: String(speed) })}>
              <Icon name="speed" size={16} color={speed !== 1 ? accent : colors.textMuted} />
              <Text variant="caption" color={speed !== 1 ? accent : colors.textMuted}>
                {speed.toFixed(speed % 1 === 0 ? 1 : 2)}x
              </Text>
            </Pressable>

            <SeekBar color={accent} />

            <View style={styles.controls}>
              <IconButton icon={mode.icon} label={mode.label} onPress={mode.cycle} color={colors.textMuted} />
              <IconButton icon="skip_previous" label={tr('player.previous')} size={40} box={60} onPress={previous} />
              <Pressable
                onPress={toggle}
                accessibilityRole="button"
                accessibilityLabel={isPlaying ? tr('common.pause') : tr('common.play')}
                android_ripple={{
                  color: 'rgba(232,87,42,0.2)',
                  borderless: true,
                  radius: 38,
                }}
                style={styles.play}>
                <LabelPlayIcon playing={isPlaying} size={72} />
              </Pressable>
              <IconButton icon="skip_next" label={tr('player.next')} size={40} box={60} onPress={next} />
              <IconButton icon="queue_music" label={tr('player.queue.title')} onPress={() => router.push('/queue')} color={colors.textMuted} />
            </View>

            <View style={styles.bottom}>
              <Pressable
                onPress={() => setShowLyrics(!showLyrics)}
                accessibilityRole="button"
                accessibilityState={{ selected: showLyrics }}
                style={[
                  styles.lyricsTab,
                  {
                    backgroundColor: showLyrics ? colors.primarySoft : colors.surfaceAlt,
                  },
                ]}>
                <Icon name="lyrics" size={18} color={showLyrics ? colors.primary : colors.textMuted} />
                <Text variant="label" color={showLyrics ? colors.primary : colors.textMuted}>
                  {tr('player.lyrics.title')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => router.push('/queue')}
                accessibilityRole="button"
                accessibilityLabel={neighbors.next ? `${tr('player.upNext')}: ${neighbors.next.track.title}` : tr('player.queue.title')}
                style={styles.upNext}>
                {neighbors.next && (
                  <Text variant="caption" muted numberOfLines={1}>
                    {tr('player.upNext')}: <Text variant="caption">{neighbors.next.track.title}</Text>
                  </Text>
                )}
              </Pressable>
              <Pressable
                onPress={() => router.push('/equalizer')}
                accessibilityRole="button"
                accessibilityLabel={eqOn ? tr('player.eq.a11yOn') : tr('player.eq.a11yOff')}
                style={styles.eq}
                hitSlop={8}>
                <Icon name="equalizer" color={eqOn ? colors.primary : colors.textMuted} />
                <View style={[styles.eqBadge, { backgroundColor: eqOn ? colors.primary : colors.textWeak }]}>
                  <Text variant="micro" color="#fff">
                    {eqOn ? tr('player.eq.on') : tr('player.eq.off')}
                  </Text>
                </View>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1, paddingHorizontal: space.xl },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: -space.md,
    gap: space.xs,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    height: 28,
  },
  portrait: { flex: 1 },
  landscape: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.xl },
  panel: { flex: 1, justifyContent: 'center' },
  // Deitado, as capas vizinhas do carrossel não podem invadir os controles.
  clip: { overflow: 'hidden', alignSelf: 'stretch' },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cover: { elevation: 8 },
  peek: { position: 'absolute' },
  info: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: -space.md,
    marginTop: space.md,
  },
  speed: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    height: 26,
    marginVertical: space.sm,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: -space.sm,
    marginTop: space.sm,
  },
  // Rótulo do logo Vinil; o fundo igual ao da bolinha deixa a sombra redonda (e a sombra separa o creme do fundo claro).
  play: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LABEL_COLOR,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  bottom: { flexDirection: 'row', alignItems: 'center', marginTop: space.lg },
  lyricsTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    height: 34,
  },
  upNext: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 34,
    paddingHorizontal: space.md,
  },
  eq: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 4 },
  eqBadge: { borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
});
