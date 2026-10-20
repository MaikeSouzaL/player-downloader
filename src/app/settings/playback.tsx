import Slider from '@react-native-community/slider';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { ListItem } from '@/components/ui/misc';
import { Text } from '@/components/ui/Text';
import { useT } from '@/i18n';
import { usePlayer } from '@/store/player';
import { useSettings } from '@/store/settings';
import { radius, space, useColors } from '@/theme';

/** Configurações de reprodução: filtro de áudios curtos e velocidade. */
export default function PlaybackSettingsScreen() {
  const tr = useT();
  const colors = useColors();
  const minDuration = useSettings((s) => s.minDurationSec);
  const [draft, setDraft] = useState(minDuration);
  const speed = usePlayer((s) => s.snapshot?.speed ?? 1);

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Text variant="label">{tr('settings.shortAudio')}</Text>
        <Text variant="caption" muted>
          {draft === 0 ? tr('settings.shortAudioAll') : tr('settings.shortAudioSome', { n: draft })}
        </Text>
        <Slider
          value={draft}
          minimumValue={0}
          maximumValue={120}
          step={5}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.textWeak}
          thumbTintColor={colors.primary}
          onValueChange={(v) => setDraft(Math.round(v))}
          onSlidingComplete={(v) => useSettings.getState().set({ minDurationSec: Math.round(v) })}
        />
        <Text variant="caption" muted>
          {tr('settings.shortAudioHint')}
        </Text>
      </View>
      <View style={[styles.card, { backgroundColor: colors.surface, padding: 0 }]}>
        <ListItem
          icon="speed"
          title={tr('settings.speed')}
          subtitle={`${speed}x`}
          onPress={() => router.push({ pathname: '/sleep-timer', params: { mode: 'speed' } })}
          right={<Icon name="chevron_right" size={22} color={colors.textWeak} />}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.md, gap: space.md },
  card: { borderRadius: radius.lg, padding: space.lg, gap: space.sm, overflow: 'hidden' },
});
