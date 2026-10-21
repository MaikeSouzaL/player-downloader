import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button, IconButton } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Chip, EmptyState } from '@/components/ui/misc';
import { Text } from '@/components/ui/Text';
import { useT } from '@/i18n';
import { logError } from '@/lib/errorlog';
import { errorMessage } from '@/lib/errors';
import { formatBytes, formatDuration } from '@/lib/format';
import { enqueueGrab, releaseGrabKeys, reserveGrabKeys } from '@/lib/grab-queue';
import { grabKey } from '@/lib/grab-queue-logic';
import { grabEnabled, resolveLink, searchVideos, startJob, type GrabEntry, type GrabFormat, type GrabMedia, type GrabSearchItem } from '@/lib/grabber';
import { useGrabHistory } from '@/store/grabHistory';
import { useUi } from '@/store/ui';
import { radius, space, useColors } from '@/theme';

type Tab = 'video' | 'audio';

/** Limite de vídeos por lote no motor local. */
const MAX_BATCH = 100;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}



/** Áudio do melhor para o pior: o original (sem recodificar, bitrate 0) primeiro, depois o MP3 maior. */
const audioRank = (format: GrabFormat) => (format.bitrate ? format.bitrate : Number.MAX_SAFE_INTEGER);

/** Vídeo do melhor para o pior: maior altura primeiro; na mesma altura, o que toca em tudo (H.264). */
function sortFormats(formats: GrabFormat[], tab: Tab): GrabFormat[] {
  return [...formats].sort((a, b) =>
    tab === 'audio' ? audioRank(b) - audioRank(a) : (b.height ?? 0) - (a.height ?? 0) || Number(b.compatible !== false) - Number(a.compatible !== false)
  );
}

/** No iPhone, só aparecem os formatos que o AVFoundation consegue tocar nesta v1. */
function visibleFormats(media: GrabMedia | null, tab: Tab): GrabFormat[] {
  const list = tab === 'video' ? (media?.formats ?? []) : (media?.audio ?? []);
  return Platform.OS === 'ios' ? list.filter((format) => format.compatible !== false) : list;
}

/** Primeira qualidade que toca neste aparelho (no iPhone, evita VP9/AV1/Opus). */
function defaultFormat(media: GrabMedia, tab: Tab): string {
  return sortFormats(visibleFormats(media, tab), tab)[0]?.id ?? '';
}

/**
 * "Baixar de um site" (o fluxo do SnapTube): lê o link no próprio aparelho, mostra as
 * qualidades de vídeo, os formatos de áudio e as legendas, e manda para a fila local.
 * Playlists: escolhe os vídeos e baixa todos de uma vez.
 */
export default function GrabScreen() {
  const tr = useT();
  const colors = useColors();
  const params = useLocalSearchParams<{ url?: string }>();
  const initial = typeof params.url === 'string' ? params.url : '';
  const recents = useGrabHistory((s) => s.recents);
  // O motor local só existe nos builds nativos (yt-dlp/Python embutidos no Android e no iPhone).
  const enabled = grabEnabled();

  const [link, setLink] = useState(initial);
  const [mode, setMode] = useState<'link' | 'search'>('link');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<GrabSearchItem[]>([]);
  const [searched, setSearched] = useState(false);
  const [media, setMedia] = useState<GrabMedia | null>(null);
  const [tab, setTab] = useState<Tab>('video');
  const [picked, setPicked] = useState('');
  const [subtitle, setSubtitle] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const [sending, setSending] = useState(false);
  const [warming, setWarming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  // Uma leitura/busca por vez manda no resultado: a antiga não sobrescreve a nova.
  const opSeq = useRef(0);
  const busyOp = useRef<{ kind: 'read' | 'search'; target: string } | null>(null);
  const sendingRef = useRef(false);
  const warmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startWarming = useCallback(() => {
    if (warmTimer.current) clearTimeout(warmTimer.current);
    setWarming(false);
    warmTimer.current = setTimeout(() => {
      if (alive.current) setWarming(true);
    }, 5000);
  }, []);

  const stopWarming = useCallback(() => {
    if (warmTimer.current) {
      clearTimeout(warmTimer.current);
      warmTimer.current = null;
    }
    if (alive.current) setWarming(false);
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (warmTimer.current) clearTimeout(warmTimer.current);
    };
  }, []);

  const read = useCallback(
    async (value?: string, playlist = false) => {
      const target = (value ?? link).trim();
      if (!target) return;
      if (busyOp.current?.kind === 'read' && busyOp.current.target === target) return;
      const seq = ++opSeq.current;
      busyOp.current = { kind: 'read', target };
      setReading(true);
      setSearching(false);
      setError(null);
      setMedia(null);
      startWarming();
      try {
        const found = await resolveLink(target, playlist);
        if (!alive.current || seq !== opSeq.current) return;
        if (!playlist) setLink(target);
        setMedia(found);
        useGrabHistory.getState().add({ url: found.url || target, title: found.title, thumbnail: found.thumbnail });
        const first: Tab = visibleFormats(found, 'video').length ? 'video' : 'audio';
        setTab(first);
        setPicked(defaultFormat(found, first));
        setSubtitle(null);
        setSelected(found.playlist?.entries.slice(0, MAX_BATCH).map((entry) => entry.id) ?? []);
      } catch (e) {
        if (alive.current && seq === opSeq.current) setError(errorMessage(e) || tr('tools.grab.unsupported'));
      } finally {
        if (seq === opSeq.current) {
          busyOp.current = null;
          stopWarming();
          if (alive.current) {
            setReading(false);
            setSearching(false);
          }
        }
      }
    },
    [link, tr, startWarming, stopWarming]
  );

  const search = useCallback(async () => {
    const term = query.trim();
    if (term.length < 2) return;
    if (busyOp.current?.kind === 'search' && busyOp.current.target === term) return;
    const seq = ++opSeq.current;
    busyOp.current = { kind: 'search', target: term };
    setSearching(true);
    setReading(false);
    setError(null);
    setMedia(null);
    setResults([]);
    setSearched(false);
    startWarming();
    try {
      const found = await searchVideos(term);
      if (alive.current && seq === opSeq.current) {
        setResults(found.items);
        setSearched(true);
      }
    } catch (e) {
      if (alive.current && seq === opSeq.current) setError(errorMessage(e) || tr('tools.grab.failed'));
    } finally {
      if (seq === opSeq.current) {
        busyOp.current = null;
        stopWarming();
        if (alive.current) {
          setSearching(false);
          setReading(false);
        }
      }
    }
  }, [query, tr, startWarming, stopWarming]);

  const pickResult = (item: GrabSearchItem) => {
    setMode('link');
    setLink(item.url);
    setResults([]);
    void read(item.url);
  };

  const switchMode = (next: 'link' | 'search') => {
    if (next === mode) return;
    // A operação antiga (leitura ou busca) não pode mais pintar a tela depois da troca.
    opSeq.current++;
    busyOp.current = null;
    stopWarming();
    setReading(false);
    setSearching(false);
    setMode(next);
    setError(null);
    if (next === 'search') {
      setMedia(null);
      setResults([]);
      setSearched(false);
    }
  };

  // Link veio do "Compartilhar com o Player Downloader" ou do navegador: já lê sozinho (no próximo tick,
  // para não disparar renders em cascata dentro do efeito). Com a tela já aberta, um link novo
  // (outro vídeo compartilhado no iPhone) também é lido.
  const lastInitial = useRef('');
  useEffect(() => {
    if (!initial || initial === lastInitial.current) return;
    lastInitial.current = initial;
    const timer = setTimeout(() => {
      setLink(initial);
      void read(initial);
    }, 0);
    return () => clearTimeout(timer);
    // Uma leitura por link recebido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const chooseTab = (next: Tab) => {
    if (!media) return;
    setTab(next);
    setPicked(defaultFormat(media, next));
  };

  const toggleEntry = (id: string) =>
    setSelected((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));

  const isPlaylist = media?.kind === 'playlist';
  const entries = media?.playlist?.entries ?? [];
  const allSelected = entries.length > 0 && entries.slice(0, MAX_BATCH).every((entry) => selected.includes(entry.id));

  const start = async () => {
    if (!media || !picked || sendingRef.current) return;
    const chosenVideos = isPlaylist ? entries.filter((entry) => selected.includes(entry.id)) : undefined;
    if (chosenVideos && chosenVideos.length === 0) {
      setError(tr('tools.grab.pickSome'));
      return;
    }
    if (chosenVideos && chosenVideos.length > MAX_BATCH) {
      setError(tr('tools.grab.batchLimit', { n: MAX_BATCH }));
      return;
    }

    const subtitles = tab === 'video' ? subtitle : null;
    const targets = chosenVideos?.length
      ? chosenVideos.map((entry) => ({ id: entry.id, url: entry.url }))
      : [{ id: '', url: media.url || link.trim() }];
    // Reserva antes do await: o segundo toque (ou Enter) não chama o motor de novo.
    const keys = targets.map((target) =>
      grabKey({ url: target.url, entryId: target.id, formatId: picked, kind: tab, subtitles })
    );
    if (!reserveGrabKeys(keys)) {
      useUi.getState().showToast(tr('tools.grab.alreadyQueued'));
      router.push('/downloads');
      return;
    }

    sendingRef.current = true;
    setSending(true);
    setError(null);
    try {
      const selectedFormat = (tab === 'video' ? media.formats : media.audio).find((format) => format.id === picked);
      const started = await startJob(media.url, picked, {
        subtitles,
        videos: chosenVideos,
        hasAudio: selectedFormat?.hasAudio,
        title: media.title,
        kind: tab,
      });
      const added = enqueueGrab(started, media.title, tab, {
        url: media.url || link.trim(),
        formatId: picked,
        kind: tab,
        hasAudio: !!selectedFormat?.hasAudio,
        subtitles,
        entries: targets,
      });
      if (alive.current) {
        useUi.getState().showToast(added > 0 ? tr.n('tools.grab.sent', added) : tr('tools.grab.alreadyQueued'));
        router.push('/downloads');
      }
    } catch (e) {
      logError('Baixar de um site', e, { site: hostOf(media.url) });
      if (alive.current) setError(errorMessage(e) || tr('tools.grab.failed'));
    } finally {
      releaseGrabKeys(keys);
      sendingRef.current = false;
      if (alive.current) setSending(false);
    }
  };

  const header = <Stack.Screen options={{ title: tr('tools.grab.title'), headerRight: () => <IconButton icon="public" label={tr('tools.grab.openBrowser')} onPress={() => router.push('/browser')} /> }} />;

  if (!enabled) {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <EmptyState
          icon="cloud_off"
          title={tr('tools.grab.androidOnly')}
          message={tr('tools.grab.androidOnlyText')}
        />
      </View>
    );
  }

  const formats = sortFormats(visibleFormats(media, tab), tab);
  // Legendas, MP3, 4K e VP9/AV1 ficam para a fase 2 no iPhone.
  const subtitles = tab === 'video' && Platform.OS !== 'ios' ? (media?.subtitles ?? []) : [];

  return (
    <View style={{ flex: 1 }}>
      {header}
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={[styles.form, { backgroundColor: colors.surface }]}>
          <View style={styles.chips}>
            <Chip label={tr('tools.grab.modeLink')} icon="travel_explore" selected={mode === 'link'} onPress={() => switchMode('link')} />
            <Chip label={tr('tools.grab.modeSearch')} icon="search" selected={mode === 'search'} onPress={() => switchMode('search')} />
          </View>
          {mode === 'link' ? (
            <>
              <TextInput
                value={link}
                onChangeText={setLink}
                placeholder={tr('tools.grab.placeholder')}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="go"
                onSubmitEditing={() => read()}
                style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceAlt }]}
              />
              <Button label={reading ? tr('tools.grab.reading') : tr('tools.grab.read')} icon="travel_explore" onPress={() => read()} disabled={reading || !link.trim()} />
            </>
          ) : (
            <>
              <TextInput
                value={query}
                onChangeText={(value) => {
                  setQuery(value);
                  setSearched(false);
                }}
                placeholder={tr('tools.grab.searchPlaceholder')}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                onSubmitEditing={() => search()}
                style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceAlt }]}
              />
              <Button
                label={searching ? tr('tools.grab.searching') : tr('tools.grab.searchAction')}
                icon="search"
                onPress={() => search()}
                disabled={searching || query.trim().length < 2}
              />
            </>
          )}
        </View>

        {mode === 'search' && results.length > 0 && !media && (
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            {results.map((item) => (
              <EntryRow key={item.id} entry={item} onPress={() => pickResult(item)} trailing="chevron_right" />
            ))}
          </View>
        )}

        {(searching || reading) && (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text muted>{searching ? tr('tools.grab.searching') : tr('tools.grab.reading')}</Text>
              {warming && (
                <Text variant="caption" muted>
                  {tr('tools.grab.firstRun')}
                </Text>
              )}
            </View>
          </View>
        )}

        {mode === 'link' && !media && !reading && recents.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <View style={styles.spread}>
              <Text variant="label">{tr('tools.grab.recent')}</Text>
              <Pressable onPress={() => useGrabHistory.getState().clear()} hitSlop={10} accessibilityRole="button">
                <Text variant="caption" color={colors.primary}>
                  {tr('tools.grab.clear')}
                </Text>
              </Pressable>
            </View>
            {recents.map((item) => (
              <EntryRow
                key={item.url}
                entry={{ id: item.url, url: item.url, title: item.title, thumbnail: item.thumbnail, uploader: hostOf(item.url), duration: 0 }}
                onPress={() => {
                  setLink(item.url);
                  void read(item.url);
                }}
                trailing="chevron_right"
                small
              />
            ))}
          </View>
        )}

        {error && (
          <View style={[styles.warning, { backgroundColor: colors.surface }]}>
            <Icon name="error" color={colors.danger} />
            <View style={{ flex: 1, gap: space.sm }}>
              <Text color={colors.danger}>{error}</Text>
              <Button
                label={tr('common.retry')}
                icon="refresh"
                variant="tonal"
                compact
                onPress={() => {
                  if (media && picked) void start();
                  else if (mode === 'search') void search();
                  else void read();
                }}
                style={{ alignSelf: 'flex-start' }}
              />
            </View>
          </View>
        )}

        {media && (
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <View style={styles.media}>
              {media.thumbnail ? (
                <Image source={{ uri: media.thumbnail }} style={styles.thumb} contentFit="cover" transition={150} />
              ) : (
                <View style={[styles.thumb, styles.thumbEmpty, { backgroundColor: colors.surfaceAlt }]}>
                  <Icon name={isPlaylist ? 'playlist_play' : 'movie'} color={colors.textMuted} />
                </View>
              )}
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="label" numberOfLines={3}>
                  {media.title}
                </Text>
                <Text variant="caption" muted numberOfLines={1}>
                  {isPlaylist
                    ? tr('tools.grab.playlist', { title: media.playlist?.title || media.title, n: media.playlist?.count ?? entries.length })
                    : [media.uploader, media.duration > 0 ? formatDuration(media.duration * 1000) : null].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </View>

            {!isPlaylist && media.playlistUrl && (
              <Button label={tr('tools.grab.playlistAll')} icon="playlist_play" variant="tonal" onPress={() => read(media.playlistUrl ?? undefined, true)} disabled={reading} />
            )}

            <View style={styles.chips}>
              <Chip label={tr('tools.grab.video')} icon="movie" selected={tab === 'video'} onPress={() => chooseTab('video')} />
              <Chip label={tr('tools.grab.audio')} icon="music_note" selected={tab === 'audio'} onPress={() => chooseTab('audio')} />
            </View>
            <Text variant="caption" muted>
              {tab === 'video' ? (isPlaylist ? tr('tools.grab.playlistQuality') : tr('tools.grab.videoHint')) : tr('tools.grab.audioHint')}
            </Text>
            {Platform.OS === 'ios' && (
              <Text variant="caption" muted>
                {tr('tools.grab.iosFormats')}
              </Text>
            )}

            {formats.length === 0 ? (
              <Text muted>{tab === 'video' ? tr('tools.grab.noVideo') : tr('tools.grab.noAudio')}</Text>
            ) : (
              <View style={styles.formats}>
                {formats.map((format) => (
                  <FormatRow key={format.id} format={format} tab={tab} duration={media.duration} selected={picked === format.id} onPress={() => setPicked(format.id)} />
                ))}
              </View>
            )}

            {subtitles.length > 0 && (
              <View style={{ gap: space.sm }}>
                <Text variant="label">{tr('tools.grab.subtitles')}</Text>
                <View style={[styles.chips, styles.wrap]}>
                  <Chip label={tr('tools.grab.noSubtitles')} selected={subtitle === null} onPress={() => setSubtitle(null)} />
                  {subtitles.map((sub) => (
                    <Chip
                      key={sub.id}
                      label={sub.auto ? tr('tools.grab.autoSubtitle', { name: sub.name }) : sub.name}
                      icon="subtitles"
                      selected={subtitle === sub.id}
                      onPress={() => setSubtitle(sub.id)}
                    />
                  ))}
                </View>
                <Text variant="caption" muted>
                  {isPlaylist ? tr('tools.grab.playlistSubtitleHint') : tr('tools.grab.subtitleHint')}
                </Text>
              </View>
            )}

            {isPlaylist && (
              <View style={{ gap: space.xs }}>
                <View style={styles.spread}>
                  <Text variant="label">
                    {selected.length}/{entries.length}
                  </Text>
                  <Pressable
                    onPress={() => setSelected(allSelected ? [] : entries.slice(0, MAX_BATCH).map((entry) => entry.id))}
                    hitSlop={10}
                    accessibilityRole="button">
                    <Text variant="caption" color={colors.primary}>
                      {allSelected ? tr('tools.grab.selectNone') : tr('tools.grab.selectAll')}
                    </Text>
                  </Pressable>
                </View>
                {entries.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    onPress={() => toggleEntry(entry.id)}
                    trailing={selected.includes(entry.id) ? 'check_box' : 'check_box_outline_blank'}
                    trailingColor={selected.includes(entry.id) ? colors.primary : colors.textWeak}
                    small
                  />
                ))}
              </View>
            )}

            <Button
              label={isPlaylist ? tr.n('tools.grab.downloadSome', selected.length) : tr('tools.grab.download')}
              icon="download"
              onPress={start}
              disabled={!picked || sending || (isPlaylist && selected.length === 0)}
            />
            <Text variant="caption" muted>
              {tr('tools.grab.legal')}
            </Text>
          </View>
        )}

        {!media && !reading && !searching && !error && (mode === 'search' || recents.length === 0) && (
          <Text variant="caption" muted style={styles.hint}>
            {mode === 'search' ? (searched ? tr('tools.grab.searchEmpty') : tr('tools.grab.searchHint')) : tr('tools.grab.hint')}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

function FormatRow({ format, tab, duration, selected, onPress }: { format: GrabFormat; tab: Tab; duration: number; selected: boolean; onPress: () => void }) {
  const tr = useT();
  const colors = useColors();
  const estimate = tab === 'audio' && format.bitrate && duration > 0 ? Math.round((duration * format.bitrate * 1000) / 8) : (format.filesize ?? 0);
  const details = [
    format.ext.toUpperCase(),
    tab === 'audio' && !format.bitrate ? tr('tools.grab.originalQuality') : null,
    tab === 'video' ? format.codec : null,
    estimate > 0 ? `≈ ${formatBytes(estimate)}` : null,
    tab === 'video' && format.hasAudio === false ? tr('tools.grab.withAudio') : null,
    tab === 'video' && format.compatible === false ? tr('tools.grab.maybeIncompatible') : null,
  ].filter(Boolean);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.format,
        { backgroundColor: selected ? colors.primarySoft : colors.surfaceAlt, borderColor: selected ? colors.primary : 'transparent', opacity: pressed ? 0.85 : 1 },
      ]}>
      <Icon name={tab === 'video' ? 'movie' : 'music_note'} size={20} color={selected ? colors.primary : colors.textMuted} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" color={selected ? colors.primaryContent : undefined}>
          {format.label}
        </Text>
        <Text variant="caption" muted>
          {details.join(' · ')}
        </Text>
      </View>
      {selected && <Icon name="check" size={20} color={colors.primary} />}
    </Pressable>
  );
}

function EntryRow({
  entry,
  onPress,
  trailing,
  trailingColor,
  small,
}: {
  entry: GrabEntry;
  onPress: () => void;
  trailing: 'chevron_right' | 'check_box' | 'check_box_outline_blank';
  trailingColor?: string;
  small?: boolean;
}) {
  const colors = useColors();
  const thumb = small ? styles.smallThumb : styles.resultThumb;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.result, { opacity: pressed ? 0.7 : 1 }]}>
      {entry.thumbnail ? (
        <Image source={{ uri: entry.thumbnail }} style={thumb} contentFit="cover" transition={120} />
      ) : (
        <View style={[thumb, styles.thumbEmpty, { backgroundColor: colors.surfaceAlt }]}>
          <Icon name="movie" size={16} color={colors.textMuted} />
        </View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" numberOfLines={2}>
          {entry.title}
        </Text>
        <Text variant="caption" muted numberOfLines={1}>
          {[entry.uploader, entry.duration > 0 ? formatDuration(entry.duration * 1000) : null].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Icon name={trailing} size={20} color={trailingColor ?? colors.textWeak} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  form: { borderRadius: radius.lg, padding: space.lg, gap: space.md },
  input: { height: 46, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 15 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  warning: { flexDirection: 'row', gap: space.md, borderRadius: radius.lg, padding: space.lg },
  card: { borderRadius: radius.lg, padding: space.lg, gap: space.md },
  media: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  thumb: { width: 108, height: 62, borderRadius: radius.md, backgroundColor: '#00000010' },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', gap: space.sm },
  wrap: { flexWrap: 'wrap' },
  result: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  resultThumb: { width: 80, height: 45, borderRadius: radius.md, backgroundColor: '#00000010' },
  smallThumb: { width: 64, height: 36, borderRadius: radius.md, backgroundColor: '#00000010' },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  formats: { gap: space.sm },
  format: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 52,
  },
  hint: { textAlign: 'center', paddingHorizontal: space.lg },
});
