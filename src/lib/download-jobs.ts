/**
 * Regras dos downloads de link direto que não dependem do aparelho (testadas no Node).
 */

type JobLike = { status: string; pendingUri?: string };

/** Baixou, mas salvar na biblioteca falhou (ex.: sem espaço): o arquivo continua aqui e dá para tentar de novo. */
export function canRetrySave(job: JobLike): boolean {
  return job.status === 'failed' && !!job.pendingUri;
}

/**
 * Ao tirar da lista: falha ou cancelamento podem ter deixado o arquivo baixado e o item no gerenciador
 * de downloads do sistema. Concluído já foi limpo ao salvar; em andamento não sai da lista.
 */
export function needsCleanup(job: JobLike): boolean {
  return job.status === 'failed' || job.status === 'cancelled';
}
