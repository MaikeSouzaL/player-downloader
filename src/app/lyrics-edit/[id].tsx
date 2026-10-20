import { getDocumentAsync } from 'expo-document-picker';
import { File } from 'expo-file-system';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { LyricsSearchSheet } from '@/components/LyricsSearchSheet';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useT, type StringKey } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { deleteLyrics, loadLyrics, saveLyrics, type LyricsSource } from '@/lib/lyrics-store';
import { parseLyrics } from '@/lib/lrc';
import { useLibrary } from '@/store/library';
import { useUi } from '@/store/ui';
import { radius, space, useColors } from '@/theme';

const SOURCE_LABEL: Record<LyricsSource, StringKey> = {
  custom: 'player.lyricsEdit.source.custom',
  lrc: 'player.lyricsEdit.source.lrc',
  embedded: 'player.lyricsEdit.source.embedded',
};

/** Adicionar ou editar a letra (LyricsEditFragment do Lark): colar texto/LRC ou importar um arquivo .lrc. */
export default function LyricsEditScreen() {
  const { id, search } = useLocalSearchParams<{ id: string; search?: string }>();
  const colors = useColors();
  const tr = useT();
  const track = useLibrary((s) => s.index.byId.get(id) ?? s.allTracks.find((t) => t.id === id));
  const [text, setText] = useState('');
  const [source, setSource] = useState<LyricsSource | null>(null);
  const [searching, setSearching] = useState(search === '1');

  const trackId = track?.id;
  useEffect(() => {
    const current = trackId ? useLibrary.getState().index.byId.get(trackId) ?? useLibrary.getState().allTracks.find((t) => t.id === trackId) : undefined;
    if (!current) return;
    let alive = true;
    loadLyrics(current)
      .then((r) => {
        if (!alive) return;
        setText(r?.text ?? '');
        setSource(r?.source ?? null);
      })
      .catch(() => {
        if (alive) setSource(null);
      });
    return () => {
      alive = false;
    };
  }, [trackId]);

  if (!track) return null;

  const importFile = async () => {
    const result = await getDocumentAsync({ type: ['text/*', 'application/octet-stream', '*/*'], copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    try {
      setText(await new File(result.assets[0].uri).text());
    } catch (e) {
      Alert.alert(tr('player.lyricsEdit.readError'), errorMessage(e));
    }
  };

  const save = async () => {
    await saveLyrics(track.id, text);
    useUi.getState().showToast(parseLyrics(text).synced ? tr('player.lyricsEdit.savedSynced') : tr('player.lyricsEdit.updated'));
    router.back();
  };

  const synced = text.trim() ? parseLyrics(text).synced : false;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: tr('player.lyrics.title') }} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text variant="heading" numberOfLines={1}>
          {track.title}
        </Text>
        <Text variant="caption" muted>
          {source ? tr(SOURCE_LABEL[source]) : tr('player.lyricsEdit.none')}
          {text.trim() ? ` · ${synced ? tr('player.lyricsEdit.synced') : tr('player.lyricsEdit.plain')}` : ''}
        </Text>
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          placeholder={tr('player.lyricsEdit.placeholder')}
          placeholderTextColor={colors.textWeak}
          textAlignVertical="top"
          style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
        />
        <View style={styles.buttons}>
          <Button label={tr('player.lyrics.search')} icon="travel_explore" variant="tonal" compact onPress={() => setSearching(true)} />
          <Button label={tr('player.lyricsEdit.import')} icon="upload_file" variant="outline" compact onPress={importFile} />
          {source === 'custom' && (
            <Button
              label={tr('common.remove')}
              icon="delete"
              variant="ghost"
              compact
              onPress={() => {
                deleteLyrics(track.id);
                useUi.getState().showToast(tr('player.lyricsEdit.removed'));
                router.back();
              }}
            />
          )}
          <View style={{ flex: 1 }} />
          <Button label={tr('common.save')} compact onPress={save} disabled={!text.trim()} />
        </View>
      </ScrollView>
      <LyricsSearchSheet
        track={track}
        visible={searching}
        onClose={() => setSearching(false)}
        onPick={(found) => {
          setText(found);
          useUi.getState().showToast(tr('player.lyricsEdit.found'));
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.md },
  input: { minHeight: 320, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.lg, fontSize: 15, lineHeight: 22 },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
});
