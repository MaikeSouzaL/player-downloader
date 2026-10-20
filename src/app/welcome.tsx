import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useT, type StringKey } from '@/i18n';
import { IS_IOS } from '@/lib/platform';
import { useLibrary } from '@/store/library';
import { useSettings } from '@/store/settings';
import { radius, space, useColors } from '@/theme';

const ITEMS: { icon: IconName; title: StringKey; text: StringKey }[] = IS_IOS
  ? [
      // iPhone: as músicas vêm da pasta do app ou do app Música; os controles ficam na tela bloqueada (sem pedir notificação).
      { icon: 'library_music', title: 'settings.welcomeMedia', text: 'ios.welcomeMediaText' },
      { icon: 'lock', title: 'ios.welcomeLock', text: 'ios.welcomeLockText' },
      { icon: 'shield', title: 'settings.welcomePrivacy', text: 'settings.welcomePrivacyText' },
    ]
  : [
      { icon: 'library_music', title: 'settings.welcomeMedia', text: 'settings.welcomeMediaText' },
      { icon: 'notifications', title: 'settings.welcomeNotif', text: 'settings.welcomeNotifText' },
      { icon: 'shield', title: 'settings.welcomePrivacy', text: 'settings.welcomePrivacyText' },
    ];

/** Primeira abertura: explica o que o app vai pedir antes do pedido do Android. */
export default function WelcomeScreen() {
  const tr = useT();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const start = async () => {
    useSettings.getState().set({ onboarded: true });
    await useLibrary.getState().requestPermission();
    router.back();
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xl }]}>
      <Image source={require('@/assets/images/icon.png')} style={styles.logo} accessibilityIgnoresInvertColors />
      <Text variant="display" style={styles.center}>
        {tr('settings.welcomeTitle')}
      </Text>
      <Text muted style={styles.center}>
        {tr('settings.welcomeIntro')}
      </Text>
      <View style={styles.list}>
        {ITEMS.map((item) => (
          <View key={item.title} style={[styles.item, { backgroundColor: colors.surface }]}>
            <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
              <Icon name={item.icon} color={colors.primary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="label">{tr(item.title)}</Text>
              <Text variant="caption" muted>
                {tr(item.text)}
              </Text>
            </View>
          </View>
        ))}
      </View>
      <View style={{ flex: 1 }} />
      <Button label={tr('settings.welcomeStart')} icon="arrow_forward" onPress={start} style={{ alignSelf: 'stretch' }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', paddingHorizontal: space.xl, gap: space.md },
  logo: { width: 88, height: 88, borderRadius: 22, marginBottom: space.sm },
  center: { textAlign: 'center' },
  list: { alignSelf: 'stretch', gap: space.sm, marginTop: space.lg },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
