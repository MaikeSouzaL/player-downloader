import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ConvertSheet } from '@/components/ConvertSheet';
import { PermissionCard } from '@/components/PermissionCard';
import { IconButton } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Chip, EmptyState, ListItem } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import RitmoCore, { type NativeVideo } from '@/modules/ritmo-core';
import { localPath, useT } from '@/i18n';
import { folderName, formatBytes, formatDuration } from '@/lib/format';
import { gridColumns } from '@/lib/layout';
import { sortVideos } from '@/lib/library';
import { moveVideosToVault } from '@/lib/vault';
import { useLibrary } from '@/store/library';
import { useSettings } from '@/store/settings';
import { useVideoProgress } from '@/store/video-progress';
import { radius, space, useColors } from '@/theme';

const thumbs = new Map<string, string | null>();

/** Miniatura com a duração e a barra de "continuar assistindo". */
export function VideoThumb({ video, width }: { video: NativeVideo; width: number }) {
  const colors = useColors();
  const [loaded, setLoaded] = useState<{ id: string; uri: string | null } | null>(null);
  const saved = useVideoProgress((s) => s.progress[video.id]);

  useEffect(() => {
    if (thumbs.has(video.id)) return;
    let alive = true;
    RitmoCore.getVideoThumbnail(video.id, 320)
      .catch(() => null)
      .then((u) => {
        thumbs.set(video.id, u);
        if (alive) setLoaded({ id: video.id, uri: u });
      });
    return () => {
      alive = false;
    };
  }, [video.id]);

  const uri = thumbs.has(video.id) ? thumbs.get(video.id) : loaded?.id === video.id ? loaded.uri : null;
  const height = (width * 9) / 16;
  return (
    <View style={[styles.thumb, { width, height, backgroundColor: colors.surfaceAlt }]}>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} /> : <Icon name="movie" color={colors.textWeak} />}
      <View style={styles.duration}>
        <Text variant="micro" color="#fff">
          {formatDuration(video.duration)}
        </Text>
      </View>
      {saved && saved.duration > 0 && (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.min(100, (saved.position / saved.duration) * 100)}%`, backgroundColor: colors.primary }]} />
        </View>
      )}
    </View>
  );
}

/** Ações de um vídeo (toque longo ou ⋮): converter em música ou mover para a pasta privada. */
function VideoActions({ video, onClose }: { video: NativeVideo | null; onClose: () => void }) {
  const tr = useT();
  const [converting, setConverting] = useState<NativeVideo | null>(null);
  return (
    <>
      <Sheet visible={!!video} onClose={onClose}>
        {video && (
          <View style={{ paddingVertical: space.sm }}>
            <Text variant="label" numberOfLines={2} style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
              {video.title}
            </Text>
            <ListItem
              icon="music_note"
              title={tr('tools.convert.title')}
              onPress={() => {
                setConverting(video);
                onClose();
              }}
            />
            <ListItem
              icon="lock"
              title={tr('tools.vault.moveTo')}
              onPress={() => {
                onClose();
                void moveVideosToVault([video]);
              }}
            />
          </View>
        )}
      </Sheet>
      <ConvertSheet
        source={converting ? { uri: converting.uri, name: converting.fileName ?? `${converting.title}.mp4` } : null}
        onClose={() => setConverting(null)}
      />
    </>
  );
}

export function VideoList({ videos }: { videos: NativeVideo[] }) {
  const tr = useT();
  const colors = useColors();
  const view = useSettings((s) => s.videoView);
  const { width } = useWindowDimensions();
  const columns = gridColumns(width);
  const [menu, setMenu] = useState<NativeVideo | null>(null);
  const open = (v: NativeVideo) => router.push({ pathname: '/video/[id]', params: { id: v.id } });
  const actions = <VideoActions video={menu} onClose={() => setMenu(null)} />;

  if (view === 'grid') {
    const cell = (width - space.lg * 2 - space.md * (columns - 1)) / columns;
    return (
      <>
        <FlatList
          key={`grid-${columns}`}
          data={videos}
          numColumns={columns}
          keyExtractor={(v) => v.id}
          contentContainerStyle={{ padding: space.lg, gap: space.lg }}
          columnWrapperStyle={{ gap: space.md }}
          ListEmptyComponent={<EmptyState icon="videocam_off" title={tr('library.videos.empty')} />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => open(item)}
              onLongPress={() => setMenu(item)}
              accessibilityRole="button"
              accessibilityLabel={item.title}
              style={{ width: cell, gap: 6 }}>
              <VideoThumb video={item} width={cell} />
              <Text variant="caption" numberOfLines={2}>
                {item.title}
              </Text>
            </Pressable>
          )}
        />
        {actions}
      </>
    );
  }
  return (
    <>
      <FlatList
        key="list"
        data={videos}
        keyExtractor={(v) => v.id}
        getItemLayout={(_, index) => ({ length: 84, offset: 84 * index, index })}
        ListEmptyComponent={<EmptyState icon="videocam_off" title={tr('library.videos.empty')} message={tr('library.videos.emptyMessage')} />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => open(item)}
            onLongPress={() => setMenu(item)}
            android_ripple={{ color: colors.ripple }}
            accessibilityRole="button"
            style={styles.row}>
            <VideoThumb video={item} width={112} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text variant="label" numberOfLines={2}>
                {item.title}
              </Text>
              <Text variant="caption" muted numberOfLines={1}>
                {formatBytes(item.size)}
                {item.folder ? ` · ${folderName(item.folder)}` : ''}
              </Text>
            </View>
            <IconButton icon="more_vert" label={tr('tools.video.options')} color={colors.textMuted} onPress={() => setMenu(item)} />
          </Pressable>
        )}
      />
      {actions}
    </>
  );
}

type VideoFolder = { path: string; name: string; count: number; cover: NativeVideo };

export function VideosTab() {
  const tr = useT();
  const colors = useColors();
  const videos = useLibrary((s) => s.videos);
  const allowed = useLibrary((s) => s.videoPermission);
  const sort = useSettings((s) => s.videoSort);
  const [mode, setMode] = useState<'all' | 'folders'>('all');

  const sorted = useMemo(() => sortVideos(videos, sort), [videos, sort]);
  const folders = useMemo<VideoFolder[]>(() => {
    const map = new Map<string, NativeVideo[]>();
    for (const v of sorted) {
      const key = v.folder ?? '?';
      const list = map.get(key);
      if (list) list.push(v);
      else map.set(key, [v]);
    }
    return [...map.entries()]
      .map(([path, list]) => ({ path, name: folderName(path), count: list.length, cover: list[0] }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [sorted]);

  if (!allowed) return <PermissionCard video />;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.modes}>
        <Chip label={tr('library.videos.all', { n: videos.length })} selected={mode === 'all'} onPress={() => setMode('all')} />
        <Chip label={tr('library.videos.folders', { n: folders.length })} selected={mode === 'folders'} onPress={() => setMode('folders')} />
      </View>
      {mode === 'all' ? (
        <VideoList videos={sorted} />
      ) : (
        <FlatList
          data={folders}
          keyExtractor={(f) => f.path}
          ListEmptyComponent={<EmptyState icon="folder_off" title={tr('library.videos.noFolders')} />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: '/video-folder', params: { path: item.path } })}
              android_ripple={{ color: colors.ripple }}
              accessibilityRole="button"
              style={styles.row}>
              <VideoThumb video={item.cover} width={112} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text variant="label" numberOfLines={1}>
                  {item.name}
                </Text>
                <Text variant="caption" muted numberOfLines={1}>
                  {tr.n('common.videos', item.count)} · {localPath(item.path)}
                </Text>
              </View>
              <Icon name="chevron_right" size={22} color={colors.textWeak} />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  modes: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, height: 84 },
  thumb: { borderRadius: radius.md, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  duration: { position: 'absolute', right: 4, bottom: 6, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  progressTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  progressFill: { height: '100%' },
});
