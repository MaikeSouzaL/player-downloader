import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

/**
 * Registro de erros local (Ajustes › Sobre › Registro de erros). Quem quiser também recebe cada
 * erro na hora (`onErrorLogged`); o relatório é montado no próprio aparelho e nunca é enviado
 * para fora (`lib/error-report.ts`).
 */
const MAX_BYTES = 200_000;

/** Um erro como sai do app (mensagem, onde aconteceu, pilha completa). */
export type LoggedError = {
  at: string;
  source: string;
  message: string;
  stack?: string;
  extra?: string;
  fatal?: boolean;
};

const listeners = new Set<(entry: LoggedError) => void>();

/** Recebe cada erro registrado. Devolve a função para parar. */
export function onErrorLogged(listener: (entry: LoggedError) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const dir = () => new Directory(Paths.document, 'logs');
const file = () => new File(dir(), 'erros.log');

let queue: Promise<void> = Promise.resolve();

/** JSON.stringify que nunca lança (objetos circulares, BigInt…). */
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function logError(source: string, error: unknown, extra?: Record<string, unknown>, fatal = false) {
  const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : safeJson(error));
  const at = new Date().toISOString();
  const logged: LoggedError = {
    at,
    source,
    message: err.message || String(error),
    stack: err.stack ? err.stack.slice(0, 8000) : undefined,
    extra: extra && Object.keys(extra).length ? safeJson(extra).slice(0, 4000) : undefined,
    fatal: fatal || undefined,
  };
  for (const listener of listeners) {
    try {
      listener(logged);
    } catch {
      // Quem escuta nunca pode quebrar o registro.
    }
  }
  const lines = [
    `[${at}] ${source}: ${err.message}`,
    extra && Object.keys(extra).length ? `  ${safeJson(extra)}` : null,
    err.stack ? err.stack.split('\n').slice(1, 6).map((l) => `  ${l.trim()}`).join('\n') : null,
  ].filter(Boolean);
  const entry = `${lines.join('\n')}\n`;
  // Gravações em fila para não se atropelarem; falha ao gravar o log nunca derruba o app.
  queue = queue
    .then(async () => {
      const d = dir();
      if (!d.exists) d.create({ intermediates: true });
      const f = file();
      let current = f.exists ? await f.text() : '';
      if (current.length > MAX_BYTES) current = current.slice(-MAX_BYTES / 2);
      if (!f.exists) f.create();
      await f.write(current + entry);
    })
    .catch(() => {});
}

export async function readErrorLog(): Promise<string> {
  await queue;
  const f = file();
  return f.exists ? f.text() : '';
}

export function clearErrorLog() {
  queue = queue.then(() => {
    const f = file();
    if (f.exists) f.delete();
  });
  return queue;
}

/** Arquivo pronto para compartilhar, com o cabeçalho do aparelho. */
export async function errorLogForSharing(): Promise<string | null> {
  const body = await readErrorLog();
  if (!body.trim()) return null;
  const header = [
    `Player Downloader ${Constants.expoConfig?.version ?? ''}`,
    `${Platform.OS === 'ios' ? 'iOS' : 'Android'} ${Platform.Version}`,
    `Gerado em ${new Date().toISOString()}`,
    '',
  ].join('\n');
  const out = new File(Paths.cache, 'PlayerDownloader-erros.txt');
  if (out.exists) out.delete();
  out.create();
  await out.write(header + body);
  return out.uri;
}

type GlobalErrorUtils = {
  getGlobalHandler: () => (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => void;
};

let installed = false;

/** Guarda erros JS não tratados (inclusive promessas rejeitadas) e mantém o comportamento padrão. */
export function installGlobalErrorLogging() {
  if (installed) return;
  installed = true;
  const utils = (globalThis as { ErrorUtils?: GlobalErrorUtils }).ErrorUtils;
  if (utils) {
    const previous = utils.getGlobalHandler();
    utils.setGlobalHandler((error, isFatal) => {
      logError(isFatal ? 'Erro fatal' : 'Erro', error, undefined, !!isFatal);
      previous(error, isFatal);
    });
  }
  const hermes = (globalThis as { HermesInternal?: { enablePromiseRejectionTracker?: (o: unknown) => void } }).HermesInternal;
  hermes?.enablePromiseRejectionTracker?.({
    allRejections: true,
    onUnhandled: (_id: number, error: unknown) => logError('Promessa rejeitada', error),
  });
}
