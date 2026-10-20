import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { mergeValidated } from '@/lib/merge';
import { checkPin, hashPin, lockoutMs, makeSalt } from '@/lib/pin';
import { persistStorage } from '@/store/storage';

type VaultState = {
  /** sha256(sal + PIN); vazio = pasta privada ainda não configurada. */
  pinHash: string;
  salt: string;
  biometrics: boolean;
  failures: number;
  lockedUntil: number;
  /** Só na memória: aberta nesta sessão (fecha ao sair do app). */
  unlocked: boolean;
  setPin: (pin: string) => void;
  /** Confere o PIN; devolve 'ok', 'wrong' ou 'locked' (muitas tentativas). */
  tryPin: (pin: string, now?: number) => 'ok' | 'wrong' | 'locked';
  unlock: () => void;
  lock: () => void;
  setBiometrics: (on: boolean) => void;
  reset: () => void;
};

export const useVault = create<VaultState>()(
  persist(
    (set, get) => ({
      pinHash: '',
      salt: '',
      biometrics: false,
      failures: 0,
      lockedUntil: 0,
      unlocked: false,
      setPin: (pin) => {
        const salt = makeSalt();
        set({ salt, pinHash: hashPin(pin, salt), failures: 0, lockedUntil: 0, unlocked: true });
      },
      tryPin: (pin, now = Date.now()) => {
        const { salt, pinHash, failures, lockedUntil } = get();
        if (lockedUntil > now) return 'locked';
        if (checkPin(pin, salt, pinHash)) {
          set({ failures: 0, lockedUntil: 0, unlocked: true });
          return 'ok';
        }
        const next = failures + 1;
        const wait = lockoutMs(next);
        set({ failures: next, lockedUntil: wait ? now + wait : 0 });
        return wait ? 'locked' : 'wrong';
      },
      unlock: () => set({ unlocked: true, failures: 0, lockedUntil: 0 }),
      lock: () => set({ unlocked: false }),
      setBiometrics: (on) => set({ biometrics: on }),
      reset: () => set({ pinHash: '', salt: '', biometrics: false, failures: 0, lockedUntil: 0, unlocked: false }),
    }),
    {
      name: 'vault',
      storage: persistStorage,
      version: 1,
      merge: mergeValidated,
      // A pasta sempre começa fechada.
      partialize: (s) => ({ pinHash: s.pinHash, salt: s.salt, biometrics: s.biometrics, failures: s.failures, lockedUntil: s.lockedUntil }),
    }
  )
);
