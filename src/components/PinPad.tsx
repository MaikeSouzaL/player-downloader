import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useT } from '@/i18n';
import { PIN_MAX, PIN_MIN } from '@/lib/pin';
import { space, useColors } from '@/theme';

/** Teclado numérico do PIN (4 a 6 dígitos), com os pontinhos e "OK". */
export function PinPad({ value, onChange, onSubmit, disabled }: { value: string; onChange: (v: string) => void; onSubmit: () => void; disabled?: boolean }) {
  const tr = useT();
  const colors = useColors();
  const press = (key: string) => {
    if (disabled) return;
    if (key === 'back') onChange(value.slice(0, -1));
    else if (key === 'ok') {
      if (value.length >= PIN_MIN) onSubmit();
    } else if (value.length < PIN_MAX) onChange(value + key);
  };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'ok'];
  return (
    <View style={styles.root}>
      <View style={styles.dots} accessibilityLabel={tr('tools.vault.pinDigits', { n: value.length })}>
        {Array.from({ length: PIN_MAX }, (_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              { borderColor: i < PIN_MIN || i < value.length ? colors.primary : colors.border, backgroundColor: i < value.length ? colors.primary : 'transparent' },
            ]}
          />
        ))}
      </View>
      <View style={styles.grid}>
        {keys.map((key) => (
          <Pressable
            key={key}
            onPress={() => press(key)}
            accessibilityRole="button"
            accessibilityLabel={key === 'back' ? tr('tools.vault.erase') : key === 'ok' ? tr('common.ok') : key}
            disabled={disabled || (key === 'ok' && value.length < PIN_MIN)}
            style={({ pressed }) => [styles.key, { backgroundColor: pressed ? colors.ripple : colors.surfaceAlt, opacity: disabled ? 0.4 : 1 }]}>
            {key === 'back' ? (
              <Icon name="arrow_back" color={colors.text} />
            ) : key === 'ok' ? (
              <Icon name="check" color={value.length >= PIN_MIN ? colors.primary : colors.textWeak} />
            ) : (
              <Text variant="title">{key}</Text>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: space.xl },
  dots: { flexDirection: 'row', gap: space.md },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: 264, gap: 12, justifyContent: 'center' },
  key: { width: 76, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
});
