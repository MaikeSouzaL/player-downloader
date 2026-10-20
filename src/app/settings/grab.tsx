import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useT } from '@/i18n';
import { flushErrorReports } from '@/lib/error-report';
import { watchGrabQueue } from '@/lib/grab-queue';
import { errorMessage } from '@/lib/errors';
import { DEFAULT_SERVER, normalizeServer, testServer, updateServer } from '@/lib/grabber';
import { useErrorReports } from '@/store/errorReports';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { radius, space, useColors } from '@/theme';

type TestState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'ok'; text: string; warn?: boolean; autoUpdate?: boolean } | { kind: 'error'; text: string };

/** Ajustes › Servidor de downloads: endereço do PC/VPS que roda o yt-dlp. */
export default function GrabSettingsScreen() {
  const tr = useT();
  const colors = useColors();
  const saved = useSettings((s) => s.grabServer);
  const savedKey = useSettings((s) => s.grabKey);
  const reportErrors = useSettings((s) => s.reportErrors);
  const pendingReports = useErrorReports((s) => s.pending.length);
  const [server, setServer] = useState(saved);
  const [key, setKey] = useState(savedKey);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [updating, setUpdating] = useState(false);
  // Endereço em branco vale como o servidor que já vem no app (quando o build tem um).
  const hasServer = !!server.trim() || !!DEFAULT_SERVER;

  const runTest = async () => {
    setTest({ kind: 'busy' });
    try {
      const result = await testServer(server, key);
      setTest({
        kind: 'ok',
        text: result.ffmpeg ? tr('tools.grab.testOk', { version: result.ytdlp }) : tr('tools.grab.testNoFfmpeg'),
        warn: !result.ffmpeg,
        autoUpdate: result.autoUpdate,
      });
    } catch (e) {
      setTest({ kind: 'error', text: errorMessage(e) });
    }
  };

  /** Atualiza o yt-dlp do servidor agora (quando um site parou de funcionar). */
  const runUpdate = async () => {
    setUpdating(true);
    try {
      const result = await updateServer(server, key);
      useUi.getState().showToast(result.updated ? tr('tools.grab.updated', { version: result.ytdlp }) : tr('tools.grab.upToDate', { version: result.ytdlp }));
      setTest({ kind: 'ok', text: tr('tools.grab.testOk', { version: result.ytdlp }), autoUpdate: true });
    } catch (e) {
      setTest({ kind: 'error', text: errorMessage(e) });
    } finally {
      setUpdating(false);
    }
  };

  const save = () => {
    useSettings.getState().set({ grabServer: normalizeServer(server), grabKey: key.trim() });
    useUi.getState().showToast(tr('tools.grab.saved'));
    // O que estava na fila do servidor volta a ser acompanhado (e os erros pendentes são enviados).
    watchGrabQueue();
    void flushErrorReports();
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  };

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: tr('tools.grab.server') }} />

      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Text variant="caption" muted>
          {DEFAULT_SERVER ? tr('tools.grab.defaultServer', { server: DEFAULT_SERVER }) : tr('tools.grab.hint')}
        </Text>

        <Text variant="label">{tr('tools.grab.serverLabel')}</Text>
        <TextInput
          value={server}
          onChangeText={(value) => {
            setServer(value);
            setTest({ kind: 'idle' });
          }}
          placeholder={DEFAULT_SERVER || tr('tools.grab.serverPlaceholder')}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceAlt }]}
        />

        <Text variant="label">{tr('tools.grab.keyLabel')}</Text>
        <TextInput
          value={key}
          onChangeText={(value) => {
            setKey(value);
            setTest({ kind: 'idle' });
          }}
          placeholder={tr('tools.grab.keyPlaceholder')}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceAlt }]}
        />

        {test.kind === 'busy' && (
          <View style={styles.row}>
            <ActivityIndicator color={colors.primary} />
            <Text muted>{tr('tools.grab.testing')}</Text>
          </View>
        )}
        {test.kind === 'ok' && (
          <View style={styles.row}>
            <Icon name="check_circle" size={20} color={test.warn ? colors.danger : colors.primary} />
            <Text color={test.warn ? colors.danger : colors.primary} style={{ flex: 1 }}>
              {test.text}
            </Text>
          </View>
        )}
        {test.kind === 'ok' && test.autoUpdate && (
          <Text variant="caption" muted>
            {tr('tools.grab.autoUpdate')}
          </Text>
        )}
        {updating && (
          <View style={styles.row}>
            <ActivityIndicator color={colors.primary} />
            <Text muted>{tr('tools.grab.updating')}</Text>
          </View>
        )}
        {test.kind === 'error' && (
          <View style={styles.row}>
            <Icon name="error" size={20} color={colors.danger} />
            <Text color={colors.danger} style={{ flex: 1 }}>
              {test.text}
            </Text>
          </View>
        )}

        <View style={styles.actions}>
          <Button label={tr('tools.grab.test')} variant="outline" icon="wifi" onPress={runTest} disabled={!hasServer || test.kind === 'busy'} />
          <Button label={tr('tools.grab.save')} icon="check" onPress={save} disabled={!hasServer} />
          <Button label={tr('tools.grab.update')} variant="ghost" icon="refresh" onPress={runUpdate} disabled={!hasServer || updating || test.kind === 'busy'} />
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <View style={styles.switchRow}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="label">{tr('tools.grab.reportErrors')}</Text>
            <Text variant="caption" muted>
              {tr('tools.grab.reportErrorsHint')}
            </Text>
          </View>
          <Switch
            value={reportErrors}
            onValueChange={(value) => {
              useSettings.getState().set({ reportErrors: value });
              if (value) void flushErrorReports();
            }}
            accessibilityLabel={tr('tools.grab.reportErrors')}
          />
        </View>
        {reportErrors && pendingReports > 0 && (
          <Text variant="caption" muted>
            {tr.n('tools.grab.reportPending', pendingReports)}
          </Text>
        )}
      </View>

      <Text variant="caption" muted style={styles.legal}>
        {tr('tools.grab.legal')}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.md, gap: space.md, paddingBottom: space.xxl },
  card: { borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  input: { height: 46, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 15, marginBottom: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  legal: { textAlign: 'center', paddingHorizontal: space.lg },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
