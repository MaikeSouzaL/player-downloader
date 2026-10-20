import Slider from '@react-native-community/slider';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';

import { BottomPanel } from '@/components/BottomPanel';
import { Button, IconButton } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Chip, EmptyState } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { useT, type StringKey } from '@/i18n';
import { logError } from '@/lib/errorlog';
import RitmoCore, { type EqualizerInfo, type OutputDevice } from '@/modules/ritmo-core';
import { useSettings, type EqPreset } from '@/store/settings';
import { useUi } from '@/store/ui';
import { radius, space, useColors } from '@/theme';

/** Textos traduzidos dos presets que o Android costuma oferecer; os outros nomes do aparelho ficam como vêm. */
const PRESET_NAMES: Record<string, StringKey> = {
  Normal: 'player.eq.preset.normal',
  Classical: 'player.eq.preset.classical',
  Dance: 'player.eq.preset.dance',
  Flat: 'player.eq.preset.flat',
  Folk: 'player.eq.preset.folk',
  'Heavy Metal': 'player.eq.preset.heavyMetal',
  'Hip Hop': 'player.eq.preset.hipHop',
  Jazz: 'player.eq.preset.jazz',
  Pop: 'player.eq.preset.pop',
  Rock: 'player.eq.preset.rock',
};

const OUTPUT: Record<OutputDevice['kind'], { icon: IconName; label: StringKey }> = {
  bluetooth: { icon: 'bluetooth_audio', label: 'player.eq.output.bluetooth' },
  wired: { icon: 'headphones', label: 'player.eq.output.wired' },
  speaker: { icon: 'speaker', label: 'player.eq.output.speaker' },
};

const sameLevels = (info: EqualizerInfo, p: EqPreset) =>
  info.bands.length === p.levels.length && info.bands.every((b) => Math.abs(b.level - p.levels[b.index]) < 50);

const freq = (hz: number) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz % 1000 ? 1 : 0)}k` : String(hz));

/** Equalizador (fragment_motion_equalizer do Lark): liga/desliga, presets, bandas, graves e ganho. */
export default function EqualizerScreen() {
  const colors = useColors();
  const tr = useT();
  const [info, setInfo] = useState<EqualizerInfo | null>(null);
  const [output] = useState<OutputDevice | null>(() => {
    try {
      return RitmoCore.getOutputDevice();
    } catch {
      return null;
    }
  });
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const presets = useSettings((s) => s.eqPresets);

  useEffect(() => {
    RitmoCore.getEqualizer().then(setInfo).catch(() => setInfo(null));
  }, []);

  // Guarda os ajustes para reaplicar na próxima abertura do app.
  const apply = (next: EqualizerInfo) => {
    setInfo(next);
    useSettings.getState().set({
      equalizer: {
        enabled: next.enabled,
        levels: next.preset >= 0 ? null : next.bands.map((b) => b.level),
        preset: next.preset,
        bass: next.bassBoost,
        loudness: next.loudnessGain,
      },
    });
  };

  /** Aplica níveis por banda, graves e ganho (presets salvos e "Restaurar padrão"). */
  const applyLevels = async (levels: number[], bass: number, loudness: number) => {
    if (!info) return;
    try {
      let next = info.enabled ? info : await RitmoCore.setEqualizerEnabled(true);
      for (const band of info.bands) {
        const level = levels[band.index] ?? 0;
        next = await RitmoCore.setEqualizerBand(band.index, Math.max(info.minLevel, Math.min(info.maxLevel, level)));
      }
      if (info.bassBoostAvailable) next = await RitmoCore.setBassBoost(bass);
      if (info.loudnessAvailable) next = await RitmoCore.setLoudness(loudness);
      apply(next);
    } catch (e) {
      logError('Equalizador', e);
      useUi.getState().showToast(tr('player.eq.applyError'));
    }
  };

  const savePreset = () => {
    if (!info) return;
    const label = name.trim() || tr('player.eq.myPreset', { n: presets.length + 1 });
    const preset: EqPreset = {
      id: String(Date.now()),
      name: label,
      levels: info.bands.map((b) => b.level),
      bass: info.bassBoost,
      loudness: info.loudnessGain,
    };
    useSettings.getState().set({ eqPresets: [...presets, preset] });
    setNaming(false);
    useUi.getState().showToast(tr('player.eq.saved', { name: label }));
  };

  const removePreset = (p: EqPreset) =>
    Alert.alert(tr('player.eq.deleteTitle', { name: p.name }), undefined, [
      { text: tr('common.cancel'), style: 'cancel' },
      {
        text: tr('player.eq.deleteAction'),
        style: 'destructive',
        onPress: () => useSettings.getState().set({ eqPresets: useSettings.getState().eqPresets.filter((x) => x.id !== p.id) }),
      },
    ]);

  const reset = async () => {
    if (!info) return;
    await applyLevels(
      info.bands.map(() => 0),
      0,
      0
    );
    useUi.getState().showToast(tr('player.eq.restored'));
  };

  if (!info) {
    return (
      <BottomPanel height="60%">
        <EmptyState icon="equalizer" title={tr('player.eq.loading')} />
      </BottomPanel>
    );
  }

  if (!info.available) {
    return (
      <BottomPanel height="50%">
        <EmptyState icon="equalizer" title={tr('player.eq.unavailable')} message={tr('player.eq.unavailableHint')} />
      </BottomPanel>
    );
  }

  const disabled = !info.enabled;
  const customMatch = info.preset < 0 ? presets.find((p) => sameLevels(info, p)) : undefined;
  const out = output ? OUTPUT[output.kind] : null;

  return (
    <BottomPanel height="80%">
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text variant="heading">{tr('player.eq.title')}</Text>
          {out && (
            <View style={styles.output}>
              <Icon name={out.icon} size={14} color={colors.textMuted} />
              <Text variant="caption" muted numberOfLines={1}>
                {output?.name && output.kind !== 'speaker' ? `${tr(out.label)}: ${output.name}` : tr(out.label)}
              </Text>
            </View>
          )}
        </View>
        <IconButton icon="restart_alt" label={tr('player.eq.reset')} onPress={reset} color={colors.textMuted} />
        <Switch
          value={info.enabled}
          onValueChange={(v) => RitmoCore.setEqualizerEnabled(v).then(apply)}
          trackColor={{ true: colors.primary, false: colors.surfaceAlt }}
          thumbColor="#fff"
          accessibilityLabel={tr('player.eq.switchLabel')}
        />
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presets}>
          <Chip label={tr('player.eq.custom')} selected={info.preset < 0 && !customMatch} />
          {presets.map((p) => (
            <Chip
              key={p.id}
              icon="person"
              label={p.name}
              selected={customMatch?.id === p.id}
              onPress={() => applyLevels(p.levels, p.bass, p.loudness)}
              onLongPress={() => removePreset(p)}
            />
          ))}
          {info.presets.map((name, i) => (
            <Chip key={name} label={PRESET_NAMES[name] ? tr(PRESET_NAMES[name]) : name} selected={info.preset === i} onPress={() => RitmoCore.applyEqualizerPreset(i).then(apply)} />
          ))}
          <Chip
            icon="add"
            label={tr('common.save')}
            onPress={() => {
              setName('');
              setNaming(true);
            }}
          />
        </ScrollView>

        <View style={[styles.bands, disabled && styles.dim]}>
          {info.bands.map((band) => (
            <View key={band.index} style={styles.band}>
              <Text variant="micro" muted>
                {band.level > 0 ? '+' : ''}
                {Math.round(band.level / 100)}dB
              </Text>
              <View style={styles.vertical}>
                <Slider
                  value={band.level}
                  minimumValue={info.minLevel}
                  maximumValue={info.maxLevel}
                  step={50}
                  disabled={disabled}
                  minimumTrackTintColor={colors.primary}
                  maximumTrackTintColor={colors.textWeak}
                  thumbTintColor={colors.primary}
                  onSlidingComplete={(v) => RitmoCore.setEqualizerBand(band.index, Math.round(v)).then(apply)}
                  accessibilityLabel={tr('player.eq.band', { freq: freq(band.centerHz) })}
                  style={styles.verticalSlider}
                />
              </View>
              <Text variant="micro" muted>
                {freq(band.centerHz)}
              </Text>
            </View>
          ))}
        </View>

        {info.bassBoostAvailable && (
          <View style={[styles.knob, disabled && styles.dim]}>
            <Text variant="label">{tr('player.eq.bass')}</Text>
            <Slider
              value={info.bassBoost}
              minimumValue={0}
              maximumValue={1000}
              step={50}
              disabled={disabled}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor={colors.textWeak}
              thumbTintColor={colors.primary}
              onSlidingComplete={(v) => RitmoCore.setBassBoost(Math.round(v)).then(apply)}
            />
          </View>
        )}
        {info.loudnessAvailable && (
          <View style={[styles.knob, disabled && styles.dim]}>
            <Text variant="label">{tr('player.eq.gain')}</Text>
            <Slider
              value={info.loudnessGain}
              minimumValue={0}
              maximumValue={1500}
              step={50}
              disabled={disabled}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor={colors.textWeak}
              thumbTintColor={colors.primary}
              onSlidingComplete={(v) => RitmoCore.setLoudness(Math.round(v)).then(apply)}
            />
          </View>
        )}
      </ScrollView>
      <Sheet visible={naming} onClose={() => setNaming(false)}>
        <View style={styles.sheet}>
          <Text variant="heading">{tr('player.eq.saveTitle')}</Text>
          <Text variant="caption" muted>
            {tr('player.eq.saveHint')}
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            autoFocus
            maxLength={30}
            placeholder={tr('player.eq.myPreset', { n: presets.length + 1 })}
            placeholderTextColor={colors.textWeak}
            onSubmitEditing={savePreset}
            style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceAlt }]}
          />
          <View style={styles.buttons}>
            <Button label={tr('common.cancel')} variant="ghost" onPress={() => setNaming(false)} />
            <Button label={tr('common.save')} onPress={savePreset} />
          </View>
        </View>
      </Sheet>
    </BottomPanel>
  );
}

const SLIDER_LENGTH = 180;

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.sm },
  body: { paddingBottom: space.xl, gap: space.lg },
  presets: { paddingHorizontal: space.lg, gap: space.sm },
  bands: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: space.sm },
  band: { alignItems: 'center', gap: space.xs, width: 52 },
  vertical: { width: 40, height: SLIDER_LENGTH, alignItems: 'center', justifyContent: 'center' },
  verticalSlider: { width: SLIDER_LENGTH, height: 40, transform: [{ rotate: '-90deg' }] },
  knob: { paddingHorizontal: space.lg, gap: space.xs },
  dim: { opacity: 0.45 },
  output: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  sheet: { padding: space.lg, gap: space.md },
  input: { height: 48, borderRadius: radius.md, paddingHorizontal: space.lg, fontSize: 16 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
});
