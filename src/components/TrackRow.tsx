import { memo } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Artwork } from '@/components/Artwork';
import { PlayingBars } from '@/components/PlayingBars';
import { IconButton } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useT } from '@/i18n';
import type { Track } from '@/lib/library';
import { usePlayer } from '@/store/player';
import { useUi, type MenuContext } from '@/store/ui';
import { space, useColors } from '@/theme';

type Props = {
  track: Track;
  onPress: () => void;
  subtitle?: string;
  menuContext?: MenuContext;
  /** Modo de seleção múltipla. */
  selecting?: boolean;
  selected?: boolean;
  onLongPress?: () => void;
  index?: number;
};

/** Linha de música (item_main_song_medium do Lark): capa, título, artista e "mais ações". */
export const TrackRow = memo(function TrackRow({ track, onPress, subtitle, menuContext, selecting, selected, onLongPress, index }: Props) {
  const tr = useT();
  const colors = useColors();
  // Uma assinatura só por linha: 0 = não é a atual, 1 = atual pausada, 2 = atual tocando.
  const status = usePlayer((s) => (s.snapshot?.mediaId === track.id ? (s.snapshot.isPlaying ? 2 : 1) : 0));
  const isCurrent = status > 0;
  const isPlaying = status === 2;
  const openMenu = useUi((s) => s.openMenu);
  const artist = track.artist ?? tr('common.unknownArtist');

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      android_ripple={{ color: colors.ripple }}
      accessibilityRole="button"
      accessibilityState={{ selected: selecting ? selected : isCurrent }}
      accessibilityLabel={`${track.title}, ${artist}`}
      style={({ pressed }) => [styles.row, pressed && Platform.OS === 'ios' && { backgroundColor: colors.ripple }]}>
      {index != null && (
        <Text variant="caption" muted style={styles.index}>
          {index}
        </Text>
      )}
      <View>
        <Artwork track={track} size={48} radius={6} />
        {isCurrent && (
          <View style={[StyleSheet.absoluteFill, styles.overlay]}>
            <PlayingBars playing={isPlaying} />
          </View>
        )}
      </View>
      <View style={styles.texts}>
        <Text variant="heading" numberOfLines={1} color={isCurrent ? colors.primary : undefined}>
          {track.title}
        </Text>
        <Text variant="caption" muted numberOfLines={1}>
          {subtitle ?? [artist, track.album].filter(Boolean).join(' - ')}
        </Text>
      </View>
      {selecting ? (
        <Icon
          name={selected ? 'check_circle' : 'radio_button_unchecked'}
          color={selected ? colors.primary : colors.textWeak}
        />
      ) : (
        <IconButton icon="more_vert" label={tr('common.more')} color={colors.textMuted} size={22} onPress={() => openMenu(track, menuContext)} />
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: space.lg, paddingRight: space.xs, height: 64 },
  texts: { flex: 1, gap: 2 },
  overlay: { backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  index: { width: 22, textAlign: 'center' },
});
