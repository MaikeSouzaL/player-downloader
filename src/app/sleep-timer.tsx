import Slider from '@react-native-community/slider';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BottomPanel } from '@/components/BottomPanel';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ListItem } from '@/components/ui/misc';
import { Text } from '@/components/ui/Text';
import { useT, type Translator } from '@/i18n';
import { usePlayer } from '@/store/player';
import { useUi } from '@/store/ui';
import { space, useColors } from '@/theme';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const TIMERS = [10, 20, 30, 60];

/** "A música irá parar em 1 hora e 30 minutos"; sem a parte zerada (60 min → "1 hora"). */
function stopMessage(minutes: number, tr: Translator) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = tr.n('player.sleep.hours', h);
  const mins = tr.n('common.minutes', m);
  const time = h > 0 ? (m > 0 ? tr('player.sleep.hoursAndMinutes', { h: hours, m: mins }) : hours) : mins;
  return tr('player.sleep.stopIn', { time });
}

/** Timer para dormir (e, com ?mode=speed, a velocidade de reprodução). */
export default function SleepTimerScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const colors = useColors();
  const tr = useT();
  const sleep = usePlayer((s) => s.sleep);
  const speed = usePlayer((s) => s.snapshot?.speed ?? 1);
  const [custom, setCustom] = useState(45);
  const [showCustom, setShowCustom] = useState(false);
  const { setSleepTimer, setSpeed } = usePlayer.getState();

  const choose = async (minutes: number, endOfTrack = false) => {
    await setSleepTimer(minutes, endOfTrack);
    useUi.getState().showToast(minutes === 0 && !endOfTrack ? tr('player.sleep.off') : endOfTrack ? tr('player.sleep.stopAtEnd') : stopMessage(minutes, tr));
    router.back();
  };

  if (mode === 'speed') {
    return (
      <BottomPanel height="auto">
        <Text variant="heading" style={styles.title}>
          {tr('player.speed.title')}
        </Text>
        {SPEEDS.map((s) => (
          <ListItem
            key={s}
            title={s === 1 ? tr('player.speed.normal') : `${s}x`}
            onPress={() => {
              setSpeed(s);
              router.back();
            }}
            right={Math.abs(speed - s) < 0.01 ? <Icon name="check" color={colors.primary} /> : undefined}
          />
        ))}
      </BottomPanel>
    );
  }

  const active = sleep?.active;
  return (
    <BottomPanel height="auto">
      <Text variant="heading" style={styles.title}>
        {tr('player.timer')}
      </Text>
      {active && (
        <Text variant="caption" color={colors.primary} style={styles.status}>
          {sleep?.endOfTrack ? tr('player.sleep.statusEndOfTrack') : tr('player.sleep.statusIn', { n: Math.ceil((sleep?.remainingMs ?? 0) / 60000) })}
        </Text>
      )}
      <ListItem title={tr('player.sleep.none')} onPress={() => choose(0)} right={!active ? <Icon name="check" color={colors.primary} /> : undefined} />
      {TIMERS.map((minutes) => (
        <ListItem key={minutes} title={tr('player.sleep.after', { n: minutes })} onPress={() => choose(minutes)} />
      ))}
      <ListItem title={tr('player.sleep.endOfTrack')} onPress={() => choose(0, true)} right={sleep?.endOfTrack ? <Icon name="check" color={colors.primary} /> : undefined} />
      <ListItem title={tr('player.sleep.custom')} onPress={() => setShowCustom(!showCustom)} right={<Icon name={showCustom ? 'expand_less' : 'expand_more'} color={colors.textMuted} />} />
      {showCustom && (
        <View style={styles.custom}>
          <Text variant="label" style={{ textAlign: 'center' }}>
            {tr.n('common.minutes', custom)}
          </Text>
          <Slider
            value={custom}
            minimumValue={1}
            maximumValue={180}
            step={1}
            minimumTrackTintColor={colors.primary}
            maximumTrackTintColor={colors.textWeak}
            thumbTintColor={colors.primary}
            onValueChange={(v) => setCustom(Math.round(v))}
          />
          <Button label={tr('player.sleep.start')} onPress={() => choose(custom)} />
        </View>
      )}
    </BottomPanel>
  );
}

const styles = StyleSheet.create({
  title: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  status: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  custom: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md },
});
