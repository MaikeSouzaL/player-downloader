import { router } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Artwork } from '@/components/Artwork';
import { IconButton } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Divider } from '@/components/ui/misc';
import { Text } from '@/components/ui/Text';
import { importPlaylistM3U } from '@/lib/backup-io';
import { logError } from '@/lib/errorlog';
import { t, useT, type StringKey } from '@/i18n';
import type { Track } from '@/lib/library';
import { useCollections } from '@/store/collections';
import { useLibrary } from '@/store/library';
import { useUi } from '@/store/ui';
import { radius, space, useColors } from '@/theme';

type Row =
  | { kind: 'smart'; id: 'liked' | 'recent' | 'top'; title: StringKey; icon: IconName; count: number; tint: string }
  | { kind: 'new' }
  | { kind: 'user'; id: string; title: string; count: number; cover?: Track };

async function importM3U() {
  try {
    const result = await importPlaylistM3U();
    if (!result) return;
    useUi.getState().showToast(result.message);
    router.push({ pathname: '/playlist/[id]', params: { id: result.id } });
  } catch (e) {
    logError('Importar M3U', e);
    useUi.getState().showToast(e instanceof Error ? e.message : t('library.playlist.importFailed'));
  }
}

function SmartCover({ icon, tint }: { icon: IconName; tint: string }) {
  return (
    <View style={[styles.cover, { backgroundColor: tint }]}>
      <Icon name={icon} size={26} color="#fff" />
    </View>
  );
}

export function PlaylistsTab() {
  const tr = useT();
  const colors = useColors();
  const { playlists, liked, recent, plays } = useCollections();
  const byId = useLibrary((s) => s.index.byId);

  const rows = useMemo<Row[]>(() => {
    const existing = (ids: string[]) => ids.filter((id) => byId.has(id)).length;
    return [
      { kind: 'smart', id: 'liked', title: 'library.smart.liked', icon: 'favorite', count: existing(liked), tint: '#F44F5E' },
      { kind: 'smart', id: 'recent', title: 'library.smart.recent', icon: 'history', count: existing(recent), tint: '#FD7846' },
      { kind: 'smart', id: 'top', title: 'library.smart.top', icon: 'trending_up', count: existing(Object.keys(plays)), tint: '#D84B22' },
      { kind: 'new' },
      ...playlists.map((p) => ({
        kind: 'user' as const,
        id: p.id,
        title: p.name,
        count: existing(p.trackIds),
        cover: p.trackIds.map((id) => byId.get(id)).find((t): t is Track => !!t),
      })),
    ];
  }, [playlists, liked, recent, plays, byId]);

  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => (r.kind === 'new' ? 'new' : r.id)}
      renderItem={({ item }) => {
        if (item.kind === 'new') {
          return (
            <>
              <Divider />
              <Pressable
                onPress={() => useUi.getState().pickPlaylist([])}
                android_ripple={{ color: colors.ripple }}
                accessibilityRole="button"
                style={styles.row}>
                <View style={[styles.cover, { backgroundColor: colors.surfaceAlt }]}>
                  <Icon name="add" size={28} color={colors.primary} />
                </View>
                <Text variant="heading" color={colors.primary} style={{ flex: 1 }}>
                  {tr('library.playlist.new')}
                </Text>
                <IconButton icon="file_open" label={tr('library.playlist.importM3U')} color={colors.textMuted} onPress={importM3U} />
              </Pressable>
            </>
          );
        }
        return (
          <Pressable
            onPress={() => router.push({ pathname: '/playlist/[id]', params: { id: item.id } })}
            android_ripple={{ color: colors.ripple }}
            accessibilityRole="button"
            style={styles.row}>
            {item.kind === 'smart' ? (
              <SmartCover icon={item.icon} tint={item.tint} />
            ) : item.cover ? (
              <Artwork track={item.cover} size={56} radius={radius.md} />
            ) : (
              <View style={[styles.cover, { backgroundColor: colors.surfaceAlt }]}>
                <Icon name="queue_music" size={26} color={colors.textMuted} />
              </View>
            )}
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="heading" numberOfLines={1}>
                {item.kind === 'smart' ? tr(item.title) : item.title}
              </Text>
              <Text variant="caption" muted>
                {tr.n('common.songs', item.count)}
              </Text>
            </View>
            <Icon name="chevron_right" size={22} color={colors.textWeak} />
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, height: 76 },
  cover: { width: 56, height: 56, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
