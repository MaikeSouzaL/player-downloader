import { router, Stack } from 'expo-router';
import { useCallback, type ReactNode } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { Artwork } from '@/components/Artwork';
import { MiniPlayer } from '@/components/MiniPlayer';
import { PlayAllHeader } from '@/components/PlayAllHeader';
import { TrackRow } from '@/components/TrackRow';
import { EmptyState } from '@/components/ui/misc';
import { Text } from '@/components/ui/Text';
import { useT } from '@/i18n';
import { formatLongDuration } from '@/lib/format';
import type { Track } from '@/lib/library';
import { usePlayer } from '@/store/player';
import type { TrackSource } from '@/store/sources';
import type { MenuContext } from '@/store/ui';
import { radius, space, useColors } from '@/theme';

type Props = {
  title: string;
  subtitle?: string;
  tracks: Track[];
  /** Capa do cabeçalho; sem ela, usa `icon`. */
  cover?: Track;
  coverNode?: ReactNode;
  round?: boolean;
  headerRight?: () => ReactNode;
  menuContext?: (index: number) => MenuContext;
  numbered?: boolean;
  emptyTitle?: string;
  /** Liga o botão de seleção múltipla para esta lista. */
  select?: { source: TrackSource; id: string };
};

/** Lista de músicas com cabeçalho de capa (header_playlist / album_header_playlist do Lark). */
export function TrackListScreen({ title, subtitle, tracks, cover, coverNode, round, headerRight, menuContext, numbered, emptyTitle, select }: Props) {
  const tr = useT();
  const colors = useColors();
  const total = tracks.reduce((sum, t) => sum + t.duration, 0);
  const play = useCallback((index: number) => usePlayer.getState().playTracks(tracks, index), [tracks]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: '', headerRight }} />
      <FlatList
        data={tracks}
        keyExtractor={(t, i) => `${t.id}-${i}`}
        renderItem={({ item, index }) => (
          <TrackRow track={item} onPress={() => play(index)} menuContext={menuContext?.(index)} index={numbered ? (item.track || index + 1) : undefined} />
        )}
        ListHeaderComponent={
          <View>
            <View style={styles.header}>
              {coverNode ?? <Artwork track={cover} size={120} radius={round ? 60 : radius.lg} quality="large" />}
              <View style={{ flex: 1, gap: 4 }}>
                <Text variant="title" numberOfLines={3}>
                  {title}
                </Text>
                {subtitle && (
                  <Text variant="caption" muted numberOfLines={2}>
                    {subtitle}
                  </Text>
                )}
                <Text variant="caption" muted>
                  {tr.n('common.songs', tracks.length)}
                  {total > 0 ? ` · ${formatLongDuration(total)}` : ''}
                </Text>
              </View>
            </View>
            {tracks.length > 0 && (
              <PlayAllHeader
                count={tracks.length}
                onPlayAll={() => play(0)}
                onShuffle={() => usePlayer.getState().playTracks(tracks, 0, { shuffle: true })}
                onSelect={select ? () => router.push({ pathname: '/select', params: select }) : undefined}
              />
            )}
          </View>
        }
        ListEmptyComponent={<EmptyState icon="music_off" title={emptyTitle ?? tr('library.trackList.empty')} />}
      />
      <MiniPlayer />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.lg, padding: space.lg },
});
