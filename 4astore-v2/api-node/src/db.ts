import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

// Prisma returns BigInt for id columns; JSON.stringify can't serialize BigInt.
// Register a global serializer so res.json() works everywhere.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};
