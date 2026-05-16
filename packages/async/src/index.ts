export function sleep(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError(`sleep() expects a non-negative finite duration, got ${ms}`);
  }

  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TimeoutError extends Error {
  constructor(message = "Operation timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message?: string): Promise<T> {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError(`withTimeout() expects a non-negative finite duration, got ${ms}`);
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(message ?? `Timed out after ${ms}ms`));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: { attempts?: number; delayMs?: number; backoff?: number } = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const delay = options.delayMs ?? 100;
  const backoff = options.backoff ?? 2;

  if (attempts < 1 || !Number.isInteger(attempts)) {
    throw new RangeError(`retry() attempts must be a positive integer, got ${attempts}`);
  }

  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < attempts - 1) {
        await sleep(delay * backoff ** attempt);
      }
    }
  }

  throw lastError;
}
