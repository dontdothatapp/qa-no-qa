export class TimeoutError extends Error {}

/** Rejects with TimeoutError after `ms` (the underlying promise keeps running and its result is ignored). */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`${label} timed out after ${ms} ms`)), ms);
  });
  p.catch(() => {}); // avoid an unhandled rejection if it fails after the timeout
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
