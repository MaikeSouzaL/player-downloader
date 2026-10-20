import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, TextInput, View } from 'react-native';

import { ProgressBar, QualityPicker } from '@/components/ConvertSheet';
import { Button, IconButton } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { useT } from '@/i18n';
import { cancelDownload, inspectLink, startDownload, type LinkInfo } from '@/lib/downloads';
import { logError } from '@/lib/errorlog';
import { formatBytes } from '@/lib/format';
import { cancelGrab } from '@/lib/grab-queue';
import { grabEnabled } from '@/lib/grabber';
import { audioNameFor } from '@/lib/links';
import { useDownloads, type DownloadJob } from '@/store/downloads';
import { useGrabQueue, type GrabTask } from '@/store/grabQueue';
import { useUi } from '@/store/ui';
import { radius, space, useColors } from '@/theme';

/** Downloads de links diretos (arquivos de áudio/vídeo, podcasts), com progresso e cancelar. */
export default function DownloadsScreen() {
  const tr = useT();
  const colors = useColors();
  const jobs = useDownloads((s) => s.jobs);
  const tasks = useGrabQueue((s) => s.tasks);
  const [link, setLink] = useState('');
  const [checking, setChecking] = useState(false);
  const [found, setFound] = useState<Extract<LinkInfo, { kind: 'media' }> | null>(null);
  const [quality, setQuality] = useState(0);

  const check = async () => {
    const url = link.trim();
    if (!url) return;
    setChecking(true);
    try {
      const info = await inspectLink(url);
      if (info.kind === 'media') setFound(info);
      else if (info.kind === 'blocked') {
        if (grabEnabled()) router.push({ pathname: '/grab', params: { url } });
        else useUi.getState().showToast(tr('tools.link.blockedTitle', { service: info.service }));
      } else if (info.kind === 'unsupported') useUi.getState().showToast(tr('tools.link.unsupported', { ext: info.ext }));
      else if (grabEnabled()) router.push({ pathname: '/grab', params: { url } });
      else useUi.getState().showToast(tr('tools.link.page'));
    } finally {
      setChecking(false);
    }
  };

  const start = (action: 'save' | 'convert') => {
    if (!found) return;
    try {
      startDownload(found, action, quality);
      setFound(null);
      setLink('');
    } catch (e) {
      logError('Downloads: começar', e);
      useUi.getState().showToast(tr('tools.dl.startFailed'));
    }
  };

  const hasFinished = jobs.some((j) => j.status === 'done' || j.status === 'failed' || j.status === 'cancelled') || tasks.some((task) => task.status === 'error');
  const clearFinished = () => {
    useDownloads.getState().clearFinished();
    useGrabQueue.getState().clearErrors();
  };

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title: tr('tools.dl.title'),
          headerRight: () => (
            <View style={{ flexDirection: 'row' }}>
              <IconButton icon="public" label={tr('tools.grab.openBrowser')} onPress={() => router.push('/browser')} />
              <IconButton icon="cloud_download" label={tr('tools.grab.title')} onPress={() => router.push('/grab')} />
              {hasFinished && <IconButton icon="delete_sweep" label={tr('tools.dl.clear')} onPress={clearFinished} />}
            </View>
          ),
        }}
      />
      <View style={[styles.form, { backgroundColor: colors.surface }]}>
        <TextInput
          value={link}
          onChangeText={setLink}
          placeholder={tr('tools.dl.placeholder')}
          placeholderTextColor={colors.textWeak}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={check}
          style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceAlt }]}
        />
        {checking ? <ActivityIndicator color={colors.primary} /> : <Button label={tr('tools.dl.check')} icon="download" compact onPress={check} disabled={!link.trim()} />}
      </View>
      <Text variant="caption" muted style={styles.hint}>
        {tr('tools.dl.hint')}
      </Text>
      <FlatList
        data={jobs}
        keyExtractor={(j) => j.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md }}
        ListHeaderComponent={tasks.length > 0 ? <ServerTasks tasks={tasks} /> : undefined}
        ListEmptyComponent={tasks.length > 0 ? undefined : <EmptyState icon="download" title={tr('tools.dl.empty')} message={tr('tools.dl.emptyText')} />}
        renderItem={({ item }) => <JobRow job={item} />}
      />
      <Sheet visible={!!found} onClose={() => setFound(null)}>
        {found && (
          <View style={styles.sheet}>
            <Text variant="heading" numberOfLines={2}>
              {found.name}
            </Text>
            <Text variant="caption" muted>
              {tr(found.media === 'video' ? 'tools.share.video' : 'tools.share.audio')}
              {found.size > 0 ? ` · ${formatBytes(found.size)}` : ''}
            </Text>
            {found.media === 'audio' ? (
              <Button label={tr('tools.dl.downloadAudio')} icon="download" onPress={() => start('save')} />
            ) : (
              <>
                <Button label={tr('tools.dl.downloadVideo')} icon="download" onPress={() => start('save')} />
                <Text variant="label" muted>
                  {tr('tools.dl.orAudio')}
                </Text>
                <QualityPicker value={quality} onChange={setQuality} />
                <Button label={tr('tools.dl.downloadAsAudio')} icon="music_note" variant="tonal" onPress={() => start('convert')} />
              </>
            )}
          </View>
        )}
      </Sheet>
    </View>
  );
}

/** O que o servidor ainda está preparando (baixando do site, juntando, convertendo). */
function ServerTasks({ tasks }: { tasks: GrabTask[] }) {
  const tr = useT();
  const colors = useColors();
  return (
    <View style={{ gap: space.md }}>
      <Text variant="label" muted>
        {tr('tools.grab.serverQueue')}
      </Text>
      {tasks.map((task) => (
        <View key={task.id} style={[styles.job, { backgroundColor: colors.surface }]}>
          <View style={styles.row}>
            <Icon name={task.status === 'error' ? 'error' : 'cloud_download'} color={task.status === 'error' ? colors.danger : colors.primary} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="label" numberOfLines={1}>
                {task.title}
              </Text>
              <Text variant="caption" muted numberOfLines={2}>
                {task.status === 'error'
                  ? task.error
                  : task.status === 'queued'
                    ? tr('tools.grab.queued')
                    : `${task.stage ?? ''} · ${Math.round(task.progress * 100)}%`}
              </Text>
            </View>
            <IconButton icon={task.status === 'error' ? 'delete' : 'close'} label={task.status === 'error' ? tr('common.remove') : tr('common.cancel')} onPress={() => cancelGrab(task)} />
          </View>
          {(task.status === 'downloading' || task.status === 'converting') && <ProgressBar value={task.progress} />}
        </View>
      ))}
    </View>
  );
}

function JobRow({ job }: { job: DownloadJob }) {
  const tr = useT();
  const colors = useColors();
  const name = job.action === 'convert' ? audioNameFor(job.name) : job.name;
  const statusText = {
    running: job.total > 0 ? `${formatBytes(job.bytes)} / ${formatBytes(job.total)}` : formatBytes(job.bytes),
    saving: tr('tools.dl.saving'),
    converting: tr('tools.convert.working', { n: Math.round(job.progress * 100) }),
    done: tr('tools.dl.done'),
    failed: job.error ?? tr('tools.dl.failedShort'),
    cancelled: tr('tools.dl.cancelled'),
  }[job.status];
  const busy = job.status === 'running' || job.status === 'saving' || job.status === 'converting';

  return (
    <View style={[styles.job, { backgroundColor: colors.surface }]}>
      <View style={styles.row}>
        <Icon
          name={job.status === 'done' ? 'check_circle' : job.status === 'failed' ? 'error' : job.media === 'video' && job.action === 'save' ? 'movie' : 'music_note'}
          color={job.status === 'failed' ? colors.danger : colors.primary}
        />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" numberOfLines={1}>
            {name}
          </Text>
          <Text variant="caption" muted numberOfLines={2}>
            {statusText}
          </Text>
        </View>
        {busy ? (
          job.status !== 'saving' && <IconButton icon="close" label={tr('common.cancel')} onPress={() => cancelDownload(job)} />
        ) : (
          <>
            {(job.status === 'failed' || job.status === 'cancelled') && (
              <IconButton icon="refresh" label={tr('common.retry')} onPress={() => retry(job)} />
            )}
            <IconButton icon="delete" label={tr('common.remove')} onPress={() => useDownloads.getState().remove(job.id)} />
          </>
        )}
      </View>
      {(job.status === 'running' || job.status === 'converting') && <ProgressBar value={job.progress} />}
    </View>
  );
}

function retry(job: DownloadJob) {
  useDownloads.getState().remove(job.id);
  try {
    startDownload({ kind: 'media', url: job.url, media: job.media, name: job.name, mime: null, size: job.total }, job.action, job.bitrate);
  } catch (e) {
    logError('Downloads: tentar de novo', e);
  }
}

const styles = StyleSheet.create({
  form: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md },
  input: { flex: 1, height: 44, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 15 },
  hint: { paddingHorizontal: space.lg, paddingTop: space.sm },
  job: { borderRadius: radius.lg, padding: space.md, gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  sheet: { padding: space.lg, gap: space.md },
});
