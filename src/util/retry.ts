export interface RetryOptions {
  retries?: number;
  baseMs?: number;
  maxMs?: number;
  /** Retorna false para erros que não adianta repetir (ex.: 403). */
  shouldRetry?: (err: unknown) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  sleep?: (ms: number) => Promise<void>;
}

/** Repete com backoff exponencial + jitter. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { retries = 4, baseMs = 500, maxMs = 15_000, shouldRetry = () => true, onRetry } = opts;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !shouldRetry(err)) throw err;
      attempt++;
      const delay = Math.min(maxMs, baseMs * 2 ** (attempt - 1)) * (0.5 + Math.random() / 2);
      onRetry?.(err, attempt, Math.round(delay));
      await sleep(delay);
    }
  }
}
