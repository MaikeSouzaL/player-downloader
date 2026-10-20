import { Platform, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { radius, space, useColors } from '@/theme';

type Variant = 'primary' | 'tonal' | 'outline' | 'ghost';

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  compact,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: IconName;
  disabled?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const look = {
    primary: { bg: colors.primary, fg: colors.onPrimary, border: colors.primary },
    tonal: { bg: colors.primarySoft, fg: colors.primaryContent, border: colors.primarySoft },
    outline: { bg: 'transparent', fg: colors.text, border: colors.border },
    ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
  }[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      android_ripple={{ color: colors.ripple }}
      style={({ pressed }) => [
        styles.base,
        {
          height: compact ? 36 : 46,
          paddingHorizontal: compact ? space.md : space.xl,
          backgroundColor: look.bg,
          borderColor: look.border,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
        },
        style,
      ]}>
      {icon && <Icon name={icon} size={compact ? 18 : 20} color={look.fg} />}
      <Text variant="label" color={look.fg} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  color,
  size = 24,
  active,
  disabled,
  box = 44,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  color?: string;
  size?: number;
  active?: boolean;
  disabled?: boolean;
  box?: number;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
      hitSlop={6}
      android_ripple={{ color: colors.ripple, borderless: true, radius: box / 2 }}
      style={({ pressed }) => ({
        width: box,
        height: box,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : pressed && Platform.OS === 'ios' ? 0.45 : 1,
      })}>
      <Icon name={icon} size={size} color={color ?? (active ? colors.primary : colors.text)} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    overflow: 'hidden',
  },
});
