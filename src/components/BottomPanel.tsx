import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type DimensionValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';
import { radius, space, useColors } from '@/theme';

/** Painel que sobe por cima do player (fila, equalizador, timer), com a alça de arrastar no topo. */
export function BottomPanel({ children, height = '78%' }: { children: ReactNode; height?: DimensionValue }) {
  const colors = useColors();
  const tr = useT();
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]} onPress={() => router.back()} accessibilityLabel={tr('common.close')} />
      <View style={[styles.panel, { height, backgroundColor: colors.surface, paddingBottom: insets.bottom }]}>
        <View style={[styles.handle, { backgroundColor: colors.textWeak }]} />
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  panel: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, overflow: 'hidden' },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginTop: space.sm, marginBottom: space.xs },
});
