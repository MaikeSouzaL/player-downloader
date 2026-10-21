import { router } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Artwork } from '@/components/Artwork';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/misc';
import { Text } from '@/components/ui/Text';
import { artistName, useT } from '@/i18n';
import { gridColumns } from '@/lib/layout';
import { sortAlbums, UNKNOWN_ALBUM, type Album } from '@/lib/library';
import { useLibrary } from '@/store/library';
import { useSettings } from '@/store/settings';
import { radius, space, useColors } from '@/theme';

const openAlbum = (album: Album) => router.push({ pathname: '/album/[id]', params: { id: album.id } });

export function AlbumsTab() {
  const tr = useT();
  const colors = useColors();
  const all = useLibrary((s) => s.index.albums);
  const sort = useSettings((s) => s.albumSort);
  const view = useSettings((s) => s.albumView);
  const albums = useMemo(() => sortAlbums(all, sort), [all, sort]);
  const { width } = useWindowDimensions();
  // Mais colunas com a tela larga (celular deitado, tablet).
  const columns = gridColumns(width);
  const size = (width - space.lg * 2 - space.md * (columns - 1)) / columns;
  const albumName = (album: Album) => (album.name === UNKNOWN_ALBUM ? tr('common.unknownAlbum') : album.name);

  if (view === 'list') {
    return (
      <FlatList
        key="list"
        data={albums}
        keyExtractor={(a) => a.id}
        getItemLayout={(_, index) => ({ length: 72, offset: 72 * index, index })}
        ListEmptyComponent={<EmptyState icon="album" title={tr('library.albums.empty')} />}
        renderItem={({ item }) => (
          <Pressable onPress={() => openAlbum(item)} android_ripple={{ color: colors.ripple }} accessibilityRole="button" style={styles.row}>
            <Artwork track={item.cover} size={52} radius={6} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="heading" numberOfLines={1}>
                {albumName(item)}
              </Text>
              <Text variant="caption" muted numberOfLines={1}>
                {artistName(item.artist)} · {tr.n('common.songs', item.tracks.length)}
                {item.year ? ` · ${item.year}` : ''}
              </Text>
            </View>
            <Icon name="chevron_right" size={22} color={colors.textWeak} />
          </Pressable>
        )}
      />
    );
  }

  return (
    <FlatList
      key={`grid-${columns}`}
      data={albums}
      numColumns={columns}
      keyExtractor={(a) => a.id}
      contentContainerStyle={styles.grid}
      columnWrapperStyle={{ gap: space.md }}
      ListEmptyComponent={<EmptyState icon="album" title={tr('library.albums.empty')} />}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => openAlbum(item)}
          accessibilityRole="button"
          accessibilityLabel={`${albumName(item)}, ${artistName(item.artist)}`}
          style={{ width: size, gap: 6 }}>
          <Artwork track={item.cover} size={size} radius={radius.lg} quality="large" />
          <View style={{ paddingHorizontal: 2 }}>
            <Text variant="label" numberOfLines={1}>
              {albumName(item)}
            </Text>
            <Text variant="caption" muted numberOfLines={1}>
              {artistName(item.artist)} · {item.tracks.length}
            </Text>
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  grid: { padding: space.lg, gap: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, height: 72 },
});
