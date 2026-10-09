// Tiny in-memory per-user token bucket, usable as Express middleware. No external
// dependency (keeps the "no new queue/runtime dep" constraint). Buckets are keyed by
// the authenticated user id (falling back to the request ip) so one admin hammering
// the optimize/audit/rollback endpoints cannot starve another. State is process-local
// — good enough for a single-node API; it resets on restart, which is acceptable for a
// soft abuse guard rather than a hard quota.

import { Request, Response, NextFunction } from 'express';
import { fail } from './http';

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface RateLimitOptions {
  // Sustained rate: how many tokens are refilled per window.
  limit?: number;
  // Window length in milliseconds the `limit` refills over.
  windowMs?: number;
  // Optional label so different route groups keep independent buckets.
  bucket?: string;
}

const buckets = new Map<string, Bucket>();

const keyFor = (req: Request, label: string): string => {
  const uid = req.user?.sub != null ? String(req.user.sub) : req.ip || 'anon';
  return `${label}:${uid}`;
};

/**
 * Returns an Express middleware enforcing `limit` requests per `windowMs` (default
 * 10/min) per user. Refills continuously (token bucket) so a burst is allowed up to
 * the limit and then paced. Replies 429 with a clear message when exhausted.
 */
export function rateLimit(opts: RateLimitOptions = {}) {
  const limit = Math.max(1, opts.limit ?? 10);
  const windowMs = Math.max(1000, opts.windowMs ?? 60_000);
  const label = opts.bucket || 'default';
  const refillPerMs = limit / windowMs;

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = keyFor(req, label);
    const b = buckets.get(key) || { tokens: limit, updatedAt: now };
    // Continuous refill since the last touch, capped at the bucket size.
    b.tokens = Math.min(limit, b.tokens + (now - b.updatedAt) * refillPerMs);
    b.updatedAt = now;
    if (b.tokens < 1) {
      buckets.set(key, b);
      const retrySec = Math.ceil((1 - b.tokens) / refillPerMs / 1000);
      res.setHeader('Retry-After', String(Math.max(1, retrySec)));
      return fail(res, `Too many requests — slow down and try again in ~${Math.max(1, retrySec)}s`, 429);
    }
    b.tokens -= 1;
    buckets.set(key, b);
    return next();
  };
}
