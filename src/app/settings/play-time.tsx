import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useT, type StringKey } from '@/i18n';
import { formatLongDuration } from '@/lib/format';
import { dayKey, useCollections } from '@/store/collections';
import { useLibrary } from '@/store/library';
import { radius, space, useColors } from '@/theme';

/** Abreviações dos dias da semana, indexadas por Date#getDay (0 = domingo). */
const WEEKDAYS: StringKey[] = ['settings.day.0', 'settings.day.1', 'settings.day.2', 'settings.day.3', 'settings.day.4', 'settings.day.5', 'settings.day.6'];

/** Tempo de reprodução (PlayingTimeFragment do Lark): hoje, últimos 7 dias e mais tocadas. */
export default function PlayTimeScreen() {
  const tr = useT();
  const colors = useColors();
  const playTime = useCollections((s) => s.playTime);
  const plays = useCollections((s) => s.plays);
  const byId = useLibrary((s) => s.index.byId);

  const week = useMemo(() => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push({ day: d.getDay(), ms: playTime[dayKey(d)] ?? 0 });
    }
    return days;
  }, [playTime]);

  const max = Math.max(1, ...week.map((d) => d.ms));
  const total = Object.values(playTime).reduce((a, b) => a + b, 0);
  const top = Object.entries(plays)
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => ({ track: byId.get(id), count }))
    .filter((x) => x.track)
    .slice(0, 5);

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Text variant="caption" muted>
          {tr('settings.today')}
        </Text>
        <Text variant="display" color={colors.primary}>
          {formatLongDuration(week[6].ms)}
        </Text>
        <View style={styles.chart} accessibilityLabel={tr('settings.weekA11y')}>
          {week.map((d, i) => (
            <View key={i} style={styles.barCol}>
              <View style={[styles.bar, { height: `${Math.max(4, (d.ms / max) * 100)}%`, backgroundColor: i === 6 ? colors.primary : colors.surfaceAlt }]} />
              <Text variant="micro" muted>
                {tr(WEEKDAYS[d.day])}
              </Text>
            </View>
          ))}
        </View>
        <Text variant="caption" muted>
          {tr('settings.totalSince', { time: formatLongDuration(total) })}
        </Text>
      </View>

      {top.length > 0 && (
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text variant="label">{tr('settings.mostPlayed')}</Text>
          {top.map(({ track, count }, i) => (
            <View key={track!.id} style={styles.topRow}>
              <Text variant="label" color={colors.primary} style={{ width: 20 }}>
                {i + 1}
              </Text>
              <Text style={{ flex: 1 }} numberOfLines={1}>
                {track!.title}
              </Text>
              <Text variant="caption" muted>
                {count}×
              </Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.md, gap: space.md },
  card: { borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 140, gap: space.sm, marginVertical: space.md },
  barCol: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  bar: { width: '70%', borderRadius: 4 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 4 },
});
