import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { t } from '@/i18n';
import { grabKey, isActive, isFinished, type GrabKind, type GrabTaskStatus } from '@/lib/grab-queue-logic';
import type { MediaType } from '@/lib/links';
import { mergeValidated } from '@/lib/merge';
import { persistStorage } from '@/store/storage';

/**
 * Downloads que o motor local ainda está preparando (baixando do site, juntando, convertendo).
 * Ficam salvos com tudo o que é preciso para retomar depois de fechar o app. Quando o arquivo
 * fica pronto, vira um download normal do celular e sai daqui.
 */
export type GrabTask = {
  /** ID atual do job no motor local (muda quando a tarefa é reiniciada). */
  id: string;
  /** Chave estável: URL canônica + vídeo da playlist + formato + tipo + legenda. */
  key: string;
  title: string;
  media: MediaType;
  status: GrabTaskStatus;
  progress: number;
  stage?: string;
  error?: string;
  /** URL da página/vídeo usada para reiniciar o download. */
  url?: string;
  formatId?: string;
  kind?: GrabKind;
  hasAudio?: boolean;
  subtitles?: string | null;
  entryId?: string;
  /** Quantas vezes a tarefa já foi reiniciada automaticamente. */
  attempts: number;
  batchId?: string;
  createdAt: number;
};

type GrabQueueState = {
  tasks: GrabTask[];
  /** Devolve quantas tarefas realmente entraram (as duplicadas por key ficam de fora). */
  add: (tasks: GrabTask[]) => number;
  update: (id: string, patch: Partial<GrabTask>) => void;
  /** Troca o ID de um job reiniciado sem mudar a posição da tarefa na fila. */
  adopt: (oldId: string, newId: string, patch: Partial<GrabTask>) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
};

const LIMIT = 300;

const STATUSES: GrabTaskStatus[] = ['queued', 'downloading', 'converting', 'saving', 'ready', 'done', 'error', 'cancelled'];

function statusOf(value: unknown): GrabTaskStatus {
  return typeof value === 'string' && (STATUSES as string[]).includes(value) ? (value as GrabTaskStatus) : 'queued';
}

/**
 * Versão 1: a tarefa só guardava o ID do job. Sem URL/formato não há como retomar depois que o
 * processo do motor morre; vira erro com instrução clara em vez de tentar para sempre.
 */
function migrateTasks(value: unknown): GrabTask[] {
  if (!Array.isArray(value)) return [];
  const now = Date.now();
  return value.flatMap((raw, index): GrabTask[] => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id : '';
    if (!id) return [];

    const url = typeof item.url === 'string' && item.url.trim() ? item.url.trim() : undefined;
    const formatId = typeof item.formatId === 'string' && item.formatId.trim() ? item.formatId.trim() : undefined;
    const entryId = typeof item.entryId === 'string' && item.entryId ? item.entryId : undefined;
    const kind: GrabKind | undefined = item.kind === 'audio' || item.kind === 'video' ? item.kind : undefined;
    const subtitles = typeof item.subtitles === 'string' ? item.subtitles : null;
    const needsRelink = !url || !formatId;

    return [
      {
        id,
        key:
          typeof item.key === 'string' && item.key
            ? item.key
            : needsRelink
              ? `legacy:${id}`
              : grabKey({ url, entryId, formatId, kind, subtitles }),
        title: typeof item.title === 'string' ? item.title : '',
        media: item.media === 'video' ? 'video' : 'audio',
        status: needsRelink ? 'error' : statusOf(item.status),
        progress:
          typeof item.progress === 'number' && Number.isFinite(item.progress) ? Math.min(1, Math.max(0, item.progress)) : 0,
        stage: typeof item.stage === 'string' ? item.stage : undefined,
        error: needsRelink ? t('tools.grab.needRelink') : typeof item.error === 'string' ? item.error : undefined,
        url,
        formatId,
        kind,
        hasAudio: item.hasAudio === true,
        subtitles,
        entryId,
        attempts:
          typeof item.attempts === 'number' && Number.isFinite(item.attempts) ? Math.max(0, Math.trunc(item.attempts)) : 0,
        batchId: typeof item.batchId === 'string' ? item.batchId : undefined,
        createdAt:
          typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : now + index,
      },
    ];
  });
}

/** Lista de downloads do motor local, salva entre aberturas do app. */
export const useGrabQueue = create<GrabQueueState>()(
  persist(
    (set, get) => ({
      tasks: [],
      add: (tasks) => {
        if (tasks.length === 0) return 0;
        const existing = get().tasks;
        const activeKeys = new Set(
          existing.filter((task) => isActive(task.status) || task.status === 'ready').map((task) => task.key)
        );
        const seen = new Set<string>();
        const fresh = tasks.filter((task) => {
          if (!task.key || seen.has(task.key) || activeKeys.has(task.key)) return false;
          seen.add(task.key);
          return true;
        });
        if (fresh.length === 0) return 0;

        const freshKeys = new Set(fresh.map((task) => task.key));
        const freshIds = new Set(fresh.map((task) => task.id));
        // Uma tarefa terminada com a mesma key é substituída pelo download novo, sem duplicar.
        let next = [...fresh, ...existing.filter((task) => !freshKeys.has(task.key) && !freshIds.has(task.id))];
        while (next.length > LIMIT) {
          const index = next.findLastIndex((task) => isFinished(task.status));
          if (index < 0) break;
          next = next.filter((_, i) => i !== index);
        }
        set({ tasks: next });
        return fresh.length;
      },
      update: (id, patch) => set({ tasks: get().tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)) }),
      adopt: (oldId, newId, patch) => {
        // Se esse ID já existir, a tarefa antiga é a que fica no lugar (nunca duas iguais).
        const tasks = get().tasks.filter((task) => task.id !== newId || task.id === oldId);
        set({ tasks: tasks.map((task) => (task.id === oldId ? { ...task, ...patch, id: newId } : task)) });
      },
      remove: (id) => set({ tasks: get().tasks.filter((task) => task.id !== id) }),
      clearFinished: () =>
        set({ tasks: get().tasks.filter((task) => isActive(task.status) || task.status === 'ready') }),
    }),
    {
      name: 'grab-queue',
      storage: persistStorage,
      version: 2,
      migrate: (persisted, version) => {
        if (version >= 2) return persisted as GrabQueueState;
        const state = (persisted ?? {}) as { tasks?: unknown };
        return { ...state, tasks: migrateTasks(state.tasks) } as GrabQueueState;
      },
      merge: mergeValidated,
    }
  )
);
