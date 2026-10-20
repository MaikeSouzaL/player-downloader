import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useT } from '@/i18n';
import type { Track } from '@/lib/library';
import { activeLine, parseLyrics, type Lyrics } from '@/lib/lrc';
import { loadLyrics, useLyricsVersion } from '@/lib/lyrics-store';
import { usePlayer } from '@/store/player';
import { space, useColors } from '@/theme';

const LINE_HEIGHT = 44;

/** Letra sincronizada: a linha atual fica destacada e centralizada; tocar numa linha pula para ela. */
export function LyricsView({ track, height }: { track: Track; height: number }) {
  const colors = useColors();
  const tr = useT();
  const [loaded, setLoaded] = useState<{ key: string; lyrics: Lyrics | null } | null>(null);
  const list = useRef<FlatList>(null);
  const position = usePlayer((s) => s.position);
  const seek = usePlayer((s) => s.seek);
  const version = useLyricsVersion((s) => s.version);

  const key = `${track.id}:${version}`;
  useEffect(() => {
    let alive = true;
    loadLyrics(track).then((r) => {
      if (alive) setLoaded({ key, lyrics: r ? parseLyrics(r.text) : null });
    });
    return () => {
      alive = false;
    };
  }, [track, key]);
  const lyrics = loaded?.key === key ? loaded.lyrics : undefined;

  const current = useMemo(() => (lyrics?.synced ? activeLine(lyrics.lines, position + 300) : -1), [lyrics, position]);

  useEffect(() => {
    if (current >= 0) list.current?.scrollToIndex({ index: current, viewPosition: 0.5, animated: true });
  }, [current]);

  if (lyrics === undefined) {
    return (
      <View style={[styles.center, { height }]}>
        <Text muted>{tr('player.lyrics.searching')}</Text>
      </View>
    );
  }

  if (!lyrics || lyrics.lines.length === 0) {
    return (
      <View style={[styles.center, { height, gap: space.lg }]}>
        <Text variant="heading" muted>
          {tr('player.lyrics.noMatch')}
        </Text>
        <Text variant="caption" muted style={{ textAlign: 'center' }}>
          {tr('player.lyrics.noMatchHint')}
        </Text>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button
            label={tr('player.lyrics.search')}
            icon="travel_explore"
            variant="tonal"
            compact
            onPress={() => router.push({ pathname: '/lyrics-edit/[id]', params: { id: track.id, search: '1' } })}
          />
          <Button label={tr('player.lyrics.add')} icon="add" variant="outline" compact onPress={() => router.push({ pathname: '/lyrics-edit/[id]', params: { id: track.id } })} />
        </View>
      </View>
    );
  }

  return (
    <FlatList
      ref={list}
      data={lyrics.lines}
      keyExtractor={(_, i) => String(i)}
      style={{ height }}
      contentContainerStyle={{ paddingVertical: height / 2 - LINE_HEIGHT / 2 }}
      showsVerticalScrollIndicator={false}
      getItemLayout={lyrics.synced ? (_, index) => ({ length: LINE_HEIGHT, offset: LINE_HEIGHT * index, index }) : undefined}
      onScrollToIndexFailed={() => {}}
      renderItem={({ item, index }) => {
        const active = index === current;
        const line = (
          <Text
            variant="heading"
            color={active ? colors.primary : lyrics.synced ? colors.textMuted : colors.text}
            style={[styles.line, lyrics.synced && styles.synced, active && styles.active]}
            numberOfLines={lyrics.synced ? 2 : undefined}>
            {item.text || '♪'}
          </Text>
        );
        return lyrics.synced ? (
          <Pressable onPress={() => seek(item.time)} accessibilityRole="button" accessibilityLabel={tr('player.lyrics.goTo', { text: item.text })}>
            {line}
          </Pressable>
        ) : (
          line
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  line: { textAlign: 'center', textAlignVertical: 'center', paddingHorizontal: space.md },
  // Altura fixa para o scroll até a linha atual ser exato (2 linhas de 22).
  synced: { height: LINE_HEIGHT, lineHeight: 22 },
  active: { fontSize: 18, fontWeight: '700' },
});
