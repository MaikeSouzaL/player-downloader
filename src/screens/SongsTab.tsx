import { router } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';

import { PermissionCard } from '@/components/PermissionCard';
import { PlayAllHeader } from '@/components/PlayAllHeader';
import { TrackRow } from '@/components/TrackRow';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/misc';
import { useT } from '@/i18n';
import { importFiles } from '@/lib/import-files';
import { sortTracks, type Track } from '@/lib/library';
import { IS_IOS } from '@/lib/platform';
import { useLibrary } from '@/store/library';
import { usePlayer } from '@/store/player';
import { useSettings } from '@/store/settings';
import { useColors } from '@/theme';

export function SongsTab({ onSort }: { onSort: () => void }) {
  const tr = useT();
  const colors = useColors();
  const tracks = useLibrary((s) => s.tracks);
  const permission = useLibrary((s) => s.permission);
  const scanning = useLibrary((s) => s.scanning);
  const scan = useLibrary((s) => s.scan);
  const sort = useSettings((s) => s.songSort);
  const list = useMemo(() => sortTracks(tracks, sort.key, sort.desc), [tracks, sort]);

  const play = useCallback((index: number) => usePlayer.getState().playTracks(list, index), [list]);
  const renderItem = useCallback(
    ({ item, index }: { item: Track; index: number }) => <TrackRow track={item} onPress={() => play(index)} />,
    [play]
  );

  if (permission === 'denied') return <PermissionCard />;

  return (
    <FlatList
      data={list}
      keyExtractor={(t) => t.id}
      renderItem={renderItem}
      getItemLayout={(_, index) => ({ length: 64, offset: 56 + 64 * index, index })}
      initialNumToRender={14}
      windowSize={11}
      refreshControl={<RefreshControl refreshing={scanning} onRefresh={scan} colors={[colors.primary]} progressBackgroundColor={colors.surface} />}
      ListHeaderComponent={
        list.length > 0 ? (
          <PlayAllHeader
            count={list.length}
            onPlayAll={() => play(0)}
            onShuffle={() => usePlayer.getState().playTracks(list, 0, { shuffle: true })}
            onSort={onSort}
            onSelect={() => router.push('/select')}
          />
        ) : undefined
      }
      ListEmptyComponent={
        <View>
          <EmptyState
            icon="music_off"
            title={scanning ? tr('library.songs.searching') : tr('library.songs.empty')}
            message={IS_IOS ? tr('ios.emptyMessage') : tr('library.songs.emptyMessage')}
            action={IS_IOS ? <Button label={tr('ios.import')} icon="upload_file" variant="tonal" onPress={() => void importFiles()} /> : undefined}
          />
        </View>
      }
    />
  );
}
