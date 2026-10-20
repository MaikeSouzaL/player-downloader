import { useMemo } from 'react';
import { SectionList, StyleSheet, View } from 'react-native';

import { Artwork } from '@/components/Artwork';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/misc';
import { Text } from '@/components/ui/Text';
import { folderName } from '@/lib/format';
import { localPath, useT } from '@/i18n';
import type { Track } from '@/lib/library';
import { useLibrary } from '@/store/library';
import { useSettings } from '@/store/settings';
import { space, useColors } from '@/theme';

type Row = { kind: 'folder'; path: string } | { kind: 'track'; track: Track };

/** Arquivos ocultos (HiddenFilesHomeFragment do Lark): pastas e músicas escondidas, com "Mostrar". */
export default function HiddenScreen() {
  const tr = useT();
  const colors = useColors();
  const hiddenFolders = useSettings((s) => s.hiddenFolders);
  const hiddenTracks = useSettings((s) => s.hiddenTracks);
  const all = useLibrary((s) => s.allTracks);

  const sections = useMemo(() => {
    const byId = new Map(all.map((t) => [t.id, t]));
    const tracks = hiddenTracks.map((id) => byId.get(id)).filter((t): t is Track => !!t);
    return [
      { key: 'folders' as const, data: hiddenFolders.map((path): Row => ({ kind: 'folder', path })) },
      { key: 'tracks' as const, data: tracks.map((track): Row => ({ kind: 'track', track })) },
    ].filter((s) => s.data.length > 0);
  }, [all, hiddenFolders, hiddenTracks]);

  return (
    <SectionList
      sections={sections}
      keyExtractor={(r) => (r.kind === 'folder' ? r.path : r.track.id)}
      stickySectionHeadersEnabled={false}
      contentContainerStyle={{ paddingBottom: space.xl, flexGrow: 1 }}
      renderSectionHeader={({ section }) => (
        <Text variant="label" muted style={styles.section}>
          {section.key === 'folders' ? tr('settings.hiddenFolders') : tr('settings.hiddenSongs')}
        </Text>
      )}
      ListEmptyComponent={<EmptyState icon="visibility" title={tr('settings.hiddenEmpty')} message={tr('settings.hiddenEmptyHint')} />}
      renderItem={({ item }) => (
        <View style={styles.row}>
          {item.kind === 'folder' ? (
            <View style={[styles.folder, { backgroundColor: colors.surfaceAlt }]}>
              <Icon name="folder" color={colors.textMuted} />
            </View>
          ) : (
            <Artwork track={item.track} size={44} radius={6} />
          )}
          <View style={{ flex: 1 }}>
            <Text variant="label" numberOfLines={1}>
              {item.kind === 'folder' ? folderName(item.path) : item.track.title}
            </Text>
            <Text variant="caption" muted numberOfLines={1}>
              {item.kind === 'folder' ? localPath(item.path) : item.track.artist ?? tr('common.unknownArtist')}
            </Text>
          </View>
          <Button
            label={tr('settings.show')}
            variant="tonal"
            compact
            onPress={() =>
              item.kind === 'folder'
                ? useSettings.getState().toggleHiddenFolder(item.path)
                : useSettings.getState().unhideTrack(item.track.id)
            }
          />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  folder: { width: 44, height: 44, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
});
