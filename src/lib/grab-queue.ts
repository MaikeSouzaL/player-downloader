import { t } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { cancelJob, grabEnabled, jobsStatus, startJob, type GrabJob, type GrabStarted } from '@/lib/grabber';
import {
  buildStartPayload,
  canonicalUrl,
  chunk,
  decideRetry,
  grabKey,
  isActive,
  planResumeBatch,
  type GrabTaskStatus,
  type ResumeFailReason,
} from '@/lib/grab-queue-logic';
import type { MediaType } from '@/lib/links';
import { useGrabQueue, type GrabTask } from '@/store/grabQueue';
import { useLibrary } from '@/store/library';
import { useUi } from '@/store/ui';

/**
 * Fila do motor local: acompanha os downloads que o yt-dlp embutido está preparando (um vídeo ou
 * uma playlist inteira) e, quando cada arquivo fica salvo na biblioteca, tira a tarefa da lista.
 * A tarefa guarda URL/formato para poder ser retomada se o app for fechado no meio.
 */

const POLL_MS = 1500;
const CHUNK = 80;
/** Sem resposta do motor local por tanto tempo: as tarefas viram erro (em vez de esperar para sempre). */
const GIVE_UP_MS = 10 * 60_000;

let poller: ReturnType<typeof setInterval> | undefined;
let queueSubscription: (() => void) | undefined;
let busy = false;
let failingSince = 0;

/** Chaves reservadas no toque em "Baixar" (antes do startJob terminar). */
const inflightKeys = new Set<string>();
/** Evita dois reinícios simultâneos da mesma tarefa (poller + botão "Tentar de novo"). */
const restarting = new Set<string>();
const retrying = new Set<string>();

export type GrabEnqueueContext = {
  /** Página do vídeo/playlist (fallback quando o motor não devolve a URL do job). */
  url: string;
  formatId: string;
  kind: 'video' | 'audio';
  hasAudio?: boolean;
  subtitles?: string | null;
  /** entryId → URL de cada vídeo escolhido na playlist. */
  entries?: { id: string; url: string }[];
};

/**
 * Tarefas que bloqueiam um novo download igual. A cancelada também bloqueia enquanto o motor
 * ainda não confirmou o cancelamento: senão o usuário poderia iniciar outro download e os dois
 * processos gravar o mesmo arquivo.
 */
const blocksDuplicate = (status: GrabTaskStatus) => isActive(status) || status === 'ready' || status === 'cancelled';
/**
 * Tarefas que o poller ainda precisa consultar. A cancelada fica na fila até o motor confirmar
 * `cancelled`/`missing`; só então some.
 */
const needsPolling = (status: GrabTaskStatus) =>
  isActive(status) || status === 'ready' || status === 'cancelled';

/**
 * Reserva as keys antes de chamar o motor local. Se outra tarefa igual já está na fila (ou
 * sendo iniciada), o toque é ignorado — dois toques em "Baixar" não criam dois jobs.
 */
export function reserveGrabKeys(keys: string[]): boolean {
  const unique = [...new Set(keys.filter(Boolean))];
  if (unique.length === 0) return false;
  const activeKeys = new Set(
    useGrabQueue
      .getState()
      .tasks.filter((task) => blocksDuplicate(task.status))
      .map((task) => task.key)
  );
  if (unique.some((key) => inflightKeys.has(key) || activeKeys.has(key))) return false;
  for (const key of unique) inflightKeys.add(key);
  return true;
}

/** Libera a reserva quando o startJob terminou (ou falhou) e a tarefa já está na fila. */
export function releaseGrabKeys(keys: string[]) {
  for (const key of keys) inflightKeys.delete(key);
}

/** Coloca na fila o que o motor local aceitou (um ou vários downloads). Devolve quantos entraram. */
export function enqueueGrab(started: GrabStarted, title: string, media: MediaType, context: GrabEnqueueContext): number {
  const jobs = started.jobs?.length ? started.jobs : [{ id: started.id, entryId: '', title }];
  const entryUrls = new Map((context.entries ?? []).map((entry) => [entry.id, entry.url]));
  const entryIds = new Map((context.entries ?? []).map((entry) => [canonicalUrl(entry.url), entry.id]));
  const now = Date.now();
  const tasks: GrabTask[] = jobs.map((job, index) => {
    // Versões novas do motor podem mandar a URL do job; sem ela, o entryId/URL da página resolve.
    const entryId = job.entryId || (job.url ? (entryIds.get(canonicalUrl(job.url)) ?? '') : '');
    const url = job.url || entryUrls.get(entryId) || context.url;
    return {
      id: job.id,
      key: grabKey({ url, entryId, formatId: context.formatId, kind: context.kind, subtitles: context.subtitles }),
      title: job.title || title,
      media,
      status: 'queued' as const,
      progress: 0,
      url: url || undefined,
      formatId: context.formatId,
      kind: context.kind,
      hasAudio: !!context.hasAudio,
      subtitles: context.subtitles ?? null,
      entryId: entryId || undefined,
      attempts: 0,
      batchId: started.batchId,
      createdAt: now + index,
    };
  });
  const added = useGrabQueue.getState().add(tasks);
  // Corrida/duplo toque que passou pela reserva: não deixa o job repetido baixando escondido.
  const before = useGrabQueue.getState().tasks;
  const seen = new Set<string>();
  for (const task of tasks) {
    const duplicated =
      seen.has(task.key) ||
      before.some((current) => current.id !== task.id && current.key === task.key && blocksDuplicate(current.status));
    if (duplicated) void cancelJob(task.id);
    seen.add(task.key);
  }
  watchGrabQueue();
  return added;
}

/** Acha a versão atual da tarefa (o ID pode ter mudado numa retomada enquanto a tela estava aberta). */
function findTask(task: GrabTask): GrabTask | undefined {
  const tasks = useGrabQueue.getState().tasks;
  const byId = tasks.find((current) => current.id === task.id);
  if (byId) return byId;
  // Só tarefas em andamento podem ter trocado de ID (adopt). Uma linha de erro antiga não pode
  // cancelar um download novo que por acaso usa a mesma key.
  if (!task.key || !isActive(task.status)) return undefined;
  return tasks.find((current) => current.key === task.key && isActive(current.status));
}

export function cancelGrab(task: GrabTask) {
  const current = findTask(task);
  if (!current) return;
  if (isActive(current.status)) {
    // Fica como "cancelada" na fila até o motor confirmar (cancelled/missing); assim a fila só
    // considera o cancelamento concluído quando o processo antigo realmente parou.
    void cancelJob(current.id);
    useGrabQueue.getState().update(current.id, { status: 'cancelled', error: undefined, stage: undefined });
    watchGrabQueue();
    return;
  }
  // Já cancelada há mais de um tick: o usuário tocou em remover. Reforça o pedido ao motor antes
  // de tirar a linha, para não deixar um download fantasma rodando sem UI.
  if (current.status === 'cancelled') void cancelJob(current.id);
  useGrabQueue.getState().remove(current.id);
}

/**
 * A fila é hidratada do AsyncStorage depois da abertura. Se o primeiro tick viu tudo vazio e
 * parou, esta assinatura religa o poller quando chegar uma tarefa que ainda precisa acompanhar.
 */
function ensureQueueSubscription() {
  if (queueSubscription) return;
  queueSubscription = useGrabQueue.subscribe((state) => {
    if (poller !== undefined) return;
    if (!state.tasks.some((task) => needsPolling(task.status))) return;
    watchGrabQueue();
  });
}

/** Começa a acompanhar (na abertura do app retoma o que ficou na fila). */
export function watchGrabQueue() {
  ensureQueueSubscription();
  if (poller !== undefined) return;
  poller = setInterval(() => void tick(), POLL_MS);
  void tick();
}

function stop() {
  clearInterval(poller);
  poller = undefined;
  // Uma falha de uma fila antiga não pode encurtar o prazo da próxima.
  failingSince = 0;
}

function handOff(task: GrabTask, job: GrabJob): boolean {
  const { tasks, remove } = useGrabQueue.getState();
  const file = job.file;
  // Pronto sem os dados do arquivo (resposta pela metade/journal): espera o próximo ciclo.
  if (!file) return false;
  const current = tasks.find((entry) => entry.id === task.id);
  // Cancelado no app enquanto o download estava no ar: não avisa "salvo" (mas o arquivo existe).
  if (!current) return false;
  // O motor local já gravou o arquivo na biblioteca (MediaStore); só tira da fila e atualiza.
  remove(task.id);
  if (current.status !== 'cancelled') useUi.getState().showToast(t('tools.grab.savedInLibrary', { name: file.name }));
  void useLibrary.getState().scan();
  return true;
}

function taskStatusOf(status: GrabJob['status']): GrabTaskStatus {
  if (status === 'queued' || status === 'converting' || status === 'saving') return status;
  if (status === 'ready' || status === 'done' || status === 'error' || status === 'cancelled') return status;
  return 'downloading';
}

function applyJob(task: GrabTask, job: GrabJob) {
  const { update, remove } = useGrabQueue.getState();
  if (task.status === 'cancelled') {
    // Cancelamento pedido: só sai quando o motor confirma. Enquanto ele ainda estiver rodando,
    // mantém "Cancelado" e repete o pedido (sem deixar o job virar um download fantasma).
    if (job.status === 'cancelled' || job.status === 'error' || job.status === 'done') {
      remove(task.id);
      return;
    }
    if (job.status === 'ready') {
      handOff(task, job);
      return;
    }
    void cancelJob(task.id);
    return;
  }
  if (job.status === 'ready') {
    // Sem `file` (journal ainda gravando) a tarefa fica na fila: o próximo tick tenta de novo e,
    // se o motor perder o job, a retomada decide o que fazer.
    handOff(task, job);
    return;
  }
  if (job.status === 'error') {
    update(task.id, { status: 'error', error: job.error || t('tools.grab.failed'), progress: 0 });
    return;
  }
  if (job.status === 'cancelled') {
    remove(task.id);
    return;
  }
  const saving = job.status === 'converting' && /salvando|saving|guardando/i.test(job.stage ?? '');
  const status = saving ? 'saving' : taskStatusOf(job.status);
  update(task.id, {
    status,
    progress: status === 'done' ? 1 : Math.min(1, Math.max(0, job.progress ?? 0)),
    stage: job.stage,
  });
}

function resumeFailText(reason: ResumeFailReason): string {
  return reason === 'missing-url' ? t('tools.grab.needRelink') : t('tools.grab.tooManyAttempts');
}

function failTask(task: GrabTask, reason: ResumeFailReason) {
  useGrabQueue.getState().update(task.id, { status: 'error', error: resumeFailText(reason), progress: 0 });
}

/**
 * Reinicia a tarefa com o mesmo formato/URL. O novo ID do motor entra na mesma posição da fila
 * (adopt), então não aparece um download duplicado. Se a tarefa foi cancelada enquanto o motor
 * iniciava, o job recém-criado é cancelado.
 */
async function restartGrab(task: GrabTask, attempts: number, allowFinished = false): Promise<boolean> {
  if (restarting.has(task.id)) return false;
  const payload = buildStartPayload(task);
  if (!payload) {
    failTask(task, 'missing-url');
    return false;
  }
  restarting.add(task.id);
  try {
    const started = await startJob(payload.url, payload.formatId, payload.options);
    const newId = started.jobs?.[0]?.id ?? started.id;
    const live = useGrabQueue.getState().tasks.find((current) => current.id === task.id);
    const stillWanted = !!live && (isActive(live.status) || (allowFinished && live.status === 'error'));
    if (!stillWanted) {
      // Cancelado/removido durante o startJob: não deixa baixando escondido.
      void cancelJob(newId);
      return false;
    }
    useGrabQueue.getState().adopt(task.id, newId, {
      status: 'queued',
      progress: 0,
      stage: undefined,
      error: undefined,
      attempts,
      batchId: started.batchId ?? task.batchId,
    });
    return true;
  } catch (e) {
    const live = useGrabQueue.getState().tasks.find((current) => current.id === task.id);
    if (live && (isActive(live.status) || live.status === 'error')) {
      useGrabQueue.getState().update(task.id, { status: 'error', error: errorMessage(e) || t('tools.grab.failed') });
    }
    return false;
  } finally {
    restarting.delete(task.id);
  }
}

async function tick() {
  if (busy) return;
  const active = useGrabQueue.getState().tasks.filter((task) => needsPolling(task.status));
  if (active.length === 0) {
    stop();
    return;
  }
  if (!grabEnabled()) {
    stop(); // iOS/versão sem motor local: não há o que acompanhar
    return;
  }
  busy = true;
  try {
    for (const slice of chunk(active, CHUNK)) {
      const { jobs, missing } = await jobsStatus(slice.map((task) => task.id));
      const byId = new Map(slice.map((task) => [task.id, task]));
      const jobById = new Map(jobs.map((job) => [job.id, job]));

      for (const job of jobs) {
        const task = byId.get(job.id);
        if (task) applyJob(task, job);
      }

      // Só as tarefas que o motor perdeu entram na retomada; done/error ficam intocadas.
      // Canceladas somem assim que o motor confirma que não conhece mais o job.
      const pendingMissing = missing.filter((id) => {
        const live = useGrabQueue.getState().tasks.find((current) => current.id === id);
        if (live?.status !== 'cancelled') return true;
        useGrabQueue.getState().remove(id);
        return false;
      });
      const plan = planResumeBatch(slice, pendingMissing, jobs);
      for (const item of plan.restart) {
        const task = byId.get(item.id);
        if (!task) continue;
        const live = useGrabQueue.getState().tasks.find((current) => current.id === task.id);
        if (!live || !isActive(live.status)) continue; // cancelada nesse meio-tempo
        await restartGrab(live, item.attempts);
      }
      for (const item of plan.fail) {
        const live = useGrabQueue.getState().tasks.find((current) => current.id === item.id);
        if (live && isActive(live.status)) failTask(live, item.reason);
      }
      for (const item of plan.adopt) {
        const job = jobById.get(item.jobId);
        const live = useGrabQueue.getState().tasks.find((current) => current.id === item.id);
        if (job && live && isActive(live.status)) applyJob(live, job);
      }
      for (const item of plan.handoff) {
        const job = jobById.get(item.jobId);
        const live = useGrabQueue.getState().tasks.find((current) => current.id === item.id);
        if (job && live) handOff(live, job);
      }
    }
    failingSince = 0;
  } catch (e) {
    // Motor local falhou (processo encerrado, aparelho sem memória): tenta de novo, mas não para sempre.
    const now = Date.now();
    failingSince ||= now;
    if (now - failingSince > GIVE_UP_MS) {
      const { update, remove } = useGrabQueue.getState();
      for (const task of useGrabQueue.getState().tasks.filter((current) => needsPolling(current.status))) {
        // Cancelada sem confirmação do motor: não há o que recuperar; some para o poller parar.
        if (task.status === 'cancelled') remove(task.id);
        else update(task.id, { status: 'error', error: errorMessage(e) || t('tools.grab.failed') });
      }
      failingSince = 0;
    }
  } finally {
    busy = false;
  }
}

/**
 * "Tentar de novo" de uma tarefa com erro: consulta o motor antes para não recriar um job que
 * ainda existe; se o job sumiu, reinicia com a URL/formato guardados.
 */
export async function retryGrab(task: GrabTask) {
  const found = findTask(task);
  if (!found || retrying.has(found.id)) return;
  const live = found;
  retrying.add(live.id);
  try {
    if (!grabEnabled()) {
      useGrabQueue.getState().update(live.id, { status: 'error', error: t('tools.grab.androidOnlyText') });
      return;
    }

    let job: GrabJob | undefined;
    try {
      const result = await jobsStatus([live.id]);
      job = result.jobs.find((current) => current.id === live.id);
    } catch (e) {
      // Motor indisponível: mantém o erro com a mensagem real, sem iniciar outro download.
      useGrabQueue.getState().update(live.id, { status: 'error', error: errorMessage(e) || t('tools.grab.failed') });
      return;
    }

    const decision = decideRetry(live, job);
    if (decision.action === 'handoff') {
      if (job) {
        const handedOff = handOff(live, job);
        // Journal pronto mas ainda sem `file`: volta a acompanhar em vez de deixar a tarefa
        // parada em erro. Se o job sumir, a retomada normal decide.
        if (!handedOff && job.status === 'ready' && !job.file) {
          useGrabQueue.getState().update(live.id, {
            status: 'queued',
            progress: job.progress ?? live.progress,
            stage: job.stage,
          });
          watchGrabQueue();
        }
      }
      return;
    }
    if (decision.action === 'adopt') {
      if (job) applyJob(live, job);
      watchGrabQueue();
      return;
    }
    if (decision.action === 'fail') {
      failTask(live, decision.reason);
      return;
    }
    if (decision.action === 'skip') return;
    // Job antigo existe mas terminou: limpa antes de criar outro com o mesmo formato.
    if (job) void cancelJob(job.id);
    if (await restartGrab(live, decision.attempts, true)) watchGrabQueue();
  } finally {
    retrying.delete(live.id);
  }
}
