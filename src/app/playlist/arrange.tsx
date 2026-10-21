import { Stack, useLocalSearchParams } from 'expo-router';
import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import ReorderableList, { reorderItems, useReorderableDrag, type ReorderableListReorderEvent } from 'react-native-reorderable-list';

import { Artwork } from '@/components/Artwork';
import { IconButton } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/misc';
import { Text } from '@/components/ui/Text';
import { useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import type { Track } from '@/lib/library';
import { useCollections } from '@/store/collections';
import { useLibrary } from '@/store/library';
import { space, useColors } from '@/theme';

const Row = memo(function Row({ track, onRemove }: { track: Track; onRemove: () => void }) {
  const tr = useT();
  const colors = useColors();
  const drag = useReorderableDrag();
  return (
    <Pressable
      onLongPress={() => {
        haptic('drag');
        drag();
      }}
      delayLongPress={200} style={[styles.row, { backgroundColor: colors.background }]}>
      <Artwork track={track} size={44} radius={6} />
      <View style={{ flex: 1 }}>
        <Text variant="label" numberOfLines={1}>
          {track.title}
        </Text>
        <Text variant="caption" muted numberOfLines={1}>
          {track.artist ?? tr('common.unknownArtist')}
        </Text>
      </View>
      <IconButton icon="remove_circle" label={tr('library.arrange.removeLabel', { title: track.title })} color={colors.textWeak} size={20} onPress={onRemove} />
      <Pressable onPressIn={drag} hitSlop={8} accessibilityRole="button" accessibilityLabel={tr('library.arrange.dragLabel', { title: track.title })} style={styles.handle}>
        <Icon name="drag_indicator" color={colors.textMuted} />
      </Pressable>
    </Pressable>
  );
});

/** Organizar playlist (PlaylistArrangeFragment do Lark): arrastar para mudar a ordem. */
export default function ArrangePlaylistScreen() {
  const tr = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const playlist = useCollections((s) => s.playlists.find((p) => p.id === id));
  const byId = useLibrary((s) => s.index.byId);

  // Faixas que não estão mais no aparelho ficam no fim da lista salva, fora da tela.
  const { visible, missing } = useMemo(() => {
    const ids = playlist?.trackIds ?? [];
    return { visible: ids.filter((t) => byId.has(t)), missing: ids.filter((t) => !byId.has(t)) };
  }, [playlist, byId]);

  if (!playlist) return <EmptyState icon="queue_music" title={tr('library.playlist.notFound')} />;

  const save = (ids: string[]) => useCollections.getState().setPlaylistTracks(playlist.id, [...ids, ...missing]);
  const onReorder = ({ from, to }: ReorderableListReorderEvent) => save(reorderItems(visible, from, to));

  return (
    <>
      <Stack.Screen options={{ title: tr('library.arrange.title', { name: playlist.name }) }} />
      <Text variant="caption" muted style={styles.hint}>
        {tr('library.arrange.hint')}
      </Text>
      <ReorderableList
        data={visible}
        keyExtractor={(t) => t}
        onReorder={onReorder}
        ListEmptyComponent={<EmptyState icon="queue_music" title={tr('library.arrange.empty')} />}
        renderItem={({ item }) => {
          const track = byId.get(item);
          return track ? <Row track={track} onRemove={() => save(visible.filter((t) => t !== item))} /> : null;
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  hint: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: space.lg, paddingRight: space.xs, height: 64 },
  handle: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
});
