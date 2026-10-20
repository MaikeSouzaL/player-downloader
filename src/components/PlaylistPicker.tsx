import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { ListItem } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { useT } from '@/i18n';
import { useCollections } from '@/store/collections';
import { useUi } from '@/store/ui';
import { radius, space, useColors } from '@/theme';

/** "Adicionar à Playlist": escolhe uma playlist existente ou cria uma nova com as faixas. */
export function PlaylistPicker() {
  const tr = useT();
  const colors = useColors();
  const tracks = useUi((s) => s.addToPlaylist);
  const playlists = useCollections((s) => s.playlists);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const close = () => {
    setCreating(false);
    setName('');
    useUi.getState().closePicker();
  };

  const ids = (tracks ?? []).map((t) => t.id);
  // Sem faixas = botão "Nova playlist": vai direto para o nome.
  const showForm = creating || tracks?.length === 0;

  const addTo = (id: string, playlistName: string) => {
    const added = useCollections.getState().addToPlaylist(id, ids);
    useUi.getState().showToast(added > 0 ? tr('library.picker.added', { name: playlistName }) : tr('library.picker.already'));
    close();
  };

  const create = () => {
    const playlistName = name.trim() || tr('library.playlist.new');
    useCollections.getState().createPlaylist(playlistName, ids);
    useUi.getState().showToast(
      ids.length > 0 ? tr('library.picker.added', { name: playlistName }) : tr('library.picker.created', { name: playlistName })
    );
    close();
  };

  return (
    <Sheet visible={!!tracks} onClose={close}>
      <Text variant="heading" style={styles.title}>
        {tracks?.length === 0 ? tr('library.playlist.new') : tr('library.addToPlaylist')}
      </Text>
      {showForm ? (
        <View style={styles.create}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={tr('library.picker.namePlaceholder')}
            placeholderTextColor={colors.textWeak}
            autoFocus
            maxLength={60}
            onSubmitEditing={create}
            style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceAlt }]}
          />
          <View style={styles.buttons}>
            <Button label={tr('common.cancel')} variant="ghost" onPress={() => (tracks?.length === 0 ? close() : setCreating(false))} />
            <Button label={tr('library.create')} onPress={create} />
          </View>
        </View>
      ) : (
        <>
          <ListItem icon="add_circle" title={tr('library.playlist.new')} onPress={() => setCreating(true)} />
          {playlists.map((p) => (
            <ListItem key={p.id} icon="queue_music" title={p.name} subtitle={tr.n('common.songs', p.trackIds.length)} onPress={() => addTo(p.id, p.name)} />
          ))}
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  title: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  create: { padding: space.lg, gap: space.lg },
  input: { height: 48, borderRadius: radius.md, paddingHorizontal: space.lg, fontSize: 16 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
});
