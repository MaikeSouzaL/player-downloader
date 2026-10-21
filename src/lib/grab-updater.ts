import { Platform } from 'react-native';

import RitmoCore from '@/modules/ritmo-core';

/**
 * Atualizador do motor iOS: wheels puras do PyPI, conferidas por SHA-256 e instaladas
 * fora do .app. A versão embutida continua disponível para rollback.
 */
export type GrabUpdateInfo = {
  ok: boolean;
  online: boolean;
  current: Record<string, string>;
  latest: Record<string, string>;
  updates: Record<string, string>;
  updateAvailable: boolean;
  checkedAt: number;
  active: string | null;
  previous: string | null;
  versions: string[];
  message: string;
  updated?: boolean;
  rolledBack?: boolean;
  requiresRestart?: boolean;
  installed?: Record<string, string>;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function versionMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, String(item ?? '')])
  );
}

function normalize(value: Record<string, unknown>): GrabUpdateInfo {
  return {
    ok: value.ok !== false,
    online: value.online === true,
    current: versionMap(value.current),
    latest: versionMap(value.latest),
    updates: versionMap(value.updates),
    updateAvailable: value.updateAvailable === true,
    checkedAt: Number(value.checkedAt ?? 0) || 0,
    active: text(value.active) || null,
    previous: text(value.previous) || null,
    versions: Array.isArray(value.versions) ? value.versions.map(String) : [],
    message: text(value.message),
    updated: value.updated === true,
    rolledBack: value.rolledBack === true,
    requiresRestart: value.requiresRestart === true,
    installed: versionMap(value.installed),
  };
}

export function grabUpdaterEnabled(): boolean {
  return (
    Platform.OS === 'ios' &&
    typeof RitmoCore.grabUpdateStatus === 'function' &&
    typeof RitmoCore.grabUpdateCheck === 'function'
  );
}

export async function grabUpdateStatus(): Promise<GrabUpdateInfo | null> {
  if (!grabUpdaterEnabled() || !RitmoCore.grabUpdateStatus) return null;
  return normalize(await RitmoCore.grabUpdateStatus());
}

export async function grabUpdateCheck(force = true): Promise<GrabUpdateInfo | null> {
  if (!grabUpdaterEnabled() || !RitmoCore.grabUpdateCheck) return null;
  return normalize(await RitmoCore.grabUpdateCheck(force));
}

export async function grabUpdateInstall(): Promise<GrabUpdateInfo | null> {
  if (!grabUpdaterEnabled() || !RitmoCore.grabUpdateInstall) return null;
  return normalize(await RitmoCore.grabUpdateInstall());
}

export async function grabUpdateRollback(): Promise<GrabUpdateInfo | null> {
  if (!grabUpdaterEnabled() || !RitmoCore.grabUpdateRollback) return null;
  return normalize(await RitmoCore.grabUpdateRollback());
}

/**
 * Verifica ao abrir o app e a cada 6 h. O Python guarda a última consulta no manifesto,
 * então abrir o app várias vezes não martela o PyPI.
 */
export function startGrabUpdateWatcher(): () => void {
  if (!grabUpdaterEnabled()) return () => {};
  let stopped = false;
  const run = () => {
    if (stopped) return;
    void grabUpdateCheck(false).catch(() => {
      // Sem rede ou PyPI fora do ar: a tela de Ajustes mostra o último estado.
    });
  };
  const first = setTimeout(run, 12_000);
  const interval = setInterval(run, 6 * 60 * 60 * 1000);
  return () => {
    stopped = true;
    clearTimeout(first);
    clearInterval(interval);
  };
}
