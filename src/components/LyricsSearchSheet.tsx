import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { useT, type Translator } from '@/i18n';
import { logError } from '@/lib/errorlog';
import { formatDuration } from '@/lib/format';
import type { Track } from '@/lib/library';
import { findLyrics, LrclibError, type LyricsMatch } from '@/lib/lrclib';
import { parseLyrics } from '@/lib/lrc';
import { radius, space, useColors } from '@/theme';

type SearchError = { code?: 'offline' | 'http' | 'timeout'; status?: number | null; message: string };

/** Sem resposta do LRCLIB nesse tempo, desiste e oferece "Tentar de novo". */
const TIMEOUT_MS = 15_000;
type Search = { key: string; status: 'loading' } | { key: string; status: 'done'; matches: LyricsMatch[] } | { key: string; status: 'error'; error: SearchError };

/** Primeiras linhas da letra, sem os tempos do LRC, para conferir antes de usar. */
function preview(match: LyricsMatch, tr: Translator): string {
  if (match.instrumental && !match.text) return tr('player.search.instrumentalNoLyrics');
  const lines = parseLyrics(match.text).lines.map((l) => l.text).filter(Boolean);
  return lines.slice(0, 8).join('\n') + (lines.length > 8 ? '\n…' : '');
}

/**
 * "Buscar letra" no LRCLIB. Só consulta a internet quando a pessoa abre esta janela;
 * mostra os candidatos e a prévia antes de usar.
 */
export function LyricsSearchSheet({ track, visible, onClose, onPick }: { track: Track; visible: boolean; onClose: () => void; onPick: (text: string) => void }) {
  const colors = useColors();
  const tr = useT();
  const [search, setSearch] = useState<Search | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${track.id}:${attempt}`;

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, TIMEOUT_MS);
    findLyrics({ title: track.title, artist: track.artist, album: track.album, durationMs: track.duration }, undefined, controller.signal)
      .then((matches) => setSearch({ key, status: 'done', matches }))
      .catch((e) => {
        if (timedOut) {
          setSearch({ key, status: 'error', error: { code: 'timeout', message: 'timeout' } });
          return;
        }
        if (controller.signal.aborted) return;
        logError('Buscar letra', e, { id: track.id });
        const error: SearchError =
          e instanceof LrclibError ? { code: e.code, status: e.status, message: e.message } : { message: e instanceof Error ? e.message : String(e) };
        setSearch({ key, status: 'error', error });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [visible, key, track.id, track.title, track.artist, track.album, track.duration]);

  // Resultado de outra música/tentativa ainda não chegou: mostra "buscando".
  const current: Search = search?.key === key ? search : { key, status: 'loading' };

  // A mensagem é escolhida na hora de mostrar (pelo código do erro), para acompanhar o idioma; sem código, vale o texto original.
  const errorMessage = (error: SearchError) =>
    error.code === 'timeout' ? tr('player.search.timeout') : error.code === 'offline' ? tr('player.search.offline') : error.code === 'http' ? tr('player.search.httpError', { status: error.status ?? 0 }) : error.message;

  const retry = () => {
    setChosen(null);
    setAttempt((a) => a + 1);
  };

  // Ao fechar, esquece o resultado: reabrir mostra "Procurando…" e busca de novo.
  const close = () => {
    setSearch(null);
    setChosen(null);
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={close}>
      <View style={styles.head}>
        <Icon name="travel_explore" color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text variant="heading">{tr('player.lyrics.search')}</Text>
          <Text variant="caption" muted numberOfLines={1}>
            {track.title}
            {track.artist ? ` · ${track.artist}` : ''}
          </Text>
        </View>
      </View>
      <Text variant="micro" muted style={styles.note}>
        {tr('player.search.note')}
      </Text>

      {current.status === 'loading' && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <Text muted>{tr('player.search.loading')}</Text>
        </View>
      )}
      {current.status === 'error' && (
        <EmptyState
          icon="cloud_off"
          title={tr('player.search.failed')}
          message={errorMessage(current.error)}
          action={<Button label={tr('common.retry')} variant="tonal" compact onPress={retry} />}
        />
      )}
      {current.status === 'done' && current.matches.length === 0 && (
        <EmptyState
          icon="lyrics"
          title={tr('player.search.none')}
          message={tr('player.search.noneHint')}
        />
      )}
      {current.status === 'done' && current.matches.length > 0 && (
        <FlatList
          nestedScrollEnabled
          data={current.matches.slice(0, 8)}
          keyExtractor={(m) => String(m.id)}
          style={{ maxHeight: 460 }}
          contentContainerStyle={{ paddingBottom: space.lg }}
          renderItem={({ item }) => {
            const open = chosen === item.id;
            return (
              <View style={[styles.item, { borderColor: open ? colors.primary : colors.border }]}>
                <Pressable onPress={() => setChosen(open ? null : item.id)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.itemHead}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="label" numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text variant="caption" muted numberOfLines={1}>
                      {item.artist}
                      {item.album ? ` · ${item.album}` : ''} · {formatDuration(item.durationSec * 1000)}
                    </Text>
                  </View>
                  <View style={[styles.badge, { backgroundColor: item.synced ? colors.primarySoft : colors.surfaceAlt }]}>
                    <Text variant="micro" color={item.synced ? colors.primaryContent : colors.textMuted}>
                      {item.synced ? tr('player.search.synced') : item.instrumental ? tr('player.search.instrumental') : tr('player.search.text')}
                    </Text>
                  </View>
                </Pressable>
                {open && (
                  <View style={styles.preview}>
                    <Text variant="caption" style={{ lineHeight: 20 }}>
                      {preview(item, tr)}
                    </Text>
                    <Button
                      label={tr('player.search.use')}
                      icon="check"
                      compact
                      disabled={!item.text}
                      onPress={() => {
                        onPick(item.text);
                        close();
                      }}
                    />
                  </View>
                )}
              </View>
            );
          }}
        />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingTop: space.lg },
  note: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  center: { alignItems: 'center', gap: space.sm, paddingVertical: space.xl },
  item: { marginHorizontal: space.lg, marginTop: space.sm, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md },
  badge: { borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 },
  preview: { paddingHorizontal: space.md, paddingBottom: space.md, gap: space.md, alignItems: 'flex-start' },
});
