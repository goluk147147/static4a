import { Request, Response, NextFunction } from 'express';

// Gated request-timing middleware. A no-op unless DEBUG_TIMING=1, so production
// is unaffected. When enabled it logs `METHOD path status durationMs` once the
// response finishes — the cheap way to confirm (with real numbers on the live
// box) whether total request time is dominated by DB/connection latency.
export function timing(req: Request, res: Response, next: NextFunction): void {
  if (process.env.DEBUG_TIMING !== '1') return next();
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    // eslint-disable-next-line no-console
    console.log(`[timing] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`);
  });
  next();
}
