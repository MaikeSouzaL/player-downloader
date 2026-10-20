/** 3:05, 1:02:09 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "2 h 15 min", "48 min" — para o total de uma playlist. */
export function formatLongDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const UNITS = ['B', 'KB', 'MB', 'GB'];

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 || value >= 100 ? 0 : 1).replace('.', ',')} ${UNITS[unit]}`;
}

export function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString('pt-BR')} ${count === 1 ? one : many}`;
}

/** Minúsculas e sem acentos, para busca e ordenação. */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function folderName(path: string): string {
  const clean = path.replace(/\/+$/, '');
  return clean.slice(clean.lastIndexOf('/') + 1) || clean;
}

/** Caminho legível: tira o prefixo do armazenamento interno. */
/** Caminho legível: "/storage/emulated/0/Music" → "Armazenamento interno/Music". Os rótulos vêm traduzidos de fora. */
export function prettyPath(path: string, labels: { internal: string; card: (name: string) => string } = DEFAULT_PATH_LABELS): string {
  return path
    .replace(/^\/storage\/emulated\/0\/?/, `${labels.internal}/`)
    .replace(/^\/storage\/([^/]+)\/?/, (_, name: string) => `${labels.card(name)}/`);
}

const DEFAULT_PATH_LABELS = { internal: 'Armazenamento interno', card: (name: string) => `Cartão ${name}` };
