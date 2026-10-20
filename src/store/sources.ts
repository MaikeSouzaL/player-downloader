import { useMemo } from 'react';

import { sortTracks, type Track } from '@/lib/library';
import { useCollections } from '@/store/collections';
import { useLibrary } from '@/store/library';
import { useSettings } from '@/store/settings';

/** De onde vem uma lista de músicas (usado pela seleção múltipla). */
export type TrackSource = 'songs' | 'album' | 'artist' | 'folder' | 'playlist';

/** Playlists "inteligentes" que não ficam salvas como playlist. */
export const SMART_PLAYLISTS = ['liked', 'recent', 'top'] as const;

/** Músicas de uma playlist (normal ou inteligente), na ordem dela. */
export function usePlaylistTracks(id: string): Track[] {
  const byId = useLibrary((s) => s.index.byId);
  const liked = useCollections((s) => s.liked);
  const recent = useCollections((s) => s.recent);
  const plays = useCollections((s) => s.plays);
  const playlist = useCollections((s) => s.playlists.find((p) => p.id === id));

  return useMemo(() => {
    const ids =
      id === 'liked'
        ? liked
        : id === 'recent'
          ? recent
          : id === 'top'
            ? Object.entries(plays)
                .sort((a, b) => b[1] - a[1])
                .map(([t]) => t)
            : (playlist?.trackIds ?? []);
    return ids.map((t) => byId.get(t)).filter((t): t is Track => !!t);
  }, [id, liked, recent, plays, playlist, byId]);
}

/** Músicas de qualquer origem; `undefined` quando a origem não existe mais. */
export function useSourceTracks(source: TrackSource, id = ''): Track[] | undefined {
  const index = useLibrary((s) => s.index);
  const tracks = useLibrary((s) => s.tracks);
  const sort = useSettings((s) => s.songSort);
  const playlistTracks = usePlaylistTracks(id);
  const playlistExists = useCollections((s) => s.playlists.some((p) => p.id === id));

  return useMemo(() => {
    switch (source) {
      case 'album':
        return index.albumById.get(id)?.tracks;
      case 'artist':
        return index.artistById.get(id)?.tracks;
      case 'folder':
        return index.folderByPath.get(id)?.tracks;
      case 'playlist':
        return playlistExists || (SMART_PLAYLISTS as readonly string[]).includes(id) ? playlistTracks : undefined;
      default:
        return sortTracks(tracks, sort.key, sort.desc);
    }
  }, [source, id, index, tracks, sort, playlistTracks, playlistExists]);
}
