import { StyleSheet, Switch, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { haptic } from '@/lib/haptics';
import { space, useColors } from '@/theme';

type Props = { title: string; hint?: string; value: boolean; onValueChange: (value: boolean) => void; disabled?: boolean };

/** Linha de ajuste com título, explicação curta e chave liga/desliga. */
export function SettingSwitch({ title, hint, value, onValueChange, disabled }: Props) {
  const colors = useColors();
  return (
    <View style={[styles.row, disabled && styles.disabled]}>
      <View style={styles.texts}>
        <Text>{title}</Text>
        {!!hint && (
          <Text variant="caption" muted>
            {hint}
          </Text>
        )}
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          haptic('toggle');
          onValueChange(next);
        }}
        trackColor={{ true: colors.primary, false: colors.surfaceAlt }}
        thumbColor="#fff"
        accessibilityLabel={title}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  texts: { flex: 1, gap: 2 },
  disabled: { opacity: 0.5 },
});
