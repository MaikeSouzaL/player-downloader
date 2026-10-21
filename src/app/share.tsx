import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { ConvertSheet, QualityPicker } from '@/components/ConvertSheet';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/misc';
import { Text } from '@/components/ui/Text';
import { useT } from '@/i18n';
import { inspectLink, startDownload, type LinkInfo } from '@/lib/downloads';
import { logError } from '@/lib/errorlog';
import { formatBytes } from '@/lib/format';
import { grabEnabled } from '@/lib/grabber';
import { blockedService, extractUrl, mediaTypeOf } from '@/lib/links';
import { addSharedToVault } from '@/lib/vault';
import RitmoCore, { type SharedItem } from '@/modules/ritmo-core';
import { useLibrary } from '@/store/library';
import { setPendingShare, useShare } from '@/store/share';
import { useUi } from '@/store/ui';
import { radius, space, useColors } from '@/theme';

type ItemState = 'idle' | 'busy' | 'saved' | 'vault' | 'error';

const WAIT_MS = 5000;

/** "Compartilhar com o Player Downloader" (inspirado no SnapTube): o que fazer com o que veio de outro app. */
export default function ShareScreen() {
  const tr = useT();
  const payload = useShare((s) => s.pending);
  const url = payload && payload.items.length === 0 ? extractUrl(payload.text) : null;
  // "Abrir com" no Android: a tela pode abrir antes de o app ler o Intent (startShareListener). Espera um pouco.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (payload) return;
    const timer = setTimeout(() => setWaited(true), WAIT_MS);
    return () => clearTimeout(timer);
  }, [payload]);

  // Veio do YouTube/Instagram/etc. e o motor local existe (Android): vai direto para a qualidade.
  useEffect(() => {
    if (!url || !grabEnabled() || !blockedService(url)) return;
    setPendingShare(null);
    router.replace({ pathname: '/grab', params: { url } });
  }, [url]);

  const done = () => {
    setPendingShare(null);
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: tr('tools.share.title') }} />
      {!payload && !waited ? (
        <View style={styles.waiting}>
          <ActivityIndicator />
        </View>
      ) : !payload || (payload.items.length === 0 && !url) ? (
        <EmptyState icon="file_open" title={tr('tools.share.nothing')} message={payload?.text ? tr('tools.share.noLink') : undefined} />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {url ? <LinkCard key={url} url={url} onStarted={done} /> : payload.items.map((item) => <ItemCard key={item.uri} item={item} />)}
          <Button label={tr('common.done')} variant="tonal" onPress={done} style={{ alignSelf: 'stretch', marginTop: space.md }} />
        </ScrollView>
      )}
    </View>
  );
}

function ItemCard({ item }: { item: SharedItem }) {
  const tr = useT();
  const colors = useColors();
  const media = mediaTypeOf(item.mime, item.name);
  const [state, setState] = useState<ItemState>('idle');
  const [converting, setConverting] = useState(false);

  const save = async () => {
    if (!media) return;
    setState('busy');
    try {
      await RitmoCore.saveToLibrary(item.uri, item.name, item.mime, media);
      setState('saved');
      useUi.getState().showToast(tr(media === 'video' ? 'tools.share.savedVideo' : 'tools.share.savedAudio', { name: item.name }));
      void useLibrary.getState().scan();
    } catch (e) {
      logError('Compartilhar: salvar', e, { name: item.name });
      setState('error');
    }
  };

  const toVault = async () => {
    setState('busy');
    setState((await addSharedToVault(item)) ? 'vault' : 'error');
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
          <Icon name={media === 'video' ? 'movie' : media === 'audio' ? 'music_note' : 'error'} color={colors.primary} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" numberOfLines={2}>
            {item.name}
          </Text>
          <Text variant="caption" muted>
            {media ? tr(media === 'video' ? 'tools.share.video' : 'tools.share.audio') : tr('tools.share.unsupported')}
            {item.size > 0 ? ` · ${formatBytes(item.size)}` : ''}
          </Text>
        </View>
      </View>
      {state === 'busy' && <ActivityIndicator color={colors.primary} />}
      {state === 'saved' && <Text color={colors.primary}>{tr('tools.share.savedState')}</Text>}
      {state === 'vault' && <Text color={colors.primary}>{tr('tools.share.vaultState')}</Text>}
      {state === 'error' && <Text color={colors.danger}>{tr('tools.share.error')}</Text>}
      {media && (state === 'idle' || state === 'error') && (
        <View style={styles.actions}>
          <Button label={tr(media === 'video' ? 'tools.share.saveVideo' : 'tools.share.saveAudio')} icon="download" compact onPress={save} />
          {media === 'video' && <Button label={tr('tools.convert.title')} icon="music_note" variant="tonal" compact onPress={() => setConverting(true)} />}
          <Button label={tr('tools.vault.title')} icon="lock" variant="outline" compact onPress={toVault} />
        </View>
      )}
      <ConvertSheet source={converting ? { uri: item.uri, name: item.name } : null} onClose={() => setConverting(false)} />
    </View>
  );
}

function LinkCard({ url, onStarted }: { url: string; onStarted: () => void }) {
  const tr = useT();
  const colors = useColors();
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [quality, setQuality] = useState(0);
  const grab = grabEnabled();

  const openGrab = () => router.push({ pathname: '/grab', params: { url } });

  useEffect(() => {
    let alive = true;
    inspectLink(url)
      .then((r) => alive && setInfo(r))
      .catch(() => alive && setInfo({ kind: 'invalid', url }));
    return () => {
      alive = false;
    };
  }, [url]);

  const start = (action: 'save' | 'convert') => {
    if (info?.kind !== 'media') return;
    try {
      startDownload(info, action, quality);
      useUi.getState().showToast(tr('tools.dl.started', { name: info.name }));
      onStarted();
      router.push('/downloads');
    } catch (e) {
      logError('Compartilhar: baixar', e);
      useUi.getState().showToast(tr('tools.dl.startFailed'));
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <Text variant="caption" muted numberOfLines={2}>
        {url}
      </Text>
      {!info && (
        <View style={styles.row}>
          <ActivityIndicator color={colors.primary} />
          <Text muted>{tr('tools.link.checking')}</Text>
        </View>
      )}
      {info?.kind === 'blocked' &&
        (grab ? (
          <Button label={tr('tools.grab.open')} icon="download" onPress={openGrab} />
        ) : (
          <>
            <View style={[styles.warning, { backgroundColor: colors.surfaceAlt }]}>
              <Icon name="error" color={colors.danger} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text variant="label">{tr('tools.link.blockedTitle', { service: info.service })}</Text>
                <Text variant="caption" muted>
                  {tr('tools.link.blockedText', { service: info.service })}
                </Text>
              </View>
            </View>
            <Text variant="caption" muted>
              {tr('tools.grab.androidOnlyText')}
            </Text>
          </>
        ))}
      {(info?.kind === 'page' || info?.kind === 'invalid') && (
        <View style={{ gap: space.sm }}>
          <Text muted>{tr('tools.link.page')}</Text>
          {grab && info?.kind === 'page' && <Button label={tr('tools.grab.open')} icon="download" variant="tonal" onPress={openGrab} />}
        </View>
      )}
      {info?.kind === 'unsupported' && <Text muted>{tr('tools.link.unsupported', { ext: info.ext })}</Text>}
      {info?.kind === 'media' && (
        <>
          <View style={styles.row}>
            <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
              <Icon name={info.media === 'video' ? 'movie' : 'music_note'} color={colors.primary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="label" numberOfLines={2}>
                {info.name}
              </Text>
              <Text variant="caption" muted>
                {tr(info.media === 'video' ? 'tools.share.video' : 'tools.share.audio')}
                {info.size > 0 ? ` · ${formatBytes(info.size)}` : ''}
              </Text>
            </View>
          </View>
          {info.media === 'audio' ? (
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
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.md },
  waiting: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: radius.lg, padding: space.lg, gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  warning: { flexDirection: 'row', gap: space.md, borderRadius: radius.md, padding: space.md },
});
