import AsyncStorage from '@react-native-async-storage/async-storage';
import { createJSONStorage } from 'zustand/middleware';

export const persistStorage = createJSONStorage(() => AsyncStorage);

type Persisted = { persist: { hasHydrated: () => boolean; onFinishHydration: (fn: () => void) => () => void } };

/**
 * Espera um store persistido terminar de carregar do AsyncStorage. Se a leitura falhar
 * (o zustand não avisa o fim nesse caso), segue com os padrões depois de `timeoutMs`
 * em vez de deixar o app preso na tela de abertura.
 */
export function hydrated(store: Persisted, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve) => {
    if (store.persist.hasHydrated()) return resolve();
    const done = () => {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    const unsubscribe = store.persist.onFinishHydration(done);
  });
}
