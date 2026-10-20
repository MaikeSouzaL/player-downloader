import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { radius, space, useColors } from '@/theme';

type ChipProps = { label: string; selected?: boolean; onPress?: () => void; onLongPress?: () => void; icon?: IconName };

export function Chip({ label, selected, onPress, onLongPress, icon }: ChipProps) {
  const colors = useColors();
  const fg = selected ? colors.primaryContent : colors.text;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      android_ripple={{ color: colors.ripple }}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: selected ? colors.primarySoft : colors.surfaceAlt, opacity: pressed && Platform.OS === 'ios' ? 0.6 : 1 },
      ]}>
      {icon && <Icon name={icon} size={16} color={fg} />}
      <Text variant="caption" color={fg} style={{ fontWeight: '600' }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function EmptyState({ icon, title, message, action }: { icon: IconName; title: string; message?: string; action?: ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceAlt }]}>
        <Icon name={icon} size={34} color={colors.textMuted} />
      </View>
      <Text variant="heading" style={styles.center}>
        {title}
      </Text>
      {message && (
        <Text muted style={styles.center}>
          {message}
        </Text>
      )}
      {action}
    </View>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const colors = useColors();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: inset }} />;
}

/** Linha de lista genérica (ajustes, menus). */
export function ListItem({
  icon,
  title,
  subtitle,
  onPress,
  right,
  danger,
}: {
  icon?: IconName;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  right?: ReactNode;
  danger?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      android_ripple={{ color: colors.ripple }}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [styles.item, pressed && Platform.OS === 'ios' && { backgroundColor: colors.ripple }]}>
      {icon && <Icon name={icon} color={danger ? colors.danger : colors.textMuted} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" color={danger ? colors.danger : undefined}>
          {title}
        </Text>
        {subtitle && (
          <Text variant="caption" muted numberOfLines={2}>
            {subtitle}
          </Text>
        )}
      </View>
      {right}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    height: 34,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  empty: { alignItems: 'center', gap: space.md, paddingHorizontal: space.xl, paddingVertical: space.xxl * 1.5 },
  emptyIcon: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 56 },
});
