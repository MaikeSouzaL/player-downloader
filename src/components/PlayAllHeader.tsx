import { Pressable, StyleSheet, View } from 'react-native';

import { IconButton } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useT } from '@/i18n';
import { space, useColors } from '@/theme';

type Props = {
  count: number;
  onPlayAll: () => void;
  onShuffle: () => void;
  onSort?: () => void;
  onSelect?: () => void;
};

/** Faixa "Reproduzir todas (N)" com aleatório, ordenar e selecionar (card_play_all do Lark). */
export function PlayAllHeader({ count, onPlayAll, onShuffle, onSort, onSelect }: Props) {
  const tr = useT();
  const colors = useColors();
  return (
    <View style={styles.row}>
      <Pressable onPress={onPlayAll} accessibilityRole="button" style={styles.playAll} hitSlop={6}>
        <View style={[styles.playCircle, { backgroundColor: colors.primary }]}>
          <Icon name="play_arrow" size={20} color={colors.onPrimary} />
        </View>
        <Text variant="heading">
          {tr('library.playAll')} <Text variant="label" muted>({count})</Text>
        </Text>
      </Pressable>
      <IconButton icon="shuffle" label={tr('library.shuffleLabel')} onPress={onShuffle} color={colors.textMuted} size={22} />
      {onSort && <IconButton icon="sort" label={tr('common.sort')} onPress={onSort} color={colors.textMuted} size={22} />}
      {onSelect && <IconButton icon="checklist" label={tr('common.select')} onPress={onSelect} color={colors.textMuted} size={22} />}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: space.lg, paddingRight: space.xs, height: 56 },
  playAll: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  playCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
