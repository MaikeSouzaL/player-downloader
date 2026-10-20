import * as LocalAuthentication from 'expo-local-authentication';
import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Switch, View } from 'react-native';

import { PinPad } from '@/components/PinPad';
import { Button, IconButton } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/misc';
import { Text } from '@/components/ui/Text';
import { t, useT } from '@/i18n';
import { logError } from '@/lib/errorlog';
import { errorMessage } from '@/lib/errors';
import { formatBytes, formatDuration } from '@/lib/format';
import { isValidPin } from '@/lib/pin';
import { restoreFromVault, vaultTrack } from '@/lib/vault';
import RitmoCore, { type VaultItem } from '@/modules/ritmo-core';
import { useExternalTracks } from '@/store/external-tracks';
import { usePlayer } from '@/store/player';
import { useVault } from '@/store/vault';
import { radius, space, useColors } from '@/theme';

/** Pasta privada (cofre do SnapTube): PIN + digital/Face ID; os arquivos ficam fora da biblioteca e da galeria. */
export default function VaultScreen() {
  const tr = useT();
  const configured = useVault((s) => !!s.pinHash);
  const unlocked = useVault((s) => s.unlocked);
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title: tr('tools.vault.title'),
          headerRight: unlocked ? () => <IconButton icon="lock" label={tr('tools.vault.lockNow')} onPress={() => useVault.getState().lock()} /> : undefined,
        }}
      />
      {!configured ? <Setup /> : !unlocked ? <Unlock /> : <Contents />}
    </View>
  );
}

function Setup() {
  const tr = useT();
  const colors = useColors();
  const [first, setFirst] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const confirming = first !== '';

  const submit = () => {
    if (!isValidPin(pin)) return;
    if (!confirming) {
      setFirst(pin);
      setPin('');
      setError('');
      return;
    }
    if (pin !== first) {
      setFirst('');
      setPin('');
      setError(tr('tools.vault.mismatch'));
      return;
    }
    useVault.getState().setPin(pin);
  };

  return (
    <View style={styles.center}>
      <Icon name="lock" size={40} />
      <Text variant="heading">{tr(confirming ? 'tools.vault.confirmPin' : 'tools.vault.createPin')}</Text>
      <Text muted style={styles.text}>
        {tr('tools.vault.setupText')}
      </Text>
      {!!error && <Text color={colors.danger}>{error}</Text>}
      <PinPad value={pin} onChange={setPin} onSubmit={submit} />
    </View>
  );
}

function Unlock() {
  const tr = useT();
  const colors = useColors();
  const biometrics = useVault((s) => s.biometrics);
  const lockedUntil = useVault((s) => s.lockedUntil);
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const waiting = lockedUntil > now;

  // Contagem regressiva do bloqueio por tentativas.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waiting]);

  // Sem depender do `tr` (muda a cada render): senão a digital seria pedida de novo a cada atualização.
  const tryBiometrics = useCallback(async () => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: t('tools.vault.biometricPrompt'),
        cancelLabel: t('common.cancel'),
        disableDeviceFallback: true,
      });
      if (result.success) useVault.getState().unlock();
    } catch (e) {
      logError('Pasta privada: biometria', e);
    }
  }, []);

  useEffect(() => {
    if (biometrics) void tryBiometrics();
  }, [biometrics, tryBiometrics]);

  const submit = () => {
    const result = useVault.getState().tryPin(pin);
    setPin('');
    setNow(Date.now());
    if (result === 'wrong') setMessage(tr('tools.vault.wrongPin'));
    else if (result === 'locked') setMessage('');
  };

  const forgot = () =>
    Alert.alert(tr('tools.vault.forgotTitle'), tr('tools.vault.forgotText'), [
      { text: tr('common.cancel'), style: 'cancel' },
      {
        text: tr('tools.vault.forgotConfirm'),
        style: 'destructive',
        onPress: async () => {
          // Só zera o PIN se tudo foi apagado: senão um PIN novo abriria o que sobrou.
          try {
            // Apaga a pasta inteira (funciona até com o índice estragado).
            await RitmoCore.vaultWipe();
            useVault.getState().reset();
          } catch (e) {
            logError('Pasta privada: apagar tudo', e);
            Alert.alert(tr('tools.vault.forgotFailed'), errorMessage(e));
          }
        },
      },
    ]);

  return (
    <View style={styles.center}>
      <Icon name="lock" size={40} />
      <Text variant="heading">{tr('tools.vault.enterPin')}</Text>
      {waiting ? (
        <Text color={colors.danger}>{tr('tools.vault.wait', { n: Math.ceil((lockedUntil - now) / 1000) })}</Text>
      ) : (
        !!message && <Text color={colors.danger}>{message}</Text>
      )}
      <PinPad value={pin} onChange={setPin} onSubmit={submit} disabled={waiting} />
      {biometrics && <Button label={tr('tools.vault.useBiometrics')} icon="lock" variant="tonal" onPress={tryBiometrics} />}
      <Button label={tr('tools.vault.forgot')} variant="ghost" onPress={forgot} />
    </View>
  );
}

function Contents() {
  const tr = useT();
  const colors = useColors();
  const biometrics = useVault((s) => s.biometrics);
  const [items, setItems] = useState<VaultItem[] | null>(null);
  const [canBiometrics, setCanBiometrics] = useState(false);

  const load = useCallback(() => {
    RitmoCore.vaultList()
      .then((list) => setItems([...list].sort((a, b) => b.addedAt - a.addedAt)))
      .catch((e) => {
        logError('Pasta privada: listar', e);
        Alert.alert(t('tools.vault.listFailed'), errorMessage(e));
        setItems([]);
      });
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()])
      .then(([hardware, enrolled]) => setCanBiometrics(hardware && enrolled))
      .catch(() => setCanBiometrics(false));
  }, []);

  const open = (item: VaultItem) => {
    if (item.kind === 'video') {
      router.push({ pathname: '/video/[id]', params: { id: `v:${item.id}`, uri: item.uri, title: item.title || item.name } });
      return;
    }
    const audio = (items ?? []).filter((i) => i.kind === 'audio');
    const tracks = audio.map(vaultTrack);
    useExternalTracks.getState().add(tracks);
    void usePlayer.getState().playTracks(tracks, audio.findIndex((i) => i.id === item.id));
    router.push('/player');
  };

  const restore = async (item: VaultItem) => {
    if (await restoreFromVault(item)) load();
  };

  const remove = (item: VaultItem) =>
    Alert.alert(tr('tools.vault.deleteTitle', { name: item.title || item.name }), tr('tools.vault.deleteText'), [
      { text: tr('common.cancel'), style: 'cancel' },
      {
        text: tr('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await RitmoCore.vaultDelete(item.id).catch((e) => logError('Pasta privada: excluir', e));
          load();
        },
      },
    ]);

  return (
    <FlatList
      data={items ?? []}
      keyExtractor={(i) => i.id}
      contentContainerStyle={{ padding: space.lg, gap: space.sm }}
      ListHeaderComponent={
        <View style={[styles.info, { backgroundColor: colors.surface }]}>
          <Text variant="caption" muted>
            {tr('tools.vault.about')}
          </Text>
          {canBiometrics && (
            <View style={styles.switchRow}>
              <Text style={{ flex: 1 }}>{tr('tools.vault.biometrics')}</Text>
              <Switch
                value={biometrics}
                onValueChange={(on) => useVault.getState().setBiometrics(on)}
                trackColor={{ true: colors.primary, false: colors.surfaceAlt }}
                thumbColor="#fff"
              />
            </View>
          )}
        </View>
      }
      ListEmptyComponent={items ? <EmptyState icon="lock" title={tr('tools.vault.empty')} message={tr('tools.vault.emptyText')} /> : undefined}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => open(item)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.item, { backgroundColor: pressed ? colors.ripple : colors.surface }]}>
          <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
            <Icon name={item.kind === 'video' ? 'movie' : 'music_note'} color={colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="label" numberOfLines={1}>
              {item.title || item.name}
            </Text>
            <Text variant="caption" muted numberOfLines={1}>
              {[item.artist, item.duration > 0 ? formatDuration(item.duration) : null, formatBytes(item.size)].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <IconButton icon="settings_backup_restore" label={tr('tools.vault.restore')} onPress={() => restore(item)} color={colors.textMuted} />
          <IconButton icon="delete" label={tr('common.delete')} onPress={() => remove(item)} color={colors.textMuted} />
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.xl },
  text: { textAlign: 'center' },
  info: { borderRadius: radius.lg, padding: space.md, gap: space.sm, marginBottom: space.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center' },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderRadius: radius.lg, paddingLeft: space.md, paddingVertical: space.sm },
  icon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
