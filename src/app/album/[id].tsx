import { useLocalSearchParams } from 'expo-router';

import { TrackListScreen } from '@/components/TrackListScreen';
import { EmptyState } from '@/components/ui/misc';
import { artistName, useT } from '@/i18n';
import { UNKNOWN_ALBUM } from '@/lib/library';
import { useLibrary } from '@/store/library';

export default function AlbumScreen() {
  const tr = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const album = useLibrary((s) => s.index.albumById.get(id));
  if (!album) return <EmptyState icon="album" title={tr('library.album.notFound')} />;
  return (
    <TrackListScreen
      title={album.name === UNKNOWN_ALBUM ? tr('common.unknownAlbum') : album.name}
      subtitle={[artistName(album.artist), album.year || null].filter(Boolean).join(' · ')}
      select={{ source: 'album', id: album.id }}
      tracks={album.tracks}
      cover={album.cover}
      numbered
    />
  );
}
