import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { mergeValidated } from '@/lib/merge';
import type { MediaType } from '@/lib/links';
import { persistStorage } from '@/store/storage';

export type DownloadAction = 'save' | 'convert';
export type DownloadStatus = 'running' | 'saving' | 'converting' | 'done' | 'failed' | 'cancelled';

export type DownloadJob = {
  /** ID do download no sistema (DownloadManager / URLSession). */
  id: string;
  url: string;
  name: string;
  media: MediaType;
  action: DownloadAction;
  /** kbps para converter (0 = original). */
  bitrate: number;
  status: DownloadStatus;
  /** 0 a 1 (download) ou da conversão. */
  progress: number;
  bytes: number;
  total: number;
  error?: string;
  createdAt: number;
};

type DownloadsState = {
  jobs: DownloadJob[];
  add: (job: DownloadJob) => void;
  update: (id: string, patch: Partial<DownloadJob>) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
};

const LIMIT = 100;

/** Lista de downloads (com o histórico dos terminados), salva entre aberturas do app. */
export const useDownloads = create<DownloadsState>()(
  persist(
    (set, get) => ({
      jobs: [],
      add: (job) => set({ jobs: [job, ...get().jobs.filter((j) => j.id !== job.id)].slice(0, LIMIT) }),
      update: (id, patch) => set({ jobs: get().jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) }),
      remove: (id) => set({ jobs: get().jobs.filter((j) => j.id !== id) }),
      clearFinished: () => set({ jobs: get().jobs.filter((j) => j.status === 'running' || j.status === 'saving' || j.status === 'converting') }),
    }),
    { name: 'downloads', storage: persistStorage, version: 1, merge: mergeValidated }
  )
);
