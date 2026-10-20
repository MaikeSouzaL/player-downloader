import { router } from 'expo-router';
import { useMemo } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { IconButton } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/misc';
import { Text } from '@/components/ui/Text';
import { localPath, useT } from '@/i18n';

import { sortFolders } from '@/lib/library';
import { useLibrary } from '@/store/library';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { radius, space, useColors } from '@/theme';

export function FoldersTab() {
  const tr = useT();
  const colors = useColors();
  const all = useLibrary((s) => s.index.folders);
  const sort = useSettings((s) => s.folderSort);
  const folders = useMemo(() => sortFolders(all, sort), [all, sort]);

  const hide = (path: string, name: string) =>
    Alert.alert(tr('library.folders.hideTitle', { name }), tr('library.folders.hideMessage'), [
      { text: tr('common.cancel'), style: 'cancel' },
      {
        text: tr('library.hide'),
        onPress: () => {
          useSettings.getState().toggleHiddenFolder(path);
          useUi.getState().showToast(tr('library.folders.hiddenToast'));
        },
      },
    ]);

  return (
    <FlatList
      data={folders}
      keyExtractor={(f) => f.path}
      ListEmptyComponent={<EmptyState icon="folder_off" title={tr('library.folders.empty')} />}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => router.push({ pathname: '/folder', params: { path: item.path } })}
          onLongPress={() => hide(item.path, item.name)}
          android_ripple={{ color: colors.ripple }}
          accessibilityRole="button"
          style={styles.row}>
          <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
            <Icon name="folder" size={28} color={colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="heading" numberOfLines={1}>
              {item.name}
            </Text>
            <Text variant="caption" muted numberOfLines={1}>
              {tr.n('common.songs', item.tracks.length)} · {localPath(item.path)}
            </Text>
          </View>
          <IconButton icon="visibility_off" label={tr('library.folders.hideLabel', { name: item.name })} color={colors.textWeak} size={20} onPress={() => hide(item.path, item.name)} />
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: space.lg, paddingRight: space.xs, height: 72 },
  icon: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
