import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { mergeValidated } from '@/lib/merge';
import { persistStorage } from '@/store/storage';

/** Um erro esperando para ir ao servidor (fica salvo se o servidor estiver fora do ar). */
export type PendingReport = {
  id: string;
  at: string;
  source: string;
  message: string;
  stack?: string;
  extra?: string;
  fatal?: boolean;
  /** O mesmo erro repetido em seguida vira um só, com a contagem. */
  count: number;
};

type ErrorReportsState = {
  pending: PendingReport[];
  /** Identificador aleatório desta instalação (para contar em quantos aparelhos o erro aparece). */
  install: string;
  push: (entry: Omit<PendingReport, 'id' | 'count'>) => void;
  drop: (ids: string[]) => void;
  ensureInstall: () => string;
};

const LIMIT = 100;
/** Repetições do mesmo erro dentro deste tempo só aumentam a contagem. */
const MERGE_MS = 60_000;

const randomId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export const useErrorReports = create<ErrorReportsState>()(
  persist(
    (set, get) => ({
      pending: [],
      install: '',
      push: (entry) => {
        const pending = get().pending;
        const last = pending.at(-1);
        if (last && last.source === entry.source && last.message === entry.message && Date.parse(entry.at) - Date.parse(last.at) < MERGE_MS) {
          set({ pending: [...pending.slice(0, -1), { ...last, count: last.count + 1 }] });
          return;
        }
        set({ pending: [...pending, { ...entry, id: randomId(), count: 1 }].slice(-LIMIT) });
      },
      drop: (ids) => {
        const sent = new Set(ids);
        set({ pending: get().pending.filter((entry) => !sent.has(entry.id)) });
      },
      ensureInstall: () => {
        let install = get().install;
        if (!install) {
          install = randomId();
          set({ install });
        }
        return install;
      },
    }),
    { name: 'error-reports', storage: persistStorage, version: 1, merge: mergeValidated }
  )
);
