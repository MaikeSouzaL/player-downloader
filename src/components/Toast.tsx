import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { useUi } from '@/store/ui';
import { radius, space } from '@/theme';

/** Aviso curto no rodapé (como o snackbar do Lark). */
export function Toast() {
  const message = useUi((s) => s.toast);
  const insets = useSafeAreaInsets();
  if (!message) return null;
  return (
    <View pointerEvents="none" style={[styles.wrap, { bottom: insets.bottom + 90 }]} accessibilityLiveRegion="polite">
      <View style={styles.toast}>
        <Text variant="label" color="#fff">
          {message}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: space.xl },
  toast: { backgroundColor: 'rgba(30,30,30,0.95)', borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.md },
});
