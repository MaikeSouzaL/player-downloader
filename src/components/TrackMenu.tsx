import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Artwork } from '@/components/Artwork';
import { Divider, ListItem } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { localPath, useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { formatBytes, formatDuration, normalize } from '@/lib/format';
import { UNKNOWN_ARTIST } from '@/lib/library';
import { deleteTracks, setAsRingtone } from '@/lib/media-actions';
import { IS_ANDROID } from '@/lib/platform';
import { shareTrack } from '@/lib/share';
import { moveTracksToVault } from '@/lib/vault';
import { useCollections } from '@/store/collections';
import { usePlayer } from '@/store/player';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { space } from '@/theme';

/** Menu "Mais ações" de uma música, aberto a partir de qualquer lista. */
export function TrackMenu() {
  const tr = useT();
  const menu = useUi((s) => s.menu);
  const { closeMenu, pickPlaylist, showToast } = useUi.getState();
  const liked = useCollections((s) => (menu ? s.liked.includes(menu.track.id) : false));
  const [view, setView] = useState<'actions' | 'details' | 'ringtone'>('actions');

  const close = () => {
    setView('actions');
    closeMenu();
  };

  if (!menu) return <Sheet visible={false} onClose={close}>{null}</Sheet>;
  const { track, context } = menu;
  const artistName = track.artist ?? tr('common.unknownArtist');
  const albumName = track.album ?? tr('common.unknownAlbum');

  const act = (fn: () => void | Promise<void>) => () => {
    close();
    Promise.resolve(fn()).catch((e) => Alert.alert(tr('library.menu.failed'), errorMessage(e)));
  };

  return (
    <Sheet visible onClose={close}>
      <View style={styles.header}>
        <Artwork track={track} size={52} radius={6} />
        <View style={{ flex: 1 }}>
          <Text variant="heading" numberOfLines={1}>
            {track.title}
          </Text>
          <Text variant="caption" muted numberOfLines={1}>
            {artistName}
          </Text>
        </View>
      </View>
      <Divider />
      {view === 'ringtone' ? (
        <>
          <ListItem icon="call" title={tr('library.menu.ringtoneCall')} onPress={act(() => setAsRingtone(track, 'call'))} />
          <ListItem icon="notifications" title={tr('library.menu.ringtoneNotification')} onPress={act(() => setAsRingtone(track, 'notification'))} />
          <ListItem icon="alarm" title={tr('library.menu.ringtoneAlarm')} onPress={act(() => setAsRingtone(track, 'alarm'))} />
        </>
      ) : view === 'details' ? (
        <View style={styles.details}>
          {[
            [tr('library.details.title'), track.title],
            [tr('library.details.artist'), artistName],
            [tr('library.details.album'), albumName],
            [tr('library.details.duration'), formatDuration(track.duration)],
            [tr('library.details.size'), formatBytes(track.size)],
            [tr('library.details.format'), track.mime ?? '—'],
            [tr('library.details.year'), track.year ? String(track.year) : '—'],
            [tr('library.details.file'), track.path ? localPath(track.path) : track.fileName ?? '—'],
          ].map(([label, value]) => (
            <View key={label} style={styles.detailRow}>
              <Text variant="caption" muted style={{ width: 80 }}>
                {label}
              </Text>
              <Text variant="caption" style={{ flex: 1 }} selectable>
                {value}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <>
          <ListItem
            icon="playlist_play"
            title={tr('library.playNext')}
            onPress={act(async () => {
              await usePlayer.getState().playNext([track]);
              showToast(tr('library.playNextToast'));
            })}
          />
          <ListItem
            icon="queue_music"
            title={tr('library.addToQueue')}
            onPress={act(async () => {
              await usePlayer.getState().addToQueue([track]);
              showToast(tr('library.addedToQueue'));
            })}
          />
          <ListItem icon="playlist_add" title={tr('library.addToPlaylist')} onPress={() => pickPlaylist([track])} />
          <ListItem
            icon="favorite"
            title={liked ? tr('library.menu.unlike') : tr('library.menu.like')}
            onPress={act(() => {
              useCollections.getState().toggleLike(track.id);
              showToast(liked ? tr('library.menu.unlikedToast') : tr('library.menu.likedToast'));
            })}
          />
          {context.playlistId && context.playlistIndex != null && (
            <ListItem
              icon="playlist_remove"
              title={tr('library.menu.removeFromPlaylist')}
              onPress={act(() => useCollections.getState().removeFromPlaylist(context.playlistId!, context.playlistIndex!))}
            />
          )}
          {context.queueIndex != null && (
            <ListItem
              icon="remove_circle"
              title={tr('library.menu.removeFromQueue')}
              onPress={act(() => usePlayer.getState().removeAt(context.queueIndex!))}
            />
          )}
          {context.fromPlayer && (
            <>
              <ListItem icon="timer" title={tr('library.menu.timer')} onPress={act(() => router.push('/sleep-timer'))} />
              <ListItem
                icon="speed"
                title={tr('library.menu.speed')}
                onPress={act(() => router.push({ pathname: '/sleep-timer', params: { mode: 'speed' } }))}
              />
            </>
          )}
          <ListItem
            icon="album"
            title={tr('library.menu.goAlbum')}
            subtitle={albumName}
            onPress={act(() => router.push({ pathname: '/album/[id]', params: { id: track.albumId } }))}
          />
          <ListItem
            icon="person"
            title={tr('library.menu.goArtist')}
            subtitle={artistName}
            onPress={act(() => router.push({ pathname: '/artist/[id]', params: { id: normalize(track.artist ?? UNKNOWN_ARTIST) } }))}
          />
          <ListItem icon="lyrics" title={tr('library.menu.lyrics')} onPress={act(() => router.push({ pathname: '/lyrics-edit/[id]', params: { id: track.id } }))} />
          <ListItem icon="share" title={tr('library.menu.share')} onPress={act(() => shareTrack(track))} />
          <ListItem icon="lock" title={tr('tools.vault.moveTo')} onPress={act(async () => void (await moveTracksToVault([track])))} />
          <ListItem
            icon="visibility_off"
            title={tr('library.menu.hide')}
            subtitle={tr('library.menu.hideSubtitle')}
            onPress={act(() => {
              useSettings.getState().hideTracks([track.id]);
              showToast(tr('library.menu.hiddenToast'));
            })}
          />
          <ListItem icon="edit" title={tr('library.editInfo')} onPress={act(() => router.push({ pathname: '/edit/[id]', params: { id: track.id } }))} />
          {IS_ANDROID && <ListItem icon="ring_volume" title={tr('library.menu.setRingtone')} onPress={() => setView('ringtone')} />}
          <ListItem icon="info" title={tr('library.menu.info')} onPress={() => setView('details')} />
          <ListItem icon="delete" title={tr('common.delete')} danger onPress={act(async () => void (await deleteTracks([track])))} />
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.md },
  details: { padding: space.lg, gap: space.sm },
  detailRow: { flexDirection: 'row', gap: space.md },
});
