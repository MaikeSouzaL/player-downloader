import { shareAsync } from 'expo-sharing';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/misc';
import { Text } from '@/components/ui/Text';
import { useT } from '@/i18n';
import { clearErrorLog, errorLogForSharing, readErrorLog } from '@/lib/errorlog';
import { useUi } from '@/store/ui';
import { radius, space, useColors } from '@/theme';

/** Ver, compartilhar e limpar o registro de erros. */
export default function ErrorLogScreen() {
  const tr = useT();
  const colors = useColors();
  const [text, setText] = useState<string | null>(null);

  const load = useCallback(() => {
    readErrorLog().then(setText);
  }, []);
  useEffect(load, [load]);

  const share = async () => {
    const uri = await errorLogForSharing();
    if (uri) await shareAsync(uri, { mimeType: 'text/plain', dialogTitle: tr('settings.errorsShareTitle') });
  };

  if (text === null) return null;
  if (!text.trim()) {
    return <EmptyState icon="check_circle" title={tr('settings.errorsEmpty')} message={tr('settings.errorsEmptyHint')} />;
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.actions}>
        <Button label={tr('settings.share')} icon="share" compact onPress={share} />
        <Button
          label={tr('settings.clear')}
          icon="delete"
          variant="ghost"
          compact
          onPress={async () => {
            await clearErrorLog();
            useUi.getState().showToast(tr('settings.errorsCleared'));
            load();
          }}
        />
      </View>
      <ScrollView style={[styles.box, { backgroundColor: colors.surface }]} contentContainerStyle={{ padding: space.md }}>
        <Text variant="caption" selectable style={styles.mono}>
          {text}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: space.sm, padding: space.md },
  box: { flex: 1, marginHorizontal: space.md, marginBottom: space.md, borderRadius: radius.lg },
  mono: { fontFamily: 'monospace', fontSize: 11, lineHeight: 15 },
});
