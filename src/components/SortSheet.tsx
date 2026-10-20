import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { Chip, ListItem } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { useT, type StringKey } from '@/i18n';
import { useSettings } from '@/store/settings';
import { space, useColors } from '@/theme';

export type SortTab = 'songs' | 'albums' | 'artists' | 'folders' | 'videos';

const OPTIONS: Record<SortTab, { key: string; label: StringKey }[]> = {
  songs: [
    { key: 'recent', label: 'library.sort.dateAdded' },
    { key: 'title', label: 'library.sort.title' },
    { key: 'artist', label: 'library.sort.artist' },
    { key: 'album', label: 'library.sort.album' },
    { key: 'duration', label: 'library.sort.duration' },
    { key: 'size', label: 'library.sort.fileSize' },
  ],
  albums: [
    { key: 'name', label: 'library.sort.albumName' },
    { key: 'artist', label: 'library.sort.artist' },
    { key: 'year', label: 'library.sort.year' },
    { key: 'count', label: 'library.sort.songCount' },
  ],
  artists: [
    { key: 'name', label: 'library.sort.artistName' },
    { key: 'count', label: 'library.sort.songCount' },
  ],
  folders: [
    { key: 'name', label: 'library.sort.folderName' },
    { key: 'count', label: 'library.sort.songCount' },
  ],
  videos: [
    { key: 'recent', label: 'library.sort.dateAdded' },
    { key: 'name', label: 'library.sort.name' },
    { key: 'duration', label: 'library.sort.duration' },
    { key: 'size', label: 'library.sort.fileSize' },
  ],
};

const FIELD = {
  songs: 'songSort',
  albums: 'albumSort',
  artists: 'artistSort',
  folders: 'folderSort',
  videos: 'videoSort',
} as const;

/** "Ordenar por" de cada aba, com ordem crescente/decrescente. */
export function SortSheet({ tab, visible, onClose }: { tab: SortTab; visible: boolean; onClose: () => void }) {
  const tr = useT();
  const colors = useColors();
  const field = FIELD[tab];
  const sort = useSettings((s) => s[field]) as { key: string; desc: boolean };
  const update = (patch: Partial<{ key: string; desc: boolean }>) =>
    useSettings.getState().set({ [field]: { ...sort, ...patch } } as never);

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.head}>
        <Text variant="heading" style={{ flex: 1 }}>
          {tr('common.sort')}
        </Text>
        <Chip label={tr('library.sort.asc')} icon="arrow_upward" selected={!sort.desc} onPress={() => update({ desc: false })} />
        <Chip label={tr('library.sort.desc')} icon="arrow_downward" selected={sort.desc} onPress={() => update({ desc: true })} />
      </View>
      {OPTIONS[tab].map((o) => (
        <ListItem
          key={o.key}
          title={tr(o.label)}
          onPress={() => {
            update({ key: o.key });
            onClose();
          }}
          right={sort.key === o.key ? <Icon name="check" color={colors.primary} /> : undefined}
        />
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm },
});
