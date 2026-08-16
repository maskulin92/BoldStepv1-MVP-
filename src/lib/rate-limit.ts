import 'server-only';

/**
 * Fixed-window in-memory rate limiter — 100 requests/minute per key by default.
 *
 * Deliberately process-local: it is the "basic" limiter the brief asks for and
 * it works on a single Vercel instance or a local dev server. Phase 3 swaps
 * this for a shared store (Upstash/Redis) without changing call sites.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const GLOBAL_KEY = Symbol.for('boldstep.rate-limit');
type GlobalWithBuckets = typeof globalThis & { [GLOBAL_KEY]?: Map<string, Bucket> };

function buckets(): Map<string, Bucket> {
  const g = globalThis as GlobalWithBuckets;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map();
  return g[GLOBAL_KEY];
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset_at: number;
  retry_after_seconds: number;
}

export function checkRateLimit(
  key: string,
  limit = 100,
  windowMs = 60_000,
): RateLimitResult {
  const now = Date.now();
  const store = buckets();

  // Opportunistic sweep so the map can't grow unbounded on a long-lived server.
  if (store.size > 5000) {
    for (const [k, v] of store) if (v.resetAt <= now) store.delete(k);
  }

  const existing = store.get(key);
  if (!existing || existing.resetAt <= now) {
    const bucket = { count: 1, resetAt: now + windowMs };
    store.set(key, bucket);
    return {
      allowed: true,
      limit,
      remaining: limit - 1,
      reset_at: bucket.resetAt,
      retry_after_seconds: 0,
    };
  }

  existing.count += 1;
  const allowed = existing.count <= limit;
  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - existing.count),
    reset_at: existing.resetAt,
    retry_after_seconds: allowed ? 0 : Math.ceil((existing.resetAt - now) / 1000),
  };
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.reset_at / 1000)),
    ...(result.allowed ? {} : { 'Retry-After': String(result.retry_after_seconds) }),
  };
}
