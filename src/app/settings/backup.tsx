import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useT } from '@/i18n';
import { backupErrorMessage, exportBackup, importBackup } from '@/lib/backup-io';
import { logError } from '@/lib/errorlog';
import { radius, space, useColors } from '@/theme';

/** Backup e restauração: playlists, curtidas, histórico, ajustes, edições e letras num arquivo JSON. */
export default function BackupScreen() {
  const tr = useT();
  const colors = useColors();
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);

  const run = async (kind: 'export' | 'import') => {
    setBusy(kind);
    try {
      if (kind === 'export') {
        await exportBackup();
      } else {
        const summary = await importBackup();
        if (summary) Alert.alert(tr('common.done'), summary);
      }
    } catch (e) {
      logError(kind === 'export' ? 'Backup: exportar' : 'Backup: restaurar', e);
      Alert.alert(kind === 'export' ? tr('settings.backupFailed') : tr('settings.restoreFailed'), backupErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
          <Icon name="cloud_upload" size={28} color={colors.primary} />
        </View>
        <Text variant="heading">{tr('settings.backupMake')}</Text>
        <Text muted>{tr('settings.backupMakeHint')}</Text>
        <Button label={busy === 'export' ? tr('settings.backupMaking') : tr('settings.backupMake')} icon="download" onPress={() => run('export')} disabled={busy !== null} />
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
          <Icon name="settings_backup_restore" size={28} color={colors.primary} />
        </View>
        <Text variant="heading">{tr('settings.backupRestore')}</Text>
        <Text muted>{tr('settings.backupRestoreHint')}</Text>
        <Button label={busy === 'import' ? tr('settings.backupRestoring') : tr('settings.backupChoose')} icon="upload_file" variant="tonal" onPress={() => run('import')} disabled={busy !== null} />
      </View>

      <Text variant="caption" muted style={styles.note}>
        {tr('settings.backupNote')}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.md, gap: space.md, paddingBottom: space.xxl },
  card: { borderRadius: radius.lg, padding: space.lg, gap: space.md, alignItems: 'flex-start' },
  icon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  note: { paddingHorizontal: space.sm },
});
