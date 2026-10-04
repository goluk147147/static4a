import { PrismaClient } from '@prisma/client';

// Reuse a single PrismaClient across the process (and across ts-node-dev
// `--respawn` hot-reloads, which otherwise spawn an extra client — and extra
// connection pool — on every reload, multiplying live DB connections).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalForPrisma = globalThis as any;

export const prisma: PrismaClient =
  globalForPrisma.__prisma ||
  new PrismaClient(
    process.env.DEBUG_TIMING === '1' ? { log: ['query', 'warn', 'error'] } : undefined
  );

if (!globalForPrisma.__prisma) {
  globalForPrisma.__prisma = prisma;

  // Warm the connection pool at startup so the FIRST request doesn't pay a cold MySQL
  // handshake (~600ms+ was observed per request on the live box — a classic sign the pool
  // was reconnecting on every call). $connect() opens the pool now.
  prisma.$connect().catch(() => {
    /* will connect lazily on first query if this fails */
  });

  // Keep-alive: a trivial query on an interval stops MySQL's wait_timeout from closing idle
  // connections. Without this, after a quiet minute the next request reconnects from scratch,
  // which is exactly the per-request latency users felt. unref() so it never blocks shutdown.
  const keepAlive = setInterval(() => {
    prisma.$queryRawUnsafe('SELECT 1').catch(() => null);
  }, 60_000);
  if (typeof keepAlive.unref === 'function') keepAlive.unref();
}

// Prisma returns BigInt for id columns; JSON.stringify can't serialize BigInt.
// Register a global serializer so res.json() works everywhere.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};
