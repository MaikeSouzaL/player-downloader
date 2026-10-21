/**
 * Regras puras da fila de downloads do motor local (sem React Native): chave estável,
 * retomada depois de fechar o app, tentativas e payload de reinício. Dá para testar no Node.
 */

export type GrabKind = 'video' | 'audio';

/** Estados que a tarefa pode ter na fila. `done`/`error` são terminais. */
export type GrabTaskStatus =
  | 'queued'
  | 'downloading'
  | 'converting'
  | 'saving'
  | 'ready'
  | 'done'
  | 'error'
  | 'cancelled';

export type GrabTaskLike = {
  id: string;
  status: GrabTaskStatus;
  url?: string;
  formatId?: string;
  kind?: GrabKind;
  title?: string;
  hasAudio?: boolean;
  subtitles?: string | null;
  entryId?: string;
  attempts?: number;
};

/** Só o que a lógica precisa de um job do motor local. */
export type NativeJobLike = { id: string; status: string };

/** Quantas vezes uma tarefa perdida pode ser reiniciada sozinha antes de virar erro. */
export const MAX_RESUME_ATTEMPTS = 3;

/** Parâmetros de rastreio que não mudam o vídeo e não entram na chave. */
const TRACKING_PARAMS = new Set(['fbclid', 'gclid', 'igshid', 'mc_cid', 'mc_eid', 'si', 'spm']);

/**
 * URL canônica para comparar links: minúsculas no host/protocolo, sem `www.`, sem fragmento,
 * sem parâmetros de rastreio, consulta ordenada e sem barra no fim. Links do youtu.be viram
 * `youtube.com/watch?v=…` e os do YouTube Music/móvel caem no mesmo host do YouTube para o
 * mesmo vídeo não entrar duas vezes na fila.
 *
 * A URL é remontada a partir dos campos lidos de `URL`/`URLSearchParams`, sem depender dos
 * setters do `URL` do React Native. Se o ambiente não conseguir interpretar o link, o catch
 * devolve o texto como veio.
 */
export function canonicalUrl(raw: string | null | undefined): string {
  const text = (raw ?? '').trim();
  if (!text) return '';
  try {
    // O URL do React Native só reconhece o esquema em minúsculas.
    const prepared = text.replace(/^([a-z][a-z\d+.-]*):/i, (scheme) => scheme.toLowerCase());
    const url = new URL(prepared);
    const protocol = url.protocol.toLowerCase();
    let host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'm.youtube.com' || host === 'music.youtube.com') host = 'youtube.com';
    if ((protocol !== 'http:' && protocol !== 'https:') || !host) return text;

    const port =
      (protocol === 'http:' && url.port === '80') || (protocol === 'https:' && url.port === '443') || !url.port
        ? ''
        : `:${url.port}`;
    let path = url.pathname || '/';
    let params = new URLSearchParams(url.search);

    if (host === 'youtu.be') {
      const id = path.split('/').filter(Boolean)[0];
      if (id) {
        host = 'youtube.com';
        path = '/watch';
        params.set('v', id);
      }
    }

    // Mesmo vídeo aberto pela playlist: `list`/`index`/`t` não mudam o arquivo baixado.
    if (host === 'youtube.com' && params.get('v')) {
      for (const key of ['list', 'index', 'start_radio', 'pp', 'feature', 't']) params.delete(key);
    }

    const clean = new URLSearchParams();
    const entries = [...params.entries()]
      .filter(([key]) => !TRACKING_PARAMS.has(key.toLowerCase()) && !key.toLowerCase().startsWith('utm_'))
      .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
    for (const [key, value] of entries) clean.append(key, value);

    if (path.length > 1) path = path.replace(/\/+$/, '');
    const query = clean.toString();
    return `${protocol}//${host}${port}${path}${query ? `?${query}` : ''}`;
  } catch {
    // Link fora do padrão (texto colado, por exemplo): usa como veio, sem inventar.
    return text;
  }
}

export type GrabKeyParts = {
  url?: string | null;
  entryId?: string | null;
  formatId?: string | null;
  kind?: string | null;
  subtitles?: string | null;
};

/**
 * Chave estável de um download: mesma página + mesmo vídeo da playlist + mesmo formato + tipo
 * + legenda = mesma tarefa. É o que impede dois toques em "Baixar" de criarem dois jobs.
 */
export function grabKey(parts: GrabKeyParts): string {
  return [
    canonicalUrl(parts.url),
    (parts.entryId ?? '').trim(),
    (parts.formatId ?? '').trim(),
    (parts.kind ?? '').trim(),
    (parts.subtitles ?? '').trim(),
  ].join('|');
}

/** Ainda precisa ser acompanhada pelo motor local. */
export function isActive(status: GrabTaskStatus): boolean {
  return status === 'queued' || status === 'downloading' || status === 'converting' || status === 'saving';
}

/** Já terminou (com sucesso, erro ou cancelamento) e pode ser limpa. */
export function isFinished(status: GrabTaskStatus): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled';
}

/** Divide em lotes para não consultar centenas de jobs de uma vez. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const step = Math.floor(size);
  if (!Number.isFinite(step) || step < 1) return items.length ? [[...items]] : [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step));
  return out;
}

export type StartPayload = {
  url: string;
  formatId: string;
  options: {
    subtitles: string | null;
    hasAudio: boolean;
    title: string;
    kind: GrabKind;
  };
};

/** Dados para reiniciar exatamente o mesmo download (ou null se a tarefa é antiga demais). */
export function buildStartPayload(
  task: Pick<GrabTaskLike, 'url' | 'formatId' | 'kind' | 'hasAudio' | 'subtitles' | 'title'>
): StartPayload | null {
  const url = task.url?.trim() ?? '';
  const formatId = task.formatId?.trim() ?? '';
  if (!url || !formatId) return null;
  return {
    url,
    formatId,
    options: {
      subtitles: task.subtitles ?? null,
      hasAudio: !!task.hasAudio,
      title: task.title ?? '',
      kind: task.kind === 'audio' ? 'audio' : 'video',
    },
  };
}

export type ResumeFailReason = 'missing-url' | 'attempts';

export type ResumeDecision =
  | { action: 'skip' }
  | { action: 'adopt'; jobId: string; jobStatus: string }
  | { action: 'handoff'; jobId: string }
  | { action: 'restart'; attempts: number }
  | { action: 'fail'; reason: ResumeFailReason };

const attemptsOf = (task: GrabTaskLike) => Math.max(0, Math.trunc(task.attempts ?? 0));

/**
 * O que fazer quando o motor local não conhece mais o ID da tarefa (app fechou/processo morreu):
 * - tarefa já terminou (done/error/cancelled) fica intocada;
 * - se o job ainda existe, adota (ou entrega o arquivo, se está pronto);
 * - sem URL/formato (tarefa da versão antiga) vira erro acionável;
 * - até 3 tentativas, reinicia; depois vira erro.
 */
export function planResume(task: GrabTaskLike, job?: NativeJobLike | null): ResumeDecision {
  if (!isActive(task.status)) return { action: 'skip' };
  if (job) {
    if (job.status === 'ready') return { action: 'handoff', jobId: job.id };
    return { action: 'adopt', jobId: job.id, jobStatus: job.status };
  }
  if (!task.url?.trim() || !task.formatId?.trim()) return { action: 'fail', reason: 'missing-url' };
  const attempts = attemptsOf(task);
  if (attempts >= MAX_RESUME_ATTEMPTS) return { action: 'fail', reason: 'attempts' };
  return { action: 'restart', attempts: attempts + 1 };
}

/**
 * Toque em "Tentar de novo": primeiro olha se o job ainda existe para não baixar duas vezes.
 * Um retry manual zera as tentativas automáticas.
 */
export function decideRetry(task: GrabTaskLike, job?: NativeJobLike | null): ResumeDecision {
  if (job) {
    if (job.status === 'ready') return { action: 'handoff', jobId: job.id };
    if (isActive(job.status as GrabTaskStatus)) return { action: 'adopt', jobId: job.id, jobStatus: job.status };
  }
  if (!task.url?.trim() || !task.formatId?.trim()) return { action: 'fail', reason: 'missing-url' };
  return { action: 'restart', attempts: 0 };
}

export type ResumeBatchPlan = {
  /** Tarefas que não estavam na lista de perdidas (ou já terminaram) e ficam como estão. */
  keep: string[];
  adopt: { id: string; jobId: string; jobStatus: string }[];
  handoff: { id: string; jobId: string }[];
  restart: { id: string; attempts: number }[];
  fail: { id: string; reason: ResumeFailReason }[];
};

/** Aplica `planResume` só aos IDs que o motor reportou como perdidos. */
export function planResumeBatch(
  tasks: readonly GrabTaskLike[],
  missing: readonly string[],
  jobs: readonly NativeJobLike[] = []
): ResumeBatchPlan {
  const missingSet = new Set(missing);
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const plan: ResumeBatchPlan = { keep: [], adopt: [], handoff: [], restart: [], fail: [] };
  for (const task of tasks) {
    if (!missingSet.has(task.id)) {
      plan.keep.push(task.id);
      continue;
    }
    const decision = planResume(task, byId.get(task.id));
    if (decision.action === 'adopt') plan.adopt.push({ id: task.id, jobId: decision.jobId, jobStatus: decision.jobStatus });
    else if (decision.action === 'handoff') plan.handoff.push({ id: task.id, jobId: decision.jobId });
    else if (decision.action === 'restart') plan.restart.push({ id: task.id, attempts: decision.attempts });
    else if (decision.action === 'fail') plan.fail.push({ id: task.id, reason: decision.reason });
    else plan.keep.push(task.id);
  }
  return plan;
}
