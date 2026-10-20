import { router } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Artwork } from '@/components/Artwork';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/misc';
import { Text } from '@/components/ui/Text';
import { useT } from '@/i18n';
import { sortArtists, UNKNOWN_ARTIST } from '@/lib/library';
import { useSettings } from '@/store/settings';
import { useLibrary } from '@/store/library';
import { space, useColors } from '@/theme';

export function ArtistsTab() {
  const tr = useT();
  const colors = useColors();
  const all = useLibrary((s) => s.index.artists);
  const sort = useSettings((s) => s.artistSort);
  const artists = useMemo(() => sortArtists(all, sort), [all, sort]);

  return (
    <FlatList
      data={artists}
      keyExtractor={(a) => a.id}
      getItemLayout={(_, index) => ({ length: 72, offset: 72 * index, index })}
      ListEmptyComponent={<EmptyState icon="person" title={tr('library.artists.empty')} />}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => router.push({ pathname: '/artist/[id]', params: { id: item.id } })}
          android_ripple={{ color: colors.ripple }}
          accessibilityRole="button"
          style={styles.row}>
          <Artwork track={item.tracks[0]} size={52} radius={26} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="heading" numberOfLines={1}>
              {item.name === UNKNOWN_ARTIST ? tr('common.unknownArtist') : item.name}
            </Text>
            <Text variant="caption" muted>
              {tr.n('common.songs', item.tracks.length)} · {tr.n('common.albums', item.albums)}
            </Text>
          </View>
          <Icon name="chevron_right" size={22} color={colors.textWeak} />
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, height: 72 },
});
