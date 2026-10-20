import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { MediaType } from '@/lib/links';
import { mergeValidated } from '@/lib/merge';
import { persistStorage } from '@/store/storage';

/**
 * Downloads que o servidor ainda está preparando (baixando do site, juntando, convertendo).
 * Quando o arquivo fica pronto, vira um download normal do celular e sai daqui.
 */
export type GrabTask = {
  /** ID do download no servidor. */
  id: string;
  title: string;
  media: MediaType;
  status: 'queued' | 'downloading' | 'converting' | 'error';
  progress: number;
  stage?: string;
  error?: string;
  batchId?: string;
  createdAt: number;
};

type GrabQueueState = {
  tasks: GrabTask[];
  add: (tasks: GrabTask[]) => void;
  update: (id: string, patch: Partial<GrabTask>) => void;
  remove: (id: string) => void;
  clearErrors: () => void;
};

const LIMIT = 300;

export const useGrabQueue = create<GrabQueueState>()(
  persist(
    (set, get) => ({
      tasks: [],
      add: (tasks) => {
        const ids = new Set(tasks.map((task) => task.id));
        let next = [...tasks, ...get().tasks.filter((task) => !ids.has(task.id))];
        // Passou do limite: some primeiro o que já deu erro (nunca uma tarefa ainda em andamento).
        while (next.length > LIMIT) {
          const index = next.findLastIndex((task) => task.status === 'error');
          if (index < 0) break;
          next = next.filter((_, i) => i !== index);
        }
        set({ tasks: next });
      },
      update: (id, patch) => set({ tasks: get().tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)) }),
      remove: (id) => set({ tasks: get().tasks.filter((task) => task.id !== id) }),
      clearErrors: () => set({ tasks: get().tasks.filter((task) => task.status !== 'error') }),
    }),
    { name: 'grab-queue', storage: persistStorage, version: 1, merge: mergeValidated }
  )
);
