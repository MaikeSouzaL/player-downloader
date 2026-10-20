import { t } from '@/i18n';
import { startUrlDownload } from '@/lib/downloads';
import { logError } from '@/lib/errorlog';
import { errorMessage } from '@/lib/errors';
import { cancelJob, grabEnabled, jobFileUrl, jobsStatus, type GrabJob, type GrabStarted } from '@/lib/grabber';
import type { MediaType } from '@/lib/links';
import { useGrabQueue, type GrabTask } from '@/store/grabQueue';

/**
 * Fila do servidor: acompanha os downloads que o servidor está preparando (um vídeo ou uma
 * playlist inteira) e, quando cada arquivo fica pronto, passa para o download do celular.
 */

const POLL_MS = 1500;
const CHUNK = 80;
/** Sem resposta do servidor por tanto tempo: as tarefas viram erro (em vez de esperar para sempre). */
const GIVE_UP_MS = 10 * 60_000;

let poller: ReturnType<typeof setInterval> | undefined;
let busy = false;
let failingSince = 0;

/** Coloca na fila o que o servidor aceitou (um ou vários downloads). */
export function enqueueGrab(started: GrabStarted, title: string, media: MediaType) {
  const jobs = started.jobs?.length ? started.jobs : [{ id: started.id, entryId: '', title }];
  const now = Date.now();
  useGrabQueue.getState().add(
    jobs.map((job, index) => ({
      id: job.id,
      title: job.title || title,
      media,
      status: 'queued' as const,
      progress: 0,
      batchId: started.batchId,
      createdAt: now + index,
    }))
  );
  watchGrabQueue();
}

export function cancelGrab(task: GrabTask) {
  if (task.status !== 'error') void cancelJob(task.id);
  useGrabQueue.getState().remove(task.id);
}

/** Começa a acompanhar (na abertura do app retoma o que ficou na fila). */
export function watchGrabQueue() {
  if (poller) return;
  poller = setInterval(() => void tick(), POLL_MS);
  void tick();
}

function stop() {
  clearInterval(poller);
  poller = undefined;
}

function handOff(task: GrabTask, job: GrabJob) {
  const { remove, update } = useGrabQueue.getState();
  const file = job.file;
  // Pronto sem os dados do arquivo (resposta pela metade): espera o próximo ciclo.
  if (!file) return;
  // Cancelado no app enquanto o pedido estava no ar: o servidor já apagou, não baixa.
  if (!useGrabQueue.getState().tasks.some((current) => current.id === task.id)) return;
  try {
    startUrlDownload(jobFileUrl(job.id), file.name, file.mime, task.media, file.size);
    remove(task.id);
  } catch (e) {
    logError('Servidor: passar para o celular', e, { mime: file.mime });
    update(task.id, { status: 'error', error: errorMessage(e) });
  }
}

async function tick() {
  if (busy) return;
  const active = useGrabQueue.getState().tasks.filter((task) => task.status !== 'error');
  if (active.length === 0) {
    stop();
    return;
  }
  if (!grabEnabled()) {
    stop(); // volta a acompanhar quando o servidor for configurado (watchGrabQueue)
    return;
  }
  busy = true;
  try {
    for (let i = 0; i < active.length; i += CHUNK) {
      const slice = active.slice(i, i + CHUNK);
      const { jobs, missing } = await jobsStatus(slice.map((task) => task.id));
      const byId = new Map(slice.map((task) => [task.id, task]));
      const { update, remove } = useGrabQueue.getState();
      for (const job of jobs) {
        const task = byId.get(job.id);
        if (!task) continue;
        if (job.status === 'ready') handOff(task, job);
        else if (job.status === 'error') update(task.id, { status: 'error', error: job.error || t('tools.grab.failed') });
        else if (job.status === 'cancelled') remove(task.id);
        else update(task.id, { status: job.status, progress: job.progress, stage: job.stage });
      }
      // O servidor reiniciou (ou o arquivo venceu): não há o que esperar.
      for (const id of missing) update(id, { status: 'error', error: t('tools.grab.lost') });
    }
    failingSince = 0;
  } catch (e) {
    // Servidor fora do alcance (PC desligado, outra rede) ou chave errada: tenta de novo, mas não para sempre.
    const now = Date.now();
    failingSince ||= now;
    const auth = /chave/i.test(errorMessage(e));
    if (auth || now - failingSince > GIVE_UP_MS) {
      const { update } = useGrabQueue.getState();
      for (const task of active) update(task.id, { status: 'error', error: errorMessage(e) });
      failingSince = 0;
    }
  } finally {
    busy = false;
  }
}
