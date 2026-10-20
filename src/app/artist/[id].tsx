import { useLocalSearchParams } from 'expo-router';

import { TrackListScreen } from '@/components/TrackListScreen';
import { EmptyState } from '@/components/ui/misc';
import { useT } from '@/i18n';
import { UNKNOWN_ARTIST } from '@/lib/library';
import { useLibrary } from '@/store/library';

export default function ArtistScreen() {
  const tr = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const artist = useLibrary((s) => s.index.artistById.get(id));
  if (!artist) return <EmptyState icon="person" title={tr('library.artist.notFound')} />;
  return (
    <TrackListScreen
      title={artist.name === UNKNOWN_ARTIST ? tr('common.unknownArtist') : artist.name}
      subtitle={tr.n('common.albums', artist.albums)}
      select={{ source: 'artist', id: artist.id }}
      tracks={artist.tracks}
      cover={artist.tracks[0]}
      round
    />
  );
}
