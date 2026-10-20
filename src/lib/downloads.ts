import { Platform } from 'react-native';

import { router } from 'expo-router';

import { t } from '@/i18n';
import { onDownloadScreen } from '@/lib/current-route';
import { logError } from '@/lib/errorlog';
import { errorMessage } from '@/lib/errors';
import { cancelJob, serverJobId } from '@/lib/grabber';
import { audioNameFor, classifyLink, extensionOf, fileNameFor, isPageType, mediaTypeOf, playableOnIos, type MediaType } from '@/lib/links';
import RitmoCore from '@/modules/ritmo-core';
import { useDownloads, type DownloadAction, type DownloadJob } from '@/store/downloads';
import { useGrabQueue } from '@/store/grabQueue';
import { useLibrary } from '@/store/library';
import { useUi } from '@/store/ui';

export type LinkInfo =
  | { kind: 'media'; url: string; media: MediaType; name: string; mime: string | null; size: number }
  | { kind: 'blocked'; url: string; service: string }
  | { kind: 'unsupported'; url: string; ext: string }
  | { kind: 'page' | 'invalid'; url: string };

/**
 * Descobre o que é o link: pergunta ao servidor (HEAD) o tipo, o tamanho e o nome do arquivo.
 * Se o servidor não responder ao HEAD, decide só pela extensão.
 */
export async function inspectLink(url: string): Promise<LinkInfo> {
  const first = classifyLink(url);
  if (first.kind === 'blocked') return { kind: 'blocked', url, service: first.service! };
  if (first.kind === 'invalid') return { kind: 'invalid', url };
  let mime: string | null = null;
  let size = -1;
  let disposition: string | null = null;
  let finalUrl = url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
    finalUrl = res.url || url;
    if (res.ok) {
      mime = res.headers.get('content-type');
      const length = Number(res.headers.get('content-length'));
      size = Number.isFinite(length) && length > 0 ? length : -1;
      disposition = res.headers.get('content-disposition');
    }
  } catch {
    // Sem HEAD (servidor recusa ou sem internet): decide pela extensão.
  } finally {
    clearTimeout(timer);
  }
  // Redirecionou para um serviço bloqueado (encurtador de link, por exemplo).
  const final = classifyLink(finalUrl, mime);
  if (final.kind === 'blocked') return { kind: 'blocked', url, service: final.service! };
  if (isPageType(mime)) return { kind: 'page', url };
  const name = fileNameFor(finalUrl, disposition, mime);
  // Pelo tipo ou extensão da URL final, depois pelo nome do arquivo, depois pelo link original.
  const media = final.media ?? mediaTypeOf(null, name) ?? first.media;
  if (!media) return { kind: 'page', url };
  if (Platform.OS === 'ios' && !playableOnIos(name)) return { kind: 'unsupported', url, ext: extensionOf(name) };
  return { kind: 'media', url, media, name, mime: mime?.split(';')[0].trim() || null, size };
}

let poller: ReturnType<typeof setInterval> | undefined;
let convertSub: { remove: () => void } | undefined;

const active = (j: DownloadJob) => j.status === 'running';

/** Começa a baixar. `action: 'convert'` baixa o vídeo e transforma em música no fim. */
export function startDownload(info: Extract<LinkInfo, { kind: 'media' }>, action: DownloadAction, bitrate = 0): string {
  const id = RitmoCore.startDownload(info.url, info.name, info.mime, info.name);
  useDownloads.getState().add({
    id,
    url: info.url,
    name: info.name,
    media: info.media,
    action,
    bitrate,
    status: 'running',
    progress: 0,
    bytes: 0,
    total: info.size,
    createdAt: Date.now(),
  });
  watchDownloads();
  return id;
}

/** Baixa um arquivo que o servidor do Ritmo já preparou (vídeo final ou MP3/M4A). */
export function startUrlDownload(url: string, name: string, mime: string | null, media: MediaType, size = -1): string {
  const id = RitmoCore.startDownload(url, name, mime, name);
  useDownloads.getState().add({
    id,
    url,
    name,
    media,
    action: 'save',
    bitrate: 0,
    status: 'running',
    progress: 0,
    bytes: 0,
    total: size,
    createdAt: Date.now(),
  });
  watchDownloads();
  return id;
}

export function cancelDownload(job: DownloadJob) {
  if (job.status === 'converting') RitmoCore.cancelConversion(job.id);
  else RitmoCore.cancelDownload(job.id);
  useDownloads.getState().update(job.id, { status: 'cancelled' });
  releaseServer(job.url);
}

/**
 * Terminou o último download da fila: leva para a aba certa (Músicas ou Vídeo). Só quando a pessoa
 * está nas telas de download — nunca no meio do player ou de um vídeo — e não a cada música de uma
 * playlist (espera a fila toda acabar).
 */
function openInLibrary(media: MediaType) {
  const stillDownloading =
    useDownloads.getState().jobs.some((j) => j.status === 'running' || j.status === 'saving' || j.status === 'converting') ||
    useGrabQueue.getState().tasks.some((task) => task.status !== 'error');
  if (stillDownloading || !onDownloadScreen()) return;
  useUi.getState().setHomeTab(media === 'video' ? 'videos' : 'songs');
  if (router.canDismiss()) router.dismissAll();
}

/** Arquivo veio do servidor do Ritmo: avisa que acabou, para ele apagar o temporário na hora. */
function releaseServer(url: string) {
  const id = serverJobId(url);
  if (id) void cancelJob(id);
}

/** Tira da lista de downloads do sistema (e apaga o arquivo baixado, se ainda houver). */
function dropNative(id: string) {
  try {
    RitmoCore.cancelDownload(id);
  } catch {
    // Já não existe.
  }
}

/**
 * Ao abrir o app: o que estava salvando ou convertendo morreu junto com o app. Se o arquivo baixado
 * ainda está lá, volta para a fila e é finalizado de novo; senão vira falha.
 */
export function recoverInterrupted() {
  const { jobs, update } = useDownloads.getState();
  const stuck = jobs.filter((j) => j.status === 'saving' || j.status === 'converting');
  if (stuck.length === 0) return;
  let states: ReturnType<typeof RitmoCore.queryDownloads> = [];
  try {
    states = RitmoCore.queryDownloads(stuck.map((j) => j.id));
  } catch (e) {
    logError('Downloads: recuperar', e);
  }
  const byId = new Map(states.map((s) => [s.id, s]));
  for (const job of stuck) {
    const state = byId.get(job.id);
    if (state?.status === 'done' && state.localUri) {
      update(job.id, { status: 'running', progress: 1 });
    } else {
      update(job.id, { status: 'failed', error: t('tools.dl.interrupted') });
      dropNative(job.id);
    }
  }
}

/** Motivo da falha para o usuário. -1022 = o iPhone recusou um link http (sem segurança). */
function failText(reason: number): string {
  return Platform.OS === 'ios' && reason === -1022 ? t('tools.dl.httpsOnly') : t('tools.dl.failed', { code: reason });
}

/** Acompanha os downloads em andamento (a cada segundo) e finaliza os que terminaram. */
export function watchDownloads() {
  convertSub ??= RitmoCore.addListener('onConvertProgress', ({ jobId, progress }) => {
    const job = useDownloads.getState().jobs.find((j) => j.id === jobId);
    if (job?.status === 'converting') useDownloads.getState().update(jobId, { progress: progress / 100 });
  });
  if (poller) return;
  poller = setInterval(tick, 1000);
  tick();
}

function tick() {
  const running = useDownloads.getState().jobs.filter(active);
  if (running.length === 0) {
    clearInterval(poller);
    poller = undefined;
    return;
  }
  let states: ReturnType<typeof RitmoCore.queryDownloads> = [];
  try {
    states = RitmoCore.queryDownloads(running.map((j) => j.id));
  } catch (e) {
    logError('Downloads: consultar', e);
    return;
  }
  const byId = new Map(states.map((s) => [s.id, s]));
  for (const job of running) {
    const state = byId.get(job.id);
    const { update } = useDownloads.getState();
    if (!state) {
      // O sistema não conhece mais (app fechado no iPhone, ou apagado da lista do Android).
      update(job.id, { status: 'failed', error: t('tools.dl.interrupted') });
      continue;
    }
    if (state.status === 'failed') {
      update(job.id, { status: 'failed', error: failText(state.reason) });
      dropNative(job.id);
      continue;
    }
    const total = state.total > 0 ? state.total : job.total;
    update(job.id, { bytes: state.bytes, total, progress: total > 0 ? state.bytes / total : 0 });
    if (state.status === 'done' && state.localUri) void finish(job, state.localUri, state.mime);
  }
}

async function finish(job: DownloadJob, localUri: string, mime: string | null) {
  const { update } = useDownloads.getState();
  try {
    if (job.action === 'convert') {
      update(job.id, { status: 'converting', progress: 0 });
      await RitmoCore.convertToAudio(job.id, localUri, audioNameFor(job.name), job.bitrate);
    } else {
      update(job.id, { status: 'saving' });
      await RitmoCore.saveToLibrary(localUri, job.name, mime ?? null, job.media);
    }
    update(job.id, { status: 'done', progress: 1 });
    releaseServer(job.url);
    useUi.getState().showToast(t('tools.dl.doneToast', { name: job.action === 'convert' ? audioNameFor(job.name) : job.name }));
    const media: MediaType = job.action === 'convert' ? 'audio' : job.media;
    void useLibrary.getState().scan().then(() => openInLibrary(media));
  } catch (e) {
    const cancelled = (e as { code?: string })?.code === 'ERR_CANCELLED';
    if (!cancelled) logError('Downloads: finalizar', e, { ext: extensionOf(job.name) });
    update(job.id, { status: cancelled ? 'cancelled' : 'failed', error: cancelled ? undefined : errorMessage(e) });
  } finally {
    try {
      RitmoCore.deleteLocalFile(localUri);
    } catch {
      // O temporário some com a limpeza do cache do sistema.
    }
    // Tira da lista de downloads do sistema (o arquivo já foi salvo na biblioteca).
    dropNative(job.id);
  }
}
