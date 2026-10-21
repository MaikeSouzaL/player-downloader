import * as ScreenOrientation from 'expo-screen-orientation';

import { logError } from '@/lib/errorlog';
import { useSettings } from '@/store/settings';

/**
 * Orientação fora do vídeo: gira com o aparelho quando "Girar a tela" está ligado (Ajustes › Tema);
 * senão fica sempre em pé, como antes. O vídeo trava do jeito dele e chama isto ao sair.
 */
export function applyOrientation(rotation: boolean = useSettings.getState().rotation) {
  const action = rotation ? ScreenOrientation.unlockAsync() : ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
  action.catch((e) => logError('Girar a tela', e));
}
