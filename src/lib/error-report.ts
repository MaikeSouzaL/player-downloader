import { logError } from '@/lib/errorlog';
import RitmoCore from '@/modules/ritmo-core';

/**
 * Relatório de erros agora é **local**: o app não envia mais nada para servidor nenhum.
 * O registro fica em Ajustes › Relatórios de erro; o crash nativo da última abertura entra nele.
 */

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

/** Chamado na abertura do app; mantém só a coleta local do crash nativo. */
export function startErrorReporting(): () => void {
  collectNativeCrash();
  return () => {};
}
