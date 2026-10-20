import Constants from 'expo-constants';
import { AppState, Platform } from 'react-native';

import { currentLang } from '@/i18n';
import { logError, onErrorLogged, type LoggedError } from '@/lib/errorlog';
import { grabEnabled, serverKey, serverUrl } from '@/lib/grabber';
import RitmoCore from '@/modules/ritmo-core';
import { useErrorReports } from '@/store/errorReports';
import { useSettings } from '@/store/settings';

/**
 * Relatório de erros: todo erro registrado pelo app (telas, player, downloads, erros não
 * tratados e crashes nativos) vai para o servidor do Ritmo, que guarda para a gente corrigir.
 * Vai só a mensagem, onde aconteceu, a pilha, a versão do app e o modelo do aparelho —
 * nunca músicas nem arquivos. Sem servidor (ou desligado em Ajustes) fica só no registro local.
 */

const BATCH = 50;
const FIRST_FLUSH_MS = 3000;
const FLUSH_MS = 4000;
const RETRY_MS = 60_000;
/** Origem dos erros do próprio envio: não entram de novo (evita laço). */
const SELF = 'Relatório de erros';

let timer: ReturnType<typeof setTimeout> | undefined;
let sending = false;

function deviceInfo() {
  const constants = (Platform.constants ?? {}) as { Model?: string; Manufacturer?: string; Brand?: string; interfaceIdiom?: string };
  const config = Constants.expoConfig;
  return {
    app: 'ritmo',
    version: config?.version ?? '',
    build: String((Platform.OS === 'ios' ? config?.ios?.buildNumber : config?.android?.versionCode) ?? ''),
    platform: Platform.OS,
    os: String(Platform.Version),
    model: [constants.Manufacturer ?? constants.Brand, constants.Model].filter(Boolean).join(' ') || constants.interfaceIdiom || '',
    language: currentLang(),
    install: useErrorReports.getState().ensureInstall(),
  };
}

function enabled(): boolean {
  return useSettings.getState().reportErrors;
}

function queue(entry: LoggedError) {
  if (!enabled() || entry.source === SELF) return;
  useErrorReports.getState().push(entry);
  schedule(FLUSH_MS);
}

function schedule(ms: number) {
  if (timer) return;
  timer = setTimeout(() => {
    timer = undefined;
    void flush();
  }, ms);
}

/** Manda o que estiver pendente (em lotes). Servidor fora do ar: tenta de novo depois. */
export async function flushErrorReports(): Promise<void> {
  await flush();
}

async function flush() {
  if (sending || !enabled() || !grabEnabled()) return;
  const batch = useErrorReports.getState().pending.slice(0, BATCH);
  if (batch.length === 0) return;
  sending = true;
  let retry = false;
  const controller = new AbortController();
  const abort = setTimeout(() => controller.abort(), 15_000);
  try {
    const key = serverKey();
    const res = await fetch(`${serverUrl()}/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(key ? { 'X-Ritmo-Key': key } : {}) },
      body: JSON.stringify({ device: deviceInfo(), entries: batch.map(({ id: _id, ...entry }) => entry) }),
      signal: controller.signal,
    });
    // 4xx de conteúdo (não chave): reenviar não adianta, então descarta.
    if (res.ok || res.status === 400 || res.status === 413 || res.status === 422) useErrorReports.getState().drop(batch.map((e) => e.id));
    else retry = true;
  } catch {
    retry = true; // sem rede ou PC desligado
  } finally {
    clearTimeout(abort);
    sending = false;
  }
  if (retry) schedule(RETRY_MS);
  else if (useErrorReports.getState().pending.length > 0) schedule(1000);
}

/** Crash nativo (Kotlin/Swift) da última vez que o app abriu: entra no registro e no relatório. */
function collectNativeCrash() {
  let crash: string | null = null;
  try {
    crash = RitmoCore.takeLastCrash();
  } catch {
    return;
  }
  if (!crash) return;
  const [first, ...rest] = crash.split('\n');
  const error = new Error(first || 'Crash nativo');
  error.stack = rest.join('\n');
  logError('Crash nativo', error, undefined, true);
}

/** Liga o envio (chamado na abertura do app, depois de carregar os ajustes). */
export function startErrorReporting(): () => void {
  const off = onErrorLogged(queue);
  collectNativeCrash();
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') schedule(1000);
  });
  schedule(FIRST_FLUSH_MS);
  return () => {
    off();
    sub.remove();
    clearTimeout(timer);
    timer = undefined;
  };
}
