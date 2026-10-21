import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Artwork } from '@/components/Artwork';
import { Button, IconButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/misc';
import { Text } from '@/components/ui/Text';
import { artistName, useT } from '@/i18n';
import { formatLongDuration } from '@/lib/format';
import type { Track } from '@/lib/library';
import { buildRecap, monthKey, shiftMonth } from '@/lib/recap';
import { useCollections } from '@/store/collections';
import { useLibrary } from '@/store/library';
import { usePlayer } from '@/store/player';
import { radius, space, useColors } from '@/theme';

/** Retrospectiva do mês: tempo ouvido, dias com música e as músicas e os artistas mais ouvidos. */
export default function RecapScreen() {
  const tr = useT();
  const colors = useColors();
  const current = monthKey();
  const [month, setMonth] = useState(current);
  const monthPlays = useCollections((s) => s.monthPlays);
  const playTime = useCollections((s) => s.playTime);
  const byId = useLibrary((s) => s.index.byId);

  const recap = useMemo(
    () => buildRecap(month, monthPlays[month], playTime, (id) => byId.get(id)?.artist ?? null),
    [month, monthPlays, playTime, byId]
  );
  const topTracks = recap.topTracks.map((r) => ({ track: byId.get(r.id), count: r.count })).filter((r): r is { track: Track; count: number } => !!r.track);
  const oldest = Object.keys(monthPlays).sort()[0] ?? current;
  const [y, m] = month.split('-').map(Number);
  const title = new Date(y, m - 1, 1).toLocaleDateString(tr.locale, { month: 'long', year: 'numeric' });
  const empty = recap.plays === 0 && recap.listenedMs === 0;

  const playTop = () => {
    if (topTracks.length === 0) return;
    void usePlayer.getState().playTracks(topTracks.map((r) => r.track), 0);
    router.push('/player');
  };

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: tr('extras.stats.title') }} />
      <View style={styles.monthRow}>
        <IconButton icon="chevron_left" label={tr('extras.stats.previous')} disabled={month <= oldest} onPress={() => setMonth(shiftMonth(month, -1))} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="title" style={styles.capitalize}>
            {title}
          </Text>
          <Text variant="caption" muted>
            {tr('extras.stats.subtitle')}
          </Text>
        </View>
        <IconButton icon="chevron_right" label={tr('extras.stats.next')} disabled={month >= current} onPress={() => setMonth(shiftMonth(month, 1))} />
      </View>

      {empty ? (
        <EmptyState icon="insights" title={tr('extras.stats.empty')} />
      ) : (
        <>
          <View style={styles.tiles}>
            {[
              { label: tr('extras.stats.listened'), value: formatLongDuration(recap.listenedMs) },
              { label: tr('extras.stats.days'), value: String(recap.days) },
              { label: tr('extras.stats.plays'), value: String(recap.plays) },
            ].map((tile) => (
              <View key={tile.label} style={[styles.tile, { backgroundColor: colors.surface }]}>
                <Text variant="title" color={colors.primary} numberOfLines={1}>
                  {tile.value}
                </Text>
                <Text variant="caption" muted numberOfLines={2}>
                  {tile.label}
                </Text>
              </View>
            ))}
          </View>

          {topTracks.length > 0 && (
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              <Text variant="label">{tr('extras.stats.topTracks')}</Text>
              {topTracks.map(({ track, count }, i) => (
                <Pressable
                  key={track.id}
                  onPress={() => {
                    void usePlayer.getState().playTracks(topTracks.map((r) => r.track), i);
                  }}
                  android_ripple={{ color: colors.ripple }}
                  accessibilityRole="button"
                  style={styles.row}>
                  <Text variant="label" color={colors.primary} style={styles.rank}>
                    {i + 1}
                  </Text>
                  <Artwork track={track} size={40} radius={6} />
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text numberOfLines={1}>{track.title}</Text>
                    <Text variant="caption" muted numberOfLines={1}>
                      {artistName(track.artist)}
                    </Text>
                  </View>
                  <Text variant="caption" muted>
                    {tr.n('extras.stats.times', count)}
                  </Text>
                </Pressable>
              ))}
              <Button label={tr('extras.stats.playTop')} icon="play_arrow" variant="tonal" onPress={playTop} />
            </View>
          )}

          {recap.topArtists.length > 0 && (
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              <Text variant="label">{tr('extras.stats.topArtists')}</Text>
              {recap.topArtists.map((artist, i) => (
                <View key={artist.id} style={styles.row}>
                  <Text variant="label" color={colors.primary} style={styles.rank}>
                    {i + 1}
                  </Text>
                  <Text style={{ flex: 1 }} numberOfLines={1}>
                    {artistName(artist.id)}
                  </Text>
                  <Text variant="caption" muted>
                    {tr.n('extras.stats.times', artist.count)}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.md, gap: space.md, paddingBottom: space.xxl },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  capitalize: { textTransform: 'capitalize' },
  tiles: { flexDirection: 'row', gap: space.sm },
  tile: { flex: 1, borderRadius: radius.lg, padding: space.md, gap: 4 },
  card: { borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 4 },
  rank: { width: 22, textAlign: 'center' },
});
