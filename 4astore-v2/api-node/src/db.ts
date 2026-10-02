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
}

// Prisma returns BigInt for id columns; JSON.stringify can't serialize BigInt.
// Register a global serializer so res.json() works everywhere.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};
