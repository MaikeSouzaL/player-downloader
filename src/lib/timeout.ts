/** Prazo para uma promessa do motor local: sem isso, um processo travado deixa a tela girando. */

export class TimeoutError extends Error {
  readonly code = 'ETIMEDOUT';
  readonly ms: number;

  constructor(ms: number, message = `Timeout after ${ms} ms`) {
    super(message);
    this.name = 'TimeoutError';
    this.ms = ms;
  }
}

export function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof Error && (error as { code?: unknown }).code === 'ETIMEDOUT';
}

/**
 * Rejeita com `TimeoutError` se a promessa não terminar em `ms`. A promessa original continua
 * rodando no nativo (não há como abortar o yt-dlp), mas a tela deixa de esperar para sempre.
 */
export function withTimeout<T>(promise: PromiseLike<T>, ms: number, message?: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new TimeoutError(ms, message));
    }, ms);

    Promise.resolve(promise).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
