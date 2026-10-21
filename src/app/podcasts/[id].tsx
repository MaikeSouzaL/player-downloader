import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { PodcastCover } from '@/components/PodcastCover';
import { Button, IconButton } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/misc';
import { Text } from '@/components/ui/Text';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { formatDuration } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { downloadEpisode, episodeState, refreshPodcast, type EpisodeState } from '@/lib/podcasts';
import type { Episode } from '@/lib/rss';
import { useDownloads } from '@/store/downloads';
import { useLibrary } from '@/store/library';
import { usePlayer } from '@/store/player';
import { usePodcasts, type Podcast } from '@/store/podcasts';
import { useUi } from '@/store/ui';
import { radius, space, useColors } from '@/theme';

/** Episódios de um podcast: baixar, acompanhar o download e tocar o que já está na biblioteca. */
export default function PodcastScreen() {
  const tr = useT();
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const podcast = usePodcasts((s) => s.podcasts.find((p) => p.id === id));
  const downloads = usePodcasts((s) => s.downloads);
  const saved = usePodcasts((s) => s.saved);
  const jobs = useDownloads((s) => s.jobs);
  const tracks = useLibrary((s) => s.allTracks);
  const [refreshing, setRefreshing] = useState(false);

  if (!podcast) return <EmptyState icon="podcasts" title={tr('extras.podcast.empty')} />;

  const refresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await refreshPodcast(podcast);
      useUi.getState().showToast(fresh > 0 ? tr.n('extras.podcast.updatedNew', fresh) : tr('extras.podcast.upToDate'));
    } catch (e) {
      useUi.getState().showToast(errorMessage(e));
    } finally {
      setRefreshing(false);
    }
  };

  const unsubscribe = () =>
    Alert.alert(tr('extras.podcast.unsubscribe'), tr('extras.podcast.unsubscribeConfirm', { name: podcast.title }), [
      { text: tr('common.cancel'), style: 'cancel' },
      {
        text: tr('extras.podcast.unsubscribe'),
        style: 'destructive',
        onPress: () => {
          router.back();
          usePodcasts.getState().remove(podcast.id);
        },
      },
    ]);

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: podcast.title }} />
      <FlatList
        data={podcast.episodes}
        keyExtractor={(e) => e.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.primary]} tintColor={colors.primary} />}
        ListHeaderComponent={
          <View style={[styles.header, { backgroundColor: colors.surface }]}>
            <View style={styles.headerRow}>
              <PodcastCover uri={podcast.image} size={88} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text variant="title" numberOfLines={3}>
                  {podcast.title}
                </Text>
                {!!podcast.author && (
                  <Text variant="caption" muted numberOfLines={1}>
                    {podcast.author}
                  </Text>
                )}
                <Text variant="caption" muted>
                  {tr.n('extras.podcast.episodes', podcast.episodes.length)}
                </Text>
              </View>
            </View>
            <View style={styles.headerButtons}>
              <Button label={tr('extras.podcast.refresh')} icon="refresh" variant="tonal" compact onPress={refresh} disabled={refreshing} />
              <Button label={tr('extras.podcast.unsubscribe')} icon="delete" variant="ghost" compact onPress={unsubscribe} />
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <EpisodeRow podcast={podcast} episode={item} state={episodeState(podcast.id, item.id, downloads, saved, jobs, tracks)} />
        )}
      />
    </View>
  );
}

function EpisodeRow({ podcast, episode, state }: { podcast: Podcast; episode: Episode; state: EpisodeState }) {
  const tr = useT();
  const colors = useColors();
  const date = episode.publishedAt ? new Date(episode.publishedAt).toLocaleDateString(tr.locale, { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  const meta = [date, episode.durationMs ? formatDuration(episode.durationMs) : null].filter(Boolean).join(' · ');

  const download = () => {
    haptic('tap');
    downloadEpisode(podcast, episode);
  };

  let action;
  if (state.kind === 'downloading') {
    action = (
      <View style={styles.progress}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text variant="micro" muted>
          {tr('extras.podcast.downloading', { n: Math.round(state.progress * 100) })}
        </Text>
      </View>
    );
  } else if (state.kind === 'saved' && state.track) {
    const track = state.track;
    action = (
      <IconButton
        icon="play_arrow"
        label={tr('extras.podcast.play')}
        color={colors.primary}
        onPress={() => {
          void usePlayer.getState().playTracks([track], 0);
          router.push('/player');
        }}
      />
    );
  } else if (state.kind === 'saved') {
    action = <Icon name="check_circle" color={colors.primary} />;
  } else if (state.kind === 'failed') {
    action = <IconButton icon="refresh" label={tr('extras.podcast.failed')} color={colors.danger} onPress={download} />;
  } else {
    action = <IconButton icon="download" label={tr('extras.podcast.download')} onPress={download} />;
  }

  return (
    <View style={[styles.episode, { backgroundColor: colors.surface }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" numberOfLines={2}>
          {episode.title}
        </Text>
        {!!meta && (
          <Text variant="caption" muted>
            {meta}
          </Text>
        )}
        {state.kind === 'saved' && (
          <Text variant="caption" color={colors.primary}>
            {tr('extras.podcast.downloaded')}
          </Text>
        )}
        {state.kind === 'failed' && (
          <Text variant="caption" color={colors.danger}>
            {tr('extras.podcast.failed')}
          </Text>
        )}
        {!!episode.description && (
          <Text variant="caption" muted numberOfLines={2}>
            {episode.description}
          </Text>
        )}
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.md, gap: space.sm, paddingBottom: space.xxl },
  header: { borderRadius: radius.lg, padding: space.lg, gap: space.md, marginBottom: space.xs },
  headerRow: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  headerButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  episode: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg },
  progress: { alignItems: 'center', gap: 2, minWidth: 64 },
});
