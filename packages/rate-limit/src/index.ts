export interface RateLimitHit {
  count: number;
  resetAt: number;
}

export interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<RateLimitHit>;
  reset(key: string): Promise<void>;
}

export interface MemoryStoreOptions {
  sweepIntervalMs?: number;
  maxEntries?: number;
}

export function createMemoryStore(options: MemoryStoreOptions = {}): RateLimitStore {
  const buckets = new Map<string, RateLimitHit>();
  const sweepInterval = options.sweepIntervalMs ?? 60_000;
  const maxEntries = options.maxEntries ?? 100_000;
  let lastSweep = Date.now();

  function sweep(now: number) {
    if (now - lastSweep < sweepInterval) return;
    lastSweep = now;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) {
        buckets.delete(key);
      }
    }
    if (buckets.size > maxEntries) {
      const overflow = buckets.size - maxEntries;
      let removed = 0;
      for (const key of buckets.keys()) {
        buckets.delete(key);
        if (++removed >= overflow) break;
      }
    }
  }

  return {
    async hit(key, windowMs) {
      const now = Date.now();
      sweep(now);

      const existing = buckets.get(key);
      if (!existing || existing.resetAt <= now) {
        const fresh: RateLimitHit = { count: 1, resetAt: now + windowMs };
        buckets.set(key, fresh);
        return { ...fresh };
      }

      existing.count += 1;
      return { ...existing };
    },

    async reset(key) {
      buckets.delete(key);
    },
  };
}

export interface RateLimitOptions {
  max: number;
  windowMs: number;
  store?: RateLimitStore;
}

export interface RateLimitResult {
  ok: boolean;
  count: number;
  remaining: number;
  resetAt: number;
  retryAfter: number;
}

export interface RateLimiter {
  check(key: string): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
  applyHeaders(response: Response, result: RateLimitResult): Response;
}

export function rateLimit(options: RateLimitOptions): RateLimiter {
  if (!Number.isInteger(options.max) || options.max <= 0) {
    throw new RangeError("rateLimit: max must be a positive integer");
  }
  if (!Number.isFinite(options.windowMs) || options.windowMs <= 0) {
    throw new RangeError("rateLimit: windowMs must be a positive number");
  }

  const store = options.store ?? createMemoryStore();

  return {
    async check(key: string): Promise<RateLimitResult> {
      const hit = await store.hit(key, options.windowMs);
      const remaining = Math.max(0, options.max - hit.count);
      const ok = hit.count <= options.max;
      return {
        ok,
        count: hit.count,
        remaining,
        resetAt: hit.resetAt,
        retryAfter: ok ? 0 : Math.ceil((hit.resetAt - Date.now()) / 1000),
      };
    },

    async reset(key: string): Promise<void> {
      await store.reset(key);
    },

    applyHeaders(response: Response, result: RateLimitResult): Response {
      response.headers.set("x-ratelimit-limit", String(options.max));
      response.headers.set("x-ratelimit-remaining", String(result.remaining));
      response.headers.set("x-ratelimit-reset", String(Math.ceil(result.resetAt / 1000)));
      if (!result.ok && result.retryAfter > 0) {
        response.headers.set("retry-after", String(result.retryAfter));
      }
      return response;
    },
  };
}
