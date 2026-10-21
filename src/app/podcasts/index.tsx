import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { PodcastCover } from '@/components/PodcastCover';
import { Button, IconButton } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/misc';
import { Text } from '@/components/ui/Text';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { subscribe } from '@/lib/podcasts';
import { usePodcasts } from '@/store/podcasts';
import { radius, space, useColors } from '@/theme';

/** Podcasts assinados pelo link do feed RSS. */
export default function PodcastsScreen() {
  const tr = useT();
  const colors = useColors();
  const podcasts = usePodcasts((s) => s.podcasts);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const id = await subscribe(url);
      haptic('done');
      setUrl('');
      setAdding(false);
      router.push({ pathname: '/podcasts/[id]', params: { id } });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const form = (
    <View style={[styles.form, { backgroundColor: colors.surface }]}>
      <Text variant="label">{tr('extras.podcast.feedUrl')}</Text>
      <TextInput
        value={url}
        onChangeText={(value) => {
          setUrl(value);
          setError(null);
        }}
        placeholder={tr('extras.podcast.feedPlaceholder')}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="go"
        onSubmitEditing={add}
        autoFocus
        style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceAlt }]}
      />
      <Text variant="caption" muted>
        {tr('extras.podcast.feedHint')}
      </Text>
      {error && (
        <Text variant="caption" color={colors.danger}>
          {error}
        </Text>
      )}
      <View style={styles.formButtons}>
        {busy ? (
          <View style={styles.busy}>
            <ActivityIndicator color={colors.primary} />
            <Text variant="caption" muted>
              {tr('extras.podcast.adding')}
            </Text>
          </View>
        ) : (
          <>
            <Button label={tr('extras.podcast.add')} icon="add" onPress={add} disabled={!url.trim()} />
            <Button label={tr('common.cancel')} variant="ghost" onPress={() => setAdding(false)} />
          </>
        )}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ headerRight: () => <IconButton icon="add" label={tr('extras.podcast.add')} onPress={() => setAdding(true)} /> }} />
      <FlatList
        data={podcasts}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        ListHeaderComponent={adding ? form : undefined}
        ListEmptyComponent={
          adding ? undefined : (
            <EmptyState icon="podcasts" title={tr('extras.podcast.empty')} action={<Button label={tr('extras.podcast.add')} icon="add" onPress={() => setAdding(true)} />} />
          )
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/podcasts/[id]', params: { id: item.id } })}
            android_ripple={{ color: colors.ripple }}
            accessibilityRole="button"
            style={[styles.row, { backgroundColor: colors.surface }]}>
            <PodcastCover uri={item.image} size={56} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="heading" numberOfLines={2}>
                {item.title}
              </Text>
              <Text variant="caption" muted numberOfLines={1}>
                {[item.author, tr.n('extras.podcast.episodes', item.episodes.length)].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Icon name="chevron_right" size={22} color={colors.textWeak} />
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.md, gap: space.sm, flexGrow: 1 },
  form: { borderRadius: radius.lg, padding: space.lg, gap: space.sm, marginBottom: space.sm },
  input: { height: 46, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 15 },
  formButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  busy: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, overflow: 'hidden' },
});
