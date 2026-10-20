import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

/** As três barrinhas que pulam sobre a capa da música que está tocando (EqualizerView do Lark). */
export function PlayingBars({ playing, color = '#fff', size = 16 }: { playing: boolean; color?: string; size?: number }) {
  const [bars] = useState(() => [new Animated.Value(0.4), new Animated.Value(0.9), new Animated.Value(0.6)]);

  useEffect(() => {
    if (!playing) {
      bars.forEach((b) => b.stopAnimation());
      return;
    }
    const loops = bars.map((bar, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(bar, { toValue: 1, duration: 260 + i * 90, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(bar, { toValue: 0.25, duration: 300 + i * 70, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [playing, bars]);

  const width = Math.max(2, size / 5);
  return (
    <View style={[styles.row, { height: size, gap: width * 0.6 }]} accessibilityElementsHidden importantForAccessibility="no">
      {bars.map((bar, i) => (
        <Animated.View
          key={i}
          style={{ width, height: size, borderRadius: width / 2, backgroundColor: color, transform: [{ scaleY: bar }] }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end' },
});
