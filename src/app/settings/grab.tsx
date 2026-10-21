import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import {
  grabUpdateCheck,
  grabUpdateInstall,
  grabUpdateRollback,
  grabUpdateStatus,
  type GrabUpdateInfo,
} from '@/lib/grab-updater';
import { radius, space, useColors } from '@/theme';

type Busy = 'loading' | 'checking' | 'installing' | 'rollingBack' | null;

const VERSION_LABELS: { key: string; label: string }[] = [
  { key: 'yt-dlp', label: 'yt-dlp' },
  { key: 'yt-dlp-ejs', label: 'yt-dlp-ejs' },
  { key: 'webkit-jsi', label: 'WebKit JSI' },
];

/**
 * Atualização do motor yt-dlp no iPhone. As wheels vêm do PyPI, são conferidas pelo
 * SHA-256 publicado e ficam em Application Support; a versão do .app continua lá para
 * rollback. A troca só vale depois de fechar e abrir o app.
 */
export default function GrabEngineSettingsScreen() {
  const tr = useT();
  const colors = useColors();
  const [info, setInfo] = useState<GrabUpdateInfo | null>(null);
  const [busy, setBusy] = useState<Busy>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const next = await grabUpdateStatus();
        if (alive) setInfo(next);
      } catch (e) {
        if (alive) setError(errorMessage(e));
      } finally {
        if (alive) setBusy(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const run = async (kind: Exclude<Busy, null>) => {
    setBusy(kind);
    setError(null);
    try {
      const next =
        kind === 'checking'
          ? await grabUpdateCheck(true)
          : kind === 'installing'
            ? await grabUpdateInstall()
            : await grabUpdateRollback();
      if (next) setInfo(next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const checked = info?.checkedAt
    ? new Date(info.checkedAt * 1000).toLocaleString()
    : tr('settings.grabUpdate.never');
  const updating = Boolean(info?.updateAvailable) && !info?.requiresRestart;
  const disabled = busy !== null;

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: tr('settings.grabEngine') }} />

      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Text variant="heading">{tr('settings.grabUpdate.title')}</Text>
        <Text variant="caption" muted>
          {tr('settings.grabUpdate.subtitle')}
        </Text>

        {busy === 'loading' ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <Text variant="caption" muted>
              {tr('settings.grabUpdate.loading')}
            </Text>
          </View>
        ) : (
          <>
            <View style={[styles.status, { backgroundColor: updating || info?.requiresRestart ? colors.primarySoft : colors.surfaceAlt }]}>
              <Text variant="label" color={updating || info?.requiresRestart ? colors.primaryContent : colors.text}>
                {info?.rolledBack && info.requiresRestart
                  ? tr('settings.grabUpdate.restored')
                  : info?.requiresRestart
                    ? tr('settings.grabUpdate.readyTitle')
                    : updating
                      ? tr('settings.grabUpdate.available')
                      : tr('settings.grabUpdate.upToDate')}
              </Text>
              <Text variant="caption" muted>
                {info?.checkedAt && info.online === false
                  ? tr('settings.grabUpdate.offline')
                  : tr('settings.grabUpdate.checkedAt', { when: checked })}
              </Text>
            </View>

            <View style={styles.versions}>
              {VERSION_LABELS.map((row) => {
                const current = info?.current[row.key] || '—';
                const next = info?.updates[row.key];
                return (
                  <View key={row.key} style={styles.versionRow}>
                    <Text variant="caption" muted>
                      {row.label}
                    </Text>
                    <Text variant="caption">
                      {current}
                      {next ? `  →  ${next}` : ''}
                    </Text>
                  </View>
                );
              })}
            </View>

            {info?.message ? (
              <Text variant="caption" muted>
                {info.message}
              </Text>
            ) : null}

            {info?.requiresRestart ? (
              <View style={[styles.notice, { borderColor: colors.border }]}>
                <Text variant="caption">{tr('settings.grabUpdate.restart')}</Text>
              </View>
            ) : null}

            {error ? (
              <Text variant="caption" color={colors.danger}>
                {error}
              </Text>
            ) : null}

            <View style={styles.actions}>
              <Button
                label={busy === 'checking' ? tr('settings.grabUpdate.checking') : tr('settings.grabUpdate.check')}
                icon="refresh"
                variant="tonal"
                onPress={() => void run('checking')}
                disabled={disabled}
              />
              {updating && (
                <Button
                  label={busy === 'installing' ? tr('settings.grabUpdate.updating') : tr('settings.grabUpdate.update')}
                  icon="system_update"
                  onPress={() => void run('installing')}
                  disabled={disabled}
                />
              )}
              {info?.active ? (
                <Button
                  label={busy === 'rollingBack' ? tr('settings.grabUpdate.rollingBack') : tr('settings.grabUpdate.rollback')}
                  icon="undo"
                  variant="outline"
                  onPress={() => void run('rollingBack')}
                  disabled={disabled}
                />
              ) : null}
            </View>
          </>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Text variant="label">{tr('settings.grabUpdate.howTitle')}</Text>
        <Text variant="caption" muted>
          {tr('settings.grabUpdate.how')}
        </Text>
        <Text variant="caption" muted>
          {tr('settings.grabUpdate.auto')}
        </Text>
        <Text variant="caption" muted>
          {tr('settings.grabUpdate.sha')}
        </Text>
        {info?.active ? (
          <Text variant="caption" muted>
            {tr('settings.grabUpdate.active', { path: info.active })}
          </Text>
        ) : null}
        {info?.previous ? (
          <Text variant="caption" muted>
            {tr('settings.grabUpdate.previous', { path: info.previous })}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.md, gap: space.md, paddingBottom: space.xxl },
  card: { borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  loading: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
  status: { borderRadius: radius.md, padding: space.md, gap: 2, marginTop: space.sm },
  versions: { gap: space.xs, marginTop: space.xs },
  versionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  notice: { borderWidth: 1, borderRadius: radius.md, padding: space.md, marginTop: space.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
});

