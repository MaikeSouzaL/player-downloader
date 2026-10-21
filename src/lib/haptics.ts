import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { useSettings } from '@/store/settings';

/**
 * tap: tocar/pausar e botões principais · toggle: curtir, ligar/desligar · step: trocar de música
 * (arrastar a capa ou o mini player) · drag: começar a arrastar na fila · done: algo terminou bem.
 */
export type HapticKind = 'tap' | 'toggle' | 'step' | 'drag' | 'done';

// No Android usa a vibração do próprio sistema (a mesma do teclado): segue o ajuste de
// "vibração ao tocar" do aparelho e não precisa de permissão.
const ANDROID: Record<HapticKind, Haptics.AndroidHaptics> = {
  tap: Haptics.AndroidHaptics.Context_Click,
  toggle: Haptics.AndroidHaptics.Keyboard_Tap,
  step: Haptics.AndroidHaptics.Clock_Tick,
  drag: Haptics.AndroidHaptics.Long_Press,
  done: Haptics.AndroidHaptics.Confirm,
};

/** Vibração leve (Ajustes › Tema › Vibração ao tocar). Falha em silêncio: é só um detalhe. */
export function haptic(kind: HapticKind = 'tap') {
  if (Platform.OS === 'web' || !useSettings.getState().haptics) return;
  const run =
    Platform.OS === 'android'
      ? Haptics.performAndroidHapticsAsync(ANDROID[kind])
      : kind === 'done'
        ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        : kind === 'toggle' || kind === 'step'
          ? Haptics.selectionAsync()
          : Haptics.impactAsync(kind === 'drag' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
  run.catch(() => {});
}
