import Slider from '@react-native-community/slider';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useT } from '@/i18n';
import { formatDuration } from '@/lib/format';
import { usePlayer } from '@/store/player';
import { useColors } from '@/theme';

/** Barra de progresso com tempo atual e total (pgs_current / pgs_total do Lark). */
/** `color`: destaque da barra (o player usa a cor da capa); padrão, a cor do tema. */
export function SeekBar({ color }: { color?: string } = {}) {
  const colors = useColors();
  const accent = color ?? colors.primary;
  const tr = useT();
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const seek = usePlayer((s) => s.seek);
  const [dragging, setDragging] = useState<number | null>(null);
  const shown = dragging ?? position;

  return (
    <View>
      <Slider
        value={Math.min(shown, duration || 0)}
        minimumValue={0}
        maximumValue={Math.max(1, duration)}
        minimumTrackTintColor={accent}
        maximumTrackTintColor={colors.textWeak}
        thumbTintColor={accent}
        tapToSeek
        onSlidingStart={(v) => setDragging(v)}
        onValueChange={(v) => dragging != null && setDragging(v)}
        onSlidingComplete={(v) => {
          setDragging(null);
          seek(v);
        }}
        accessibilityLabel={tr('player.seekLabel')}
        style={styles.slider}
      />
      <View style={styles.times}>
        <Text variant="caption" muted>
          {formatDuration(shown)}
        </Text>
        <Text variant="caption" muted>
          {formatDuration(duration)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slider: { marginHorizontal: -12, height: 36 },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
});
