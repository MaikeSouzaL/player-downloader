import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TrackRow } from '@/components/TrackRow';
import { IconButton } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useT } from '@/i18n';
import { deleteTracks } from '@/lib/media-actions';
import { moveTracksToVault } from '@/lib/vault';
import { useCollections } from '@/store/collections';
import { usePlayer } from '@/store/player';
import { useSettings } from '@/store/settings';
import { useSourceTracks, type TrackSource } from '@/store/sources';
import { useUi } from '@/store/ui';
import { space, useColors } from '@/theme';

const EMPTY: never[] = [];

/** Seleção múltipla (/audio/multiple_select/ do Lark) de qualquer lista: músicas, álbum, artista, pasta ou playlist. */
export default function SelectScreen() {
  const tr = useT();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ source?: TrackSource; id?: string }>();
  const source = params.source ?? 'songs';
  const list = useSourceTracks(source, params.id) ?? EMPTY;
  const userPlaylist = useCollections((s) => (source === 'playlist' ? s.playlists.find((p) => p.id === params.id) : undefined));
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const chosen = () => list.filter((t) => selected.has(t.id));
  const done = (message: string) => {
    useUi.getState().showToast(message);
    router.back();
  };

  const actions: { icon: IconName; label: string; onPress: () => void }[] = [
    {
      icon: 'playlist_play',
      label: tr('library.playNext'),
      onPress: () => usePlayer.getState().playNext(chosen()).then(() => done(tr('library.playNextToast'))),
    },
    {
      icon: 'queue_music',
      label: tr('library.addToQueue'),
      onPress: () => usePlayer.getState().addToQueue(chosen()).then(() => done(tr('library.addedToQueue'))),
    },
    {
      icon: 'playlist_add',
      label: tr('library.select.playlist'),
      onPress: () => {
        const items = chosen();
        router.back();
        useUi.getState().pickPlaylist(items);
      },
    },
    {
      icon: 'visibility_off',
      label: tr('library.menu.hide'),
      onPress: () => {
        useSettings.getState().hideTracks([...selected]);
        done(tr.n('library.select.hidden', selected.size));
      },
    },
    ...(userPlaylist
      ? [
          {
            icon: 'playlist_remove' as IconName,
            label: tr('common.remove'),
            onPress: () => {
              useCollections.getState().setPlaylistTracks(
                userPlaylist.id,
                userPlaylist.trackIds.filter((t) => !selected.has(t))
              );
              done(tr.n('library.select.removed', selected.size));
            },
          },
        ]
      : []),
    {
      icon: 'lock',
      label: tr('tools.vault.title'),
      onPress: () =>
        moveTracksToVault(chosen()).then((moved) => {
          if (moved > 0) router.back();
        }),
    },
    {
      icon: 'delete',
      label: tr('common.delete'),
      onPress: () =>
        deleteTracks(chosen()).then((deleted) => {
          if (deleted) router.back();
        }),
    },
  ];

  const allSelected = selected.size === list.length && list.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.bar, { paddingTop: insets.top + space.sm, backgroundColor: colors.surface }]}>
        <IconButton icon="close" label={tr('common.cancel')} onPress={() => router.back()} />
        <Text variant="heading" style={{ flex: 1 }}>
          {tr.n('library.select.count', selected.size)}
        </Text>
        <Pressable onPress={() => setSelected(allSelected ? new Set() : new Set(list.map((t) => t.id)))} hitSlop={8} accessibilityRole="button">
          <Text variant="label" color={colors.primary}>
            {allSelected ? tr('library.select.none') : tr('library.select.all')}
          </Text>
        </Pressable>
      </View>
      <FlatList
        data={list}
        keyExtractor={(t) => t.id}
        getItemLayout={(_, index) => ({ length: 64, offset: 64 * index, index })}
        renderItem={({ item }) => <TrackRow track={item} selecting selected={selected.has(item.id)} onPress={() => toggle(item.id)} />}
      />
      <View style={[styles.actions, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: insets.bottom }]}>
        {actions.map((a) => (
          <Pressable
            key={a.icon}
            onPress={a.onPress}
            disabled={selected.size === 0}
            accessibilityRole="button"
            style={[styles.action, selected.size === 0 && { opacity: 0.4 }]}>
            <Icon name={a.icon} color={colors.text} />
            <Text variant="caption" numberOfLines={1}>
              {a.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', paddingRight: space.lg, paddingBottom: space.sm, gap: space.xs },
  actions: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  action: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: space.md },
});
