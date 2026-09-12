/**
 * InterDash Server — API Rate Limiter
 *
 * Sliding window rate limiter keyed by API Principal (key ID) and IP fallback.
 * Emits standard headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After.
 */

import type { Request, Response, NextFunction } from "express";
import { apiError } from "./api-envelope.js";

interface RateLimitEntry {
  timestamps: number[];
}

// In-memory sliding window store: key -> timestamps
const store = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 2 minutes
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((ts) => now - ts < 120_000);
    if (entry.timestamps.length === 0) {
      store.delete(key);
    }
  }
}, 120_000);
cleanupTimer.unref();

export type EndpointClass = "standard" | "heavy" | "provision";

const CLASS_LIMITS: Record<EndpointClass, number> = {
  standard: 120, // 120 requests/minute
  heavy: 30,     // 30 power/reinstall operations/minute
  provision: 10, // 10 new provisioning requests/minute
};

/**
 * Middleware factory for API rate limiting
 */
export function apiRateLimit(endpointClass: EndpointClass = "standard") {
  const windowMs = 60_000; // 1 minute window

  return (req: Request, res: Response, next: NextFunction) => {
    // Principal ID or IP fallback
    const keyId = req.apiPrincipal?.apiKeyId;
    const ip = req.ip || req.socket?.remoteAddress || "unknown_ip";
    const rateKey = `${endpointClass}:${keyId || ip}`;

    // Determine max attempts: allow custom key RPM for standard class
    let maxAttempts = CLASS_LIMITS[endpointClass];
    if (endpointClass === "standard" && req.apiPrincipal?.rateLimitRpm) {
      maxAttempts = req.apiPrincipal.rateLimitRpm;
    }

    const now = Date.now();
    let entry = store.get(rateKey);
    if (!entry) {
      entry = { timestamps: [] };
      store.set(rateKey, entry);
    }

    // Filter outside window
    entry.timestamps = entry.timestamps.filter((ts) => now - ts < windowMs);

    const remaining = Math.max(0, maxAttempts - entry.timestamps.length);
    const oldestInWindow = entry.timestamps[0] || now;
    const resetSeconds = Math.max(1, Math.ceil((oldestInWindow + windowMs - now) / 1000));

    res.setHeader("X-RateLimit-Limit", maxAttempts.toString());
    res.setHeader("X-RateLimit-Remaining", Math.max(0, remaining - 1).toString());
    res.setHeader("X-RateLimit-Reset", resetSeconds.toString());

    if (entry.timestamps.length >= maxAttempts) {
      res.setHeader("Retry-After", resetSeconds.toString());
      apiError(
        res,
        429,
        "API_RATE_LIMITED",
        `Rate limit exceeded for endpoint class '${endpointClass}'. Try again in ${resetSeconds} seconds.`,
        {
          endpointClass,
          limitRpm: maxAttempts,
          retryAfterSeconds: resetSeconds,
        }
      );
      return;
    }

    entry.timestamps.push(now);
    next();
  };
}
