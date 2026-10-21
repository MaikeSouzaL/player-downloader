import { memo, useMemo, useRef } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import ReorderableList, { useReorderableDrag, type ReorderableListReorderEvent } from 'react-native-reorderable-list';

import { Artwork } from '@/components/Artwork';
import { BottomPanel } from '@/components/BottomPanel';
import { PlayingBars } from '@/components/PlayingBars';
import { IconButton } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/misc';
import { Text } from '@/components/ui/Text';
import { useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import type { Track } from '@/lib/library';
import { useExternalTracks } from '@/store/external-tracks';
import { useLibrary } from '@/store/library';
import { usePlayer } from '@/store/player';
import { space, useColors } from '@/theme';

type Item = { queueIndex: number; track: Track };

const QueueRow = memo(function QueueRow({ item, current, isPlaying, draggable }: { item: Item; current: boolean; isPlaying: boolean; draggable: boolean }) {
  const colors = useColors();
  const tr = useT();
  const drag = useReorderableDrag();
  const p = usePlayer.getState();
  return (
    <Pressable onPress={() => p.skipTo(item.queueIndex)} android_ripple={{ color: colors.ripple }} style={[styles.row, { backgroundColor: colors.surface }]} accessibilityRole="button">
      <View>
        <Artwork track={item.track} size={40} radius={4} />
        {current && (
          <View style={[StyleSheet.absoluteFill, styles.overlay]}>
            <PlayingBars playing={isPlaying} size={14} />
          </View>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="label" numberOfLines={1} color={current ? colors.primary : undefined}>
          {item.track.title}
        </Text>
        <Text variant="caption" muted numberOfLines={1}>
          {item.track.artist ?? tr('common.unknownArtist')}
        </Text>
      </View>
      {!current && (
        <IconButton icon="close" label={tr('player.queue.removeItem', { title: item.track.title })} color={colors.textWeak} size={20} onPress={() => p.removeAt(item.queueIndex)} />
      )}
      {draggable && (
        <Pressable
          onPressIn={() => {
            haptic('drag');
            drag();
          }}
          hitSlop={8} accessibilityRole="button" accessibilityLabel={tr('player.queue.drag', { title: item.track.title })} style={styles.handle}>
          <Icon name="drag_indicator" color={colors.textWeak} />
        </Pressable>
      )}
    </Pressable>
  );
});

/** Fila de reprodução (fragment_motion_play_queue do Lark), com arrastar para reordenar. */
export default function QueueScreen() {
  const colors = useColors();
  const tr = useT();
  const list = useRef<FlatList<Item>>(null);
  const queue = usePlayer((s) => s.queue);
  const order = usePlayer((s) => s.order);
  const currentIndex = usePlayer((s) => s.snapshot?.index ?? -1);
  const isPlaying = usePlayer((s) => !!s.snapshot?.isPlaying);
  const repeat = usePlayer((s) => s.snapshot?.repeat ?? 'off');
  const shuffle = usePlayer((s) => !!s.snapshot?.shuffle);
  const byId = useLibrary((s) => s.index.byId);
  const all = useLibrary((s) => s.allTracks);

  const items = useMemo<Item[]>(() => {
    const lookup = (id: string) => byId.get(id) ?? all.find((t) => t.id === id) ?? useExternalTracks.getState().tracks[id];
    const indices = order.length === queue.length ? order : queue.map((_, i) => i);
    return indices
      .map((i) => ({ queueIndex: i, track: lookup(queue[i]) }))
      .filter((x): x is Item => !!x.track);
  }, [queue, order, byId, all]);

  const position = items.findIndex((i) => i.queueIndex === currentIndex);
  const p = usePlayer.getState();
  // No aleatório a ordem mostrada não é a da fila; reordenar só faz sentido na ordem normal.
  const draggable = !shuffle && items.length === queue.length;

  const onReorder = ({ from, to }: ReorderableListReorderEvent) => {
    p.moveInQueue(items[from].queueIndex, items[to].queueIndex);
  };

  const modes: { key: 'one' | 'all' | 'shuffle'; icon: IconName; label: string; active: boolean; onPress: () => void }[] = [
    { key: 'one', icon: 'repeat_one', label: tr('player.queue.repeatOne'), active: !shuffle && repeat === 'one', onPress: async () => { await p.setShuffle(false); await p.setRepeat('one'); } },
    { key: 'all', icon: 'repeat', label: tr('player.queue.repeatAll'), active: !shuffle && repeat !== 'one', onPress: async () => { await p.setShuffle(false); await p.setRepeat('all'); } },
    { key: 'shuffle', icon: 'shuffle', label: tr('player.mode.shuffle'), active: shuffle, onPress: async () => { await p.setShuffle(true); await p.setRepeat('all'); } },
  ];

  const clear = () =>
    Alert.alert(tr('player.queue.clear'), tr('player.queue.clearConfirm'), [
      { text: tr('common.cancel'), style: 'cancel' },
      { text: tr('player.queue.clearAction'), style: 'destructive', onPress: () => p.clearQueue() },
    ]);

  return (
    <BottomPanel>
      <View style={styles.head}>
        <Text variant="heading" style={{ flex: 1 }}>
          {tr('player.queue.title')} <Text variant="label" muted>({items.length})</Text>
        </Text>
        <IconButton
          icon="my_location"
          label={tr('player.queue.goToCurrent')}
          color={colors.textMuted}
          onPress={() => position >= 0 && list.current?.scrollToIndex({ index: position, viewPosition: 0.3 })}
        />
        <IconButton icon="delete_sweep" label={tr('player.queue.clear')} color={colors.textMuted} onPress={clear} />
      </View>
      {shuffle && items.length > 1 && (
        <Text variant="caption" muted style={styles.hint}>
          {tr('player.queue.shuffleHint')}
        </Text>
      )}
      <ReorderableList
        ref={list}
        data={items}
        onReorder={onReorder}
        keyExtractor={(i) => `${i.queueIndex}-${i.track.id}`}
        initialScrollIndex={position > 3 ? position - 2 : undefined}
        onScrollToIndexFailed={() => {}}
        style={{ flex: 1 }}
        ListEmptyComponent={<EmptyState icon="queue_music" title={tr('player.queue.empty')} />}
        renderItem={({ item }) => (
          <QueueRow item={item} current={item.queueIndex === currentIndex} isPlaying={isPlaying} draggable={draggable} />
        )}
      />
      <View style={[styles.modes, { borderTopColor: colors.border }]}>
        {modes.map((m) => (
          <Pressable key={m.key} onPress={m.onPress} accessibilityRole="radio" accessibilityState={{ checked: m.active }} style={styles.mode}>
            <Icon name={m.icon} size={22} color={m.active ? colors.primary : colors.textMuted} />
            <Text variant="caption" color={m.active ? colors.primary : colors.textMuted}>
              {m.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </BottomPanel>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingLeft: space.lg, paddingRight: space.xs },
  hint: { paddingHorizontal: space.lg, paddingBottom: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: space.lg, paddingRight: space.xs, height: 60 },
  handle: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  overlay: { backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  modes: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  mode: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: space.md },
});
