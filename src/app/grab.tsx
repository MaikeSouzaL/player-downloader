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
import { enqueueGrab } from '@/lib/grab-queue';
import { normalizeServer, resolveLink, searchVideos, startJob, type GrabEntry, type GrabFormat, type GrabMedia, type GrabSearchItem } from '@/lib/grabber';
import { useGrabHistory } from '@/store/grabHistory';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { radius, space, useColors } from '@/theme';

type Tab = 'video' | 'audio';

/** Igual ao limite do servidor (RITMO max_batch). */
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

/** Primeira qualidade que toca neste aparelho (no iPhone, evita VP9/AV1 quando há H.264). */
function defaultFormat(media: GrabMedia, tab: Tab): string {
  if (tab === 'audio') return sortFormats(media.audio, 'audio')[0]?.id ?? '';
  const formats = media.formats;
  if (Platform.OS === 'ios') return (formats.find((f) => f.compatible !== false) ?? formats[0])?.id ?? '';
  return formats[0]?.id ?? '';
}

/**
 * "Baixar de um site" (o fluxo do SnapTube): lê o link no servidor do Ritmo, mostra as
 * qualidades de vídeo, os formatos de áudio e as legendas, e manda para a fila do servidor.
 * Playlists: escolhe os vídeos e baixa todos de uma vez.
 */
export default function GrabScreen() {
  const tr = useT();
  const colors = useColors();
  const params = useLocalSearchParams<{ url?: string }>();
  const initial = typeof params.url === 'string' ? params.url : '';
  const recents = useGrabHistory((s) => s.recents);
  // Assina o endereço: salvar o servidor em Ajustes e voltar já libera a tela.
  const server = useSettings((s) => s.grabServer);
  const enabled = /^https?:\/\/[^/]+/i.test(normalizeServer(server));

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
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const read = useCallback(
    async (value?: string, playlist = false) => {
      const target = (value ?? link).trim();
      if (!target || reading) return;
      setReading(true);
      setError(null);
      setMedia(null);
      try {
        const found = await resolveLink(target, playlist);
        if (!alive.current) return;
        if (!playlist) setLink(target);
        setMedia(found);
        useGrabHistory.getState().add({ url: found.url || target, title: found.title, thumbnail: found.thumbnail });
        const first: Tab = found.formats.length ? 'video' : 'audio';
        setTab(first);
        setPicked(defaultFormat(found, first));
        setSubtitle(null);
        setSelected(found.playlist?.entries.slice(0, MAX_BATCH).map((entry) => entry.id) ?? []);
      } catch (e) {
        if (alive.current) setError(errorMessage(e) || tr('tools.grab.unsupported'));
      } finally {
        if (alive.current) setReading(false);
      }
    },
    [link, reading, tr]
  );

  const search = useCallback(async () => {
    const term = query.trim();
    if (term.length < 2 || searching) return;
    setSearching(true);
    setError(null);
    setMedia(null);
    setResults([]);
    setSearched(false);
    try {
      const found = await searchVideos(term);
      if (alive.current) {
        setResults(found.items);
        setSearched(true);
      }
    } catch (e) {
      if (alive.current) setError(errorMessage(e) || tr('tools.grab.failed'));
    } finally {
      if (alive.current) setSearching(false);
    }
  }, [query, searching, tr]);

  const pickResult = (item: GrabSearchItem) => {
    setMode('link');
    setLink(item.url);
    setResults([]);
    void read(item.url);
  };

  const switchMode = (next: 'link' | 'search') => {
    if (next === mode) return;
    setMode(next);
    setError(null);
    if (next === 'search') {
      setMedia(null);
      setResults([]);
      setSearched(false);
    }
  };

  // Link veio do "Compartilhar com o Ritmo" ou do navegador: já lê sozinho (no próximo tick,
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
    if (!media || !picked || sending) return;
    const chosen = isPlaylist ? entries.filter((entry) => selected.includes(entry.id)).map((entry) => entry.id) : undefined;
    if (chosen && chosen.length === 0) {
      setError(tr('tools.grab.pickSome'));
      return;
    }
    if (chosen && chosen.length > MAX_BATCH) {
      setError(tr('tools.grab.batchLimit', { n: MAX_BATCH }));
      return;
    }
    setSending(true);
    setError(null);
    try {
      const started = await startJob(media.token, picked, { subtitles: tab === 'video' ? subtitle : null, entries: chosen });
      enqueueGrab(started, media.title, tab);
      useUi.getState().showToast(tr.n('tools.grab.sent', started.ids.length));
      router.push('/downloads');
    } catch (e) {
      logError('Baixar de um site', e, { site: hostOf(media.url) });
      if (alive.current) setError(errorMessage(e) || tr('tools.grab.failed'));
    } finally {
      if (alive.current) setSending(false);
    }
  };

  const header = <Stack.Screen options={{ title: tr('tools.grab.title'), headerRight: () => <IconButton icon="public" label={tr('tools.grab.openBrowser')} onPress={() => router.push('/browser')} /> }} />;

  if (!enabled) {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <EmptyState
          icon="cloud_download"
          title={tr('tools.grab.server')}
          message={tr('tools.grab.hint')}
          action={<Button label={tr('common.settings')} icon="settings" onPress={() => router.push('/settings/grab')} />}
        />
      </View>
    );
  }

  const formats = sortFormats(tab === 'video' ? (media?.formats ?? []) : (media?.audio ?? []), tab);
  const subtitles = tab === 'video' ? (media?.subtitles ?? []) : [];

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
            <Text muted>{searching ? tr('tools.grab.searching') : tr('tools.grab.reading')}</Text>
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
            <Text style={{ flex: 1 }} color={colors.danger}>
              {error}
            </Text>
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
