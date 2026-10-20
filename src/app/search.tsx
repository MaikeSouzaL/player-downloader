import { router } from 'expo-router';
import { useDeferredValue, useMemo, useState } from 'react';
import { Keyboard, Pressable, SectionList, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Artwork } from '@/components/Artwork';
import { MiniPlayer } from '@/components/MiniPlayer';
import { TrackRow } from '@/components/TrackRow';
import { IconButton } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/misc';
import { Text } from '@/components/ui/Text';
import { artistName, localPath, type StringKey, useT } from '@/i18n';
import { formatDuration } from '@/lib/format';
import { matchesQuery, searchGroups, UNKNOWN_ALBUM, UNKNOWN_ARTIST, type Album, type Artist, type Folder, type Track } from '@/lib/library';
import type { NativeVideo } from '@/modules/ritmo-core';
import { useSearchHistory } from '@/store/history';
import { useLibrary } from '@/store/library';
import { usePlayer } from '@/store/player';
import { radius, space, useColors } from '@/theme';

type Row =
  | { kind: 'track'; track: Track; index: number }
  | { kind: 'artist'; artist: Artist }
  | { kind: 'album'; album: Album }
  | { kind: 'folder'; folder: Folder }
  | { kind: 'video'; video: NativeVideo };

type Section = { title: StringKey; data: Row[] };

/** Busca local (LocalSearchFragment do Lark): músicas, artistas, álbuns, pastas e vídeos. */
export default function SearchScreen() {
  const tr = useT();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const index = useLibrary((s) => s.index);
  const videos = useLibrary((s) => s.videos);
  const { queries, add, remove, clear } = useSearchHistory();

  const { sections, tracks } = useMemo(() => {
    const groups = searchGroups(index, deferred);
    const vids = deferred.trim() ? videos.filter((v) => matchesQuery(`${v.title} ${v.fileName ?? ''}`, deferred)).slice(0, 5) : [];
    const all: Section[] = [
      { title: 'library.tab.artists', data: groups.artists.map((artist): Row => ({ kind: 'artist', artist })) },
      { title: 'library.tab.albums', data: groups.albums.map((album): Row => ({ kind: 'album', album })) },
      { title: 'library.tab.folders', data: groups.folders.map((folder): Row => ({ kind: 'folder', folder })) },
      { title: 'library.search.videos', data: vids.map((video): Row => ({ kind: 'video', video })) },
      { title: 'library.search.songs', data: groups.tracks.map((track, i): Row => ({ kind: 'track', track, index: i })) },
    ];
    return { sections: all.filter((s) => s.data.length > 0), tracks: groups.tracks };
  }, [index, videos, deferred]);

  const open = (fn: () => void) => () => {
    add(query);
    Keyboard.dismiss();
    fn();
  };

  const renderRow = (row: Row) => {
    switch (row.kind) {
      case 'track':
        return <TrackRow track={row.track} onPress={open(() => usePlayer.getState().playTracks(tracks, row.index))} />;
      case 'artist':
        return (
          <ResultRow
            cover={<Artwork track={row.artist.tracks[0]} size={44} radius={22} />}
            title={row.artist.name === UNKNOWN_ARTIST ? tr('common.unknownArtist') : row.artist.name}
            subtitle={tr.n('common.songs', row.artist.tracks.length)}
            onPress={open(() => router.push({ pathname: '/artist/[id]', params: { id: row.artist.id } }))}
          />
        );
      case 'album':
        return (
          <ResultRow
            cover={<Artwork track={row.album.cover} size={44} radius={6} />}
            title={row.album.name === UNKNOWN_ALBUM ? tr('common.unknownAlbum') : row.album.name}
            subtitle={artistName(row.album.artist)}
            onPress={open(() => router.push({ pathname: '/album/[id]', params: { id: row.album.id } }))}
          />
        );
      case 'folder':
        return (
          <ResultRow
            cover={
              <View style={[styles.iconTile, { backgroundColor: colors.primarySoft }]}>
                <Icon name="folder" color={colors.primary} />
              </View>
            }
            title={row.folder.name}
            subtitle={localPath(row.folder.path)}
            onPress={open(() => router.push({ pathname: '/folder', params: { path: row.folder.path } }))}
          />
        );
      case 'video':
        return (
          <ResultRow
            cover={
              <View style={[styles.iconTile, { backgroundColor: colors.surfaceAlt }]}>
                <Icon name="movie" color={colors.textMuted} />
              </View>
            }
            title={row.video.title}
            subtitle={formatDuration(row.video.duration)}
            onPress={open(() => router.push({ pathname: '/video/[id]', params: { id: row.video.id } }))}
          />
        );
    }
  };

  const searching = deferred.trim().length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.bar, { paddingTop: insets.top + space.sm, backgroundColor: colors.surface }]}>
        <IconButton icon="arrow_back" label={tr('common.back')} onPress={() => router.back()} />
        <View style={[styles.field, { backgroundColor: colors.surfaceAlt }]}>
          <Icon name="search" size={20} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => add(query)}
            placeholder={tr('library.search.placeholder')}
            placeholderTextColor={colors.textWeak}
            autoFocus
            returnKeyType="search"
            autoCorrect={false}
            style={[styles.input, { color: colors.text }]}
            accessibilityLabel={tr('common.search')}
          />
          {query.length > 0 && <IconButton icon="close" label={tr('library.search.clear')} size={18} box={32} onPress={() => setQuery('')} />}
        </View>
      </View>

      {searching ? (
        <SectionList
          sections={sections}
          keyExtractor={(row, i) => `${row.kind}-${i}`}
          keyboardShouldPersistTaps="handled"
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <Text variant="label" muted style={styles.sectionTitle}>
              {tr(section.title, { n: section.data.length })}
            </Text>
          )}
          renderItem={({ item }) => renderRow(item)}
          ListEmptyComponent={<EmptyState icon="search_off" title={tr('library.search.noResults')} message={tr('library.search.noMatch', { query: deferred.trim() })} />}
        />
      ) : queries.length > 0 ? (
        <View>
          <View style={styles.historyHead}>
            <Text variant="label" style={{ flex: 1 }}>
              {tr('library.search.recent')}
            </Text>
            <Pressable onPress={clear} accessibilityRole="button" hitSlop={8}>
              <Text variant="label" color={colors.primary}>
                {tr('library.search.clear')}
              </Text>
            </Pressable>
          </View>
          <View style={styles.historyChips}>
            {queries.map((q) => (
              <Pressable
                key={q}
                onPress={() => setQuery(q)}
                onLongPress={() => remove(q)}
                accessibilityRole="button"
                accessibilityHint={tr('library.search.removeHint')}
                style={[styles.historyChip, { backgroundColor: colors.surfaceAlt }]}>
                <Icon name="history" size={16} color={colors.textMuted} />
                <Text variant="caption">{q}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <EmptyState icon="manage_search" title={tr('library.search.startTitle')} message={tr('library.search.startMessage')} />
      )}
      <MiniPlayer />
    </View>
  );
}

function ResultRow({ cover, title, subtitle, onPress }: { cover: React.ReactNode; title: string; subtitle: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable onPress={onPress} android_ripple={{ color: colors.ripple }} accessibilityRole="button" style={styles.result}>
      {cover}
      <View style={{ flex: 1 }}>
        <Text variant="heading" numberOfLines={1}>
          {title}
        </Text>
        <Text variant="caption" muted numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Icon name="chevron_right" size={20} color={colors.textWeak} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', paddingRight: space.lg, paddingBottom: space.sm, gap: space.xs },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 42, borderRadius: radius.pill, paddingLeft: space.md, paddingRight: space.xs },
  input: { flex: 1, fontSize: 15, paddingVertical: 0 },
  sectionTitle: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xs },
  result: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, height: 60 },
  iconTile: { width: 44, height: 44, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  historyHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.md },
  historyChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.lg },
  historyChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, height: 34, borderRadius: radius.pill },
});
