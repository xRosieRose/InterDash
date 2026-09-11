/**
 * InterDash Server — Rate Limiter
 *
 * In-memory sliding window rate limiter.
 * Keys can be IP, email, or a composite identifier.
 */

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 5 minutes
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((ts) => now - ts < 300_000);
    if (entry.timestamps.length === 0) {
      store.delete(key);
    }
  }
}, 300_000);
cleanupTimer.unref();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

/**
 * Check if a request is within the rate limit.
 * @param key Unique identifier (e.g., IP address)
 * @param maxAttempts Maximum requests allowed in the window
 * @param windowMs Time window in milliseconds
 */
export function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  let entry = store.get(key);

  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter((ts) => now - ts < windowMs);

  if (entry.timestamps.length >= maxAttempts) {
    const oldestInWindow = entry.timestamps[0];
    const resetMs = oldestInWindow + windowMs - now;
    return {
      allowed: false,
      remaining: 0,
      resetMs: Math.max(resetMs, 0),
    };
  }

  // Record this attempt
  entry.timestamps.push(now);

  return {
    allowed: true,
    remaining: maxAttempts - entry.timestamps.length,
    resetMs: 0,
  };
}

/**
 * Create Express middleware for rate limiting.
 */
export function rateLimitMiddleware(
  maxAttempts: number,
  windowMs: number,
  keyFn?: (req: any) => string
) {
  return (req: any, res: any, next: any) => {
    const key = keyFn
      ? keyFn(req)
      : req.ip || req.connection?.remoteAddress || "unknown";

    const result = checkRateLimit(key, maxAttempts, windowMs);

    res.setHeader("X-RateLimit-Limit", maxAttempts.toString());
    res.setHeader("X-RateLimit-Remaining", result.remaining.toString());

    if (!result.allowed) {
      res.setHeader(
        "Retry-After",
        Math.ceil(result.resetMs / 1000).toString()
      );
      return res.status(429).json({
        error: "Too many requests. Please try again later.",
        retryAfterMs: result.resetMs,
      });
    }

    next();
  };
}
