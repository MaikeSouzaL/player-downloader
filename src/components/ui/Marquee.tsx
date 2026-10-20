import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { Text, type AppTextProps } from '@/components/ui/Text';

type Props = { text: string; variant?: AppTextProps['variant']; muted?: boolean; color?: string };

const GAP = 48;
const SPEED = 40; // px por segundo
const PAUSE_MS = 1800;

/** Texto de uma linha que rola devagar quando não cabe (título no player do Lark). */
export function Marquee({ text, variant = 'title', muted, color }: Props) {
  const [box, setBox] = useState(0);
  const [content, setContent] = useState(0);
  const [x] = useState(() => new Animated.Value(0));
  const overflow = box > 0 && content > box + 1;

  useEffect(() => {
    x.setValue(0);
    if (!overflow) return;
    const distance = content + GAP;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(PAUSE_MS),
        Animated.timing(x, { toValue: -distance, duration: (distance / SPEED) * 1000, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(x, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [overflow, content, text, x]);

  const onBox = (e: LayoutChangeEvent) => setBox(e.nativeEvent.layout.width);
  const onContent = (e: LayoutChangeEvent) => setContent(e.nativeEvent.layout.width);

  return (
    <View style={styles.box} onLayout={onBox} accessible accessibilityLabel={text}>
      <Animated.View style={[styles.row, { transform: [{ translateX: x }] }]}>
        <Text variant={variant} muted={muted} color={color} onLayout={onContent}>
          {text}
        </Text>
        {overflow && (
          <Text variant={variant} muted={muted} color={color} style={{ marginLeft: GAP }}>
            {text}
          </Text>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden' },
  // Largo o bastante para o texto não quebrar linha; o excesso fica escondido.
  row: { flexDirection: 'row', width: 4000 },
});
