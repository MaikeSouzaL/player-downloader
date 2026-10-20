import Slider from '@react-native-community/slider';
import { Image } from 'expo-image';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { clearBackground, pickBackground } from '@/components/AppBackground';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Chip } from '@/components/ui/misc';
import { Text } from '@/components/ui/Text';
import { useT, type StringKey } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { useSettings, type ThemePreference } from '@/store/settings';
import { ACCENTS, radius, space, useColors, useIsDark, type Accent } from '@/theme';

const MODES: { id: ThemePreference; label: StringKey }[] = [
  { id: 'system', label: 'settings.mode.system' },
  { id: 'light', label: 'settings.mode.light' },
  { id: 'dark', label: 'settings.mode.dark' },
];

/** Tema (LPThemeFragment do Lark): claro/escuro, a cor de destaque e a foto de fundo. */
export default function ThemeScreen() {
  const tr = useT();
  const colors = useColors();
  const isDark = useIsDark();
  const { theme, accent, background, set } = useSettings();
  const setBg = (patch: Partial<typeof background>) => set({ background: { ...background, ...patch } });
  const choose = () =>
    pickBackground().catch((e) => Alert.alert(tr('settings.bgError'), errorMessage(e)));
  const veil = isDark ? `rgba(0,0,0,${background.dim})` : `rgba(255,255,255,${Math.min(0.92, background.dim + 0.15)})`;

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Text variant="label" muted>
        {tr('settings.appearance')}
      </Text>
      <View style={styles.modes}>
        {MODES.map((m) => (
          <Chip key={m.id} label={tr(m.label)} selected={theme === m.id} onPress={() => set({ theme: m.id })} />
        ))}
      </View>

      <Text variant="label" muted>
        {tr('settings.color')}
      </Text>
      <View style={styles.grid}>
        {(Object.keys(ACCENTS) as Accent[]).map((id) => {
          const [primary, , soft] = ACCENTS[id][isDark ? 'dark' : 'light'];
          const selected = accent === id;
          return (
            <Pressable
              key={id}
              onPress={() => set({ accent: id })}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={tr(ACCENTS[id].nameKey)}
              style={[styles.card, { backgroundColor: soft, borderColor: selected ? primary : 'transparent' }]}>
              <View style={[styles.swatch, { backgroundColor: primary }]}>
                {selected && <Icon name="check" color="#fff" />}
              </View>
              <Text variant="label" color={colors.text}>
                {tr(ACCENTS[id].nameKey)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text variant="label" muted style={{ marginTop: space.md }}>
        {tr('settings.bgPhoto')}
      </Text>
      <View style={[styles.bgCard, { backgroundColor: colors.surface }]}>
        <Pressable onPress={choose} accessibilityRole="button" accessibilityLabel={tr('settings.bgPick')} style={[styles.preview, { backgroundColor: colors.surfaceAlt }]}>
          {background.uri ? (
            <>
              <Image source={{ uri: background.uri }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={background.blur} />
              <View style={[StyleSheet.absoluteFill, { backgroundColor: veil }]} />
              <Text variant="heading" style={styles.previewText}>
                Player Downloader
              </Text>
            </>
          ) : (
            <>
              <Icon name="add_photo_alternate" size={34} color={colors.textMuted} />
              <Text variant="caption" muted>
                {tr('settings.bgPickHint')}
              </Text>
            </>
          )}
        </Pressable>
        <View style={styles.bgButtons}>
          <Button label={background.uri ? tr('settings.bgChange') : tr('settings.bgChoose')} icon="image" variant="tonal" compact onPress={choose} />
          {background.uri && <Button label={tr('common.remove')} icon="delete" variant="ghost" compact onPress={clearBackground} />}
        </View>
        {background.uri && (
          <>
            <Text variant="caption" muted>
              {tr('settings.bgBlur')}
            </Text>
            <Slider
              value={background.blur}
              minimumValue={0}
              maximumValue={40}
              step={1}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor={colors.textWeak}
              thumbTintColor={colors.primary}
              onSlidingComplete={(v) => setBg({ blur: Math.round(v) })}
              accessibilityLabel={tr('settings.bgBlurA11y')}
            />
            <Text variant="caption" muted>
              {isDark ? tr('settings.bgDarken') : tr('settings.bgLighten')}
            </Text>
            <Slider
              value={background.dim}
              minimumValue={0}
              maximumValue={0.85}
              step={0.05}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor={colors.textWeak}
              thumbTintColor={colors.primary}
              onSlidingComplete={(v) => setBg({ dim: Math.round(v * 100) / 100 })}
              accessibilityLabel={tr('settings.bgDimA11y')}
            />
            <View style={styles.switchRow}>
              <Text style={{ flex: 1 }}>{tr('settings.bgPlayer')}</Text>
              <Switch
                value={background.player}
                onValueChange={(player) => setBg({ player })}
                trackColor={{ true: colors.primary, false: colors.surfaceAlt }}
                thumbColor="#fff"
                accessibilityLabel={tr('settings.bgPlayerA11y')}
              />
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.md },
  modes: { flexDirection: 'row', gap: space.sm, marginBottom: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  card: { width: '30%', aspectRatio: 0.9, borderRadius: radius.lg, borderWidth: 2, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  bgCard: { borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  preview: { height: 160, borderRadius: radius.md, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', gap: space.xs },
  previewText: { textShadowColor: 'rgba(0,0,0,0.3)', textShadowRadius: 4 },
  bgButtons: { flexDirection: 'row', gap: space.sm, marginVertical: space.xs },
  switchRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.xs },
  swatch: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
