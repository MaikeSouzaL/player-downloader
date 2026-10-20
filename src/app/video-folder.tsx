import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { EmptyState } from '@/components/ui/misc';
import { useT } from '@/i18n';
import { folderName } from '@/lib/format';
import { sortVideos } from '@/lib/library';
import { VideoList } from '@/screens/VideosTab';
import { useLibrary } from '@/store/library';
import { useSettings } from '@/store/settings';

/** Vídeos de uma pasta (aba Vídeo › Pastas). */
export default function VideoFolderScreen() {
  const tr = useT();
  const { path } = useLocalSearchParams<{ path: string }>();
  const videos = useLibrary((s) => s.videos);
  const sort = useSettings((s) => s.videoSort);
  const list = useMemo(() => sortVideos(videos.filter((v) => (v.folder ?? '?') === path), sort), [videos, path, sort]);

  return (
    <>
      <Stack.Screen options={{ title: folderName(path) }} />
      {list.length === 0 ? <EmptyState icon="videocam_off" title={tr('library.videos.folderEmpty')} /> : <VideoList videos={list} />}
    </>
  );
}
