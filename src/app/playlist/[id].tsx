import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, TextInput, View } from 'react-native';

import { TrackListScreen } from '@/components/TrackListScreen';
import { Button, IconButton } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { exportPlaylistM3U } from '@/lib/backup-io';
import { useT, type StringKey } from '@/i18n';
import { logError } from '@/lib/errorlog';
import { errorMessage } from '@/lib/errors';
import { useCollections } from '@/store/collections';
import { usePlaylistTracks } from '@/store/sources';
import { radius, space, useColors } from '@/theme';

const SMART: Record<string, { title: StringKey; icon: IconName; tint: string; empty: StringKey }> = {
  liked: { title: 'library.smart.liked', icon: 'favorite', tint: '#F44F5E', empty: 'library.smart.likedEmpty' },
  recent: { title: 'library.smart.recent', icon: 'history', tint: '#FD7846', empty: 'library.smart.playedEmpty' },
  top: { title: 'library.smart.top', icon: 'trending_up', tint: '#D84B22', empty: 'library.smart.playedEmpty' },
};

export default function PlaylistScreen() {
  const tr = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const playlist = useCollections((s) => s.playlists.find((p) => p.id === id));
  const tracks = usePlaylistTracks(id);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');

  const smart = SMART[id];

  if (!smart && !playlist) return <EmptyState icon="queue_music" title={tr('library.playlist.notFound')} />;

  const remove = () =>
    Alert.alert(tr('library.playlist.deleteTitle', { name: playlist!.name }), tr('library.playlist.deleteMessage'), [
      { text: tr('common.cancel'), style: 'cancel' },
      {
        text: tr('common.delete'),
        style: 'destructive',
        onPress: () => {
          useCollections.getState().deletePlaylist(playlist!.id);
          router.back();
        },
      },
    ]);

  return (
    <>
      <TrackListScreen
        title={smart ? tr(smart.title) : playlist!.name}
        tracks={tracks}
        cover={smart ? undefined : tracks[0]}
        coverNode={
          smart ? (
            <View style={[styles.smart, { backgroundColor: smart.tint }]}>
              <Icon name={smart.icon} size={56} color="#fff" />
            </View>
          ) : undefined
        }
        emptyTitle={smart ? tr(smart.empty) : tr('library.playlist.empty')}
        select={{ source: 'playlist', id }}
        menuContext={playlist ? (index) => ({ playlistId: playlist.id, playlistIndex: playlist.trackIds.indexOf(tracks[index].id) }) : undefined}
        headerRight={
          playlist
            ? () => (
                <View style={{ flexDirection: 'row' }}>
                  <IconButton
                    icon="share"
                    label={tr('library.playlist.exportM3U')}
                    onPress={() =>
                      exportPlaylistM3U(playlist.id).catch((e) => {
                        logError('Exportar M3U', e);
                        Alert.alert(tr('library.playlist.exportFailed'), errorMessage(e));
                      })
                    }
                  />
                  <IconButton
                    icon="swap_vert"
                    label={tr('library.playlist.arrange')}
                    onPress={() => router.push({ pathname: '/playlist/arrange', params: { id: playlist.id } })}
                  />
                  <IconButton
                    icon="edit"
                    label={tr('library.playlist.rename')}
                    onPress={() => {
                      setName(playlist.name);
                      setRenaming(true);
                    }}
                  />
                  <IconButton icon="delete" label={tr('library.playlist.delete')} onPress={remove} />
                </View>
              )
            : id === 'recent' || id === 'top'
              ? () => <IconButton icon="delete_sweep" label={tr('library.playlist.clearHistory')} onPress={() => useCollections.getState().clearHistory()} />
              : undefined
        }
      />
      <Sheet visible={renaming} onClose={() => setRenaming(false)}>
        <View style={styles.rename}>
          <Text variant="heading">{tr('library.playlist.rename')}</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            autoFocus
            maxLength={60}
            style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceAlt }]}
          />
          <View style={styles.buttons}>
            <Button label={tr('common.cancel')} variant="ghost" onPress={() => setRenaming(false)} />
            <Button
              label={tr('common.save')}
              onPress={() => {
                useCollections.getState().renamePlaylist(playlist!.id, name);
                setRenaming(false);
              }}
            />
          </View>
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  smart: { width: 120, height: 120, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  rename: { padding: space.lg, gap: space.lg },
  input: { height: 48, borderRadius: radius.md, paddingHorizontal: space.lg, fontSize: 16 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
});
