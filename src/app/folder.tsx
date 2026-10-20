import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { TrackListScreen } from '@/components/TrackListScreen';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/misc';
import { localPath, useT } from '@/i18n';

import { useLibrary } from '@/store/library';
import { radius, useColors } from '@/theme';

export default function FolderScreen() {
  const tr = useT();
  const { path } = useLocalSearchParams<{ path: string }>();
  const colors = useColors();
  const folder = useLibrary((s) => s.index.folderByPath.get(path));
  if (!folder) return <EmptyState icon="folder_off" title={tr('library.folder.notFound')} />;
  return (
    <TrackListScreen
      title={folder.name}
      subtitle={localPath(folder.path)}
      select={{ source: 'folder', id: folder.path }}
      tracks={folder.tracks}
      coverNode={
        <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
          <Icon name="folder" size={56} color={colors.primary} />
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  icon: { width: 120, height: 120, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
});
