import { launchImageLibraryAsync } from 'expo-image-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Artwork } from '@/components/Artwork';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useT } from '@/i18n';
import { logError } from '@/lib/errorlog';
import { errorMessage } from '@/lib/errors';
import { storeCover, useEdits } from '@/store/edits';
import { useLibrary } from '@/store/library';
import { useUi } from '@/store/ui';
import { radius, space, useColors } from '@/theme';

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  const colors = useColors();
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="caption" muted>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textWeak}
        maxLength={200}
        accessibilityLabel={label}
        style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
      />
    </View>
  );
}

/** Editar informações (MediaInfoEditFragment do Lark): só no app, o arquivo de áudio não muda. */
export default function EditTrackScreen() {
  const tr = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const original = useLibrary((s) => s.allTracks.find((t) => t.id === id));
  const current = useEdits((s) => s.edits[id]);
  const [title, setTitle] = useState(current?.title ?? '');
  const [artist, setArtist] = useState(current?.artist ?? '');
  const [album, setAlbum] = useState(current?.album ?? '');
  const [cover, setCover] = useState<string | undefined>(current?.cover);

  if (!original) return null;

  const pickCover = async () => {
    try {
      const result = await launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.85 });
      if (result.canceled || !result.assets?.[0]) return;
      setCover(storeCover(original.id, result.assets[0].uri));
    } catch (e) {
      logError('Escolher capa', e);
      Alert.alert(tr('library.edit.coverFailed'), errorMessage(e));
    }
  };

  const save = () => {
    useEdits.getState().saveEdit(original.id, {
      title: title !== original.title ? title : undefined,
      artist: artist !== (original.artist ?? '') ? artist : undefined,
      album: album !== (original.album ?? '') ? album : undefined,
      cover,
    });
    useUi.getState().showToast(tr('library.edit.saved'));
    router.back();
  };

  const restore = () =>
    Alert.alert(tr('library.edit.restoreTitle'), tr('library.edit.restoreMessage'), [
      { text: tr('common.cancel'), style: 'cancel' },
      {
        text: tr('library.edit.restore'),
        onPress: () => {
          useEdits.getState().clearEdit(original.id);
          useUi.getState().showToast(tr('library.edit.restored'));
          router.back();
        },
      },
    ]);

  return (
    <>
      <Stack.Screen options={{ title: tr('library.editInfo') }} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Pressable onPress={pickCover} accessibilityRole="button" accessibilityLabel={tr('library.edit.changeCover')} style={styles.coverWrap}>
          <Artwork track={{ albumId: original.albumId, uri: original.uri, cover }} size={160} radius={radius.lg} quality="large" />
          <View style={styles.coverBadge}>
            <Icon name="photo_camera" size={18} color="#fff" />
          </View>
        </Pressable>
        {cover && <Button label={tr('library.edit.originalCover')} variant="ghost" compact onPress={() => setCover(undefined)} />}

        <Field label={tr('library.details.title')} value={title} onChange={setTitle} placeholder={original.title} />
        <Field label={tr('library.details.artist')} value={artist} onChange={setArtist} placeholder={original.artist ?? tr('common.unknownArtist')} />
        <Field label={tr('library.details.album')} value={album} onChange={setAlbum} placeholder={original.album ?? tr('common.unknownAlbum')} />

        <Text variant="caption" muted>
          {tr('library.edit.note')}
        </Text>

        <View style={styles.buttons}>
          {current && <Button label={tr('library.edit.restoreOriginal')} variant="ghost" compact onPress={restore} />}
          <View style={{ flex: 1 }} />
          <Button label={tr('common.save')} onPress={save} />
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.lg },
  coverWrap: { alignSelf: 'center' },
  coverBadge: { position: 'absolute', right: 6, bottom: 6, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  input: { height: 48, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.lg, fontSize: 16 },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
