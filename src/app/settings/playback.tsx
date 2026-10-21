import Slider from '@react-native-community/slider';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { Chip, ListItem } from '@/components/ui/misc';
import { SettingSwitch } from '@/components/ui/SettingSwitch';
import { Text } from '@/components/ui/Text';
import { useT, type StringKey } from '@/i18n';
import { IS_IOS } from '@/lib/platform';
import { usePlayer } from '@/store/player';
import { useSettings, type ReplayGainMode } from '@/store/settings';
import { radius, space, useColors } from '@/theme';

const GAIN_MODES: { id: ReplayGainMode; label: StringKey }[] = [
  { id: 'off', label: 'extras.play.rgOff' },
  { id: 'track', label: 'extras.play.rgTrack' },
  { id: 'album', label: 'extras.play.rgAlbum' },
];

/** Configurações de reprodução: áudios curtos, velocidade, transição entre músicas, audiolivro e volume igualado. */
export default function PlaybackSettingsScreen() {
  const tr = useT();
  const colors = useColors();
  const minDuration = useSettings((s) => s.minDurationSec);
  const [draft, setDraft] = useState(minDuration);
  const speed = usePlayer((s) => s.snapshot?.speed ?? 1);
  const { crossfadeSec, gaplessAlbums, skipSilence, resumeLong, replayGain, replayGainPreamp, set } = useSettings();
  const [fade, setFade] = useState(crossfadeSec);
  const [preamp, setPreamp] = useState(replayGainPreamp);

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

      <Text variant="label" muted style={styles.section}>
        {tr('extras.play.title')}
      </Text>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Text variant="label">{tr('extras.play.crossfade')}</Text>
        <Text variant="caption" muted>
          {fade === 0 ? tr('extras.play.crossfadeOff') : tr('extras.play.crossfadeValue', { n: fade })}
        </Text>
        <Slider
          value={fade}
          minimumValue={0}
          maximumValue={12}
          step={1}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.textWeak}
          thumbTintColor={colors.primary}
          onValueChange={(v) => setFade(Math.round(v))}
          onSlidingComplete={(v) => set({ crossfadeSec: Math.round(v) })}
          accessibilityLabel={tr('extras.play.crossfade')}
        />
        <Text variant="caption" muted>
          {tr('extras.play.crossfadeHint')}
        </Text>
        <SettingSwitch
          title={tr('extras.play.gapless')}
          hint={tr(IS_IOS ? 'extras.play.gaplessHintIos' : 'extras.play.gaplessHint')}
          value={gaplessAlbums}
          disabled={crossfadeSec === 0}
          onValueChange={(v) => set({ gaplessAlbums: v })}
        />
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <SettingSwitch title={tr('extras.play.resume')} hint={tr('extras.play.resumeHint')} value={resumeLong} onValueChange={(v) => set({ resumeLong: v })} />
        <SettingSwitch
          title={tr('extras.play.skipSilence')}
          hint={IS_IOS ? `${tr('extras.play.skipSilenceHint')} ${tr('extras.play.androidOnly')}` : tr('extras.play.skipSilenceHint')}
          value={skipSilence && !IS_IOS}
          disabled={IS_IOS}
          onValueChange={(v) => set({ skipSilence: v })}
        />
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Text variant="label">{tr('extras.play.replayGain')}</Text>
        <View style={styles.chips}>
          {GAIN_MODES.map((m) => (
            <Chip key={m.id} label={tr(m.label)} selected={replayGain === m.id} onPress={() => set({ replayGain: m.id })} />
          ))}
        </View>
        {replayGain !== 'off' && (
          <>
            <Text variant="caption" muted>
              {tr('extras.play.preamp', { n: preamp > 0 ? `+${preamp}` : preamp })}
            </Text>
            <Slider
              value={preamp}
              minimumValue={-6}
              maximumValue={6}
              step={1}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor={colors.textWeak}
              thumbTintColor={colors.primary}
              onValueChange={(v) => setPreamp(Math.round(v))}
              onSlidingComplete={(v) => set({ replayGainPreamp: Math.round(v) })}
              accessibilityLabel={tr('extras.play.replayGain')}
            />
          </>
        )}
        <Text variant="caption" muted>
          {tr('extras.play.rgHint')}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.md, gap: space.md },
  card: { borderRadius: radius.lg, padding: space.lg, gap: space.sm, overflow: 'hidden' },
  section: { marginTop: space.sm, marginLeft: space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
