import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { Artwork } from '@/components/Artwork';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/misc';
import { Text } from '@/components/ui/Text';
import { useT, type Translator } from '@/i18n';
import RitmoCore from '@/modules/ritmo-core';
import { logError } from '@/lib/errorlog';
import type { Track } from '@/lib/library';
import { deleteForever, restoreTracks } from '@/lib/media-actions';
import { space } from '@/theme';

type TrashedTrack = Track & { expiresAt?: number | null };

function daysLeft(tr: Translator, expiresAt: number | null | undefined, now: number): string {
  if (!expiresAt) return '';
  const days = Math.max(0, Math.ceil((expiresAt - now) / 86_400_000));
  return days <= 1 ? tr('settings.trashTomorrow') : tr('settings.trashDays', { n: days });
}

/** Excluídos recentemente (AudioTrashFragment do Lark), usando a lixeira do Android 11+. */
export default function TrashScreen() {
  const tr = useT();
  const [items, setItems] = useState<TrashedTrack[] | null>(null);
  const [now, setNow] = useState(0);

  const load = useCallback(() => {
    RitmoCore.queryTrashed()
      .then((list) => {
        setNow(Date.now());
        setItems([...list].sort((a, b) => (a.expiresAt ?? 0) - (b.expiresAt ?? 0)));
      })
      .catch((e) => {
        logError('Excluídos recentemente', e);
        setItems([]);
      });
  }, []);
  useEffect(load, [load]);

  if (!RitmoCore.supportsTrash()) {
    return <EmptyState icon="delete" title={tr('settings.trashUnavailable')} message={tr('settings.trashUnavailableHint')} />;
  }
  if (items === null) return null;

  return (
    <FlatList
      data={items}
      keyExtractor={(t) => t.id}
      contentContainerStyle={{ flexGrow: 1, paddingBottom: space.xl }}
      ListHeaderComponent={
        items.length > 0 ? (
          <View style={styles.header}>
            <Text variant="caption" muted style={{ flex: 1 }}>
              {tr('settings.trashNote')}
            </Text>
            <Button label={tr('settings.restoreAll')} compact variant="tonal" onPress={async () => (await restoreTracks(items.map((t) => t.id))) && load()} />
          </View>
        ) : undefined
      }
      ListEmptyComponent={<EmptyState icon="delete" title={tr('settings.trashEmpty')} message={tr('settings.trashEmptyHint')} />}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <Artwork track={item} size={44} radius={6} />
          <View style={{ flex: 1 }}>
            <Text variant="label" numberOfLines={1}>
              {item.title}
            </Text>
            <Text variant="caption" muted numberOfLines={1}>
              {item.artist ?? tr('common.unknownArtist')} · {daysLeft(tr, item.expiresAt, now)}
            </Text>
          </View>
          <Button label={tr('settings.restore')} compact variant="tonal" onPress={async () => (await restoreTracks([item.id])) && load()} />
          <Button label={tr('common.delete')} compact variant="ghost" onPress={async () => (await deleteForever([item.id])) && load()} />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.lg, paddingRight: space.sm, paddingVertical: space.sm },
});
