/* ------------------------------------------------------------------ *
 * Push AUDIENCE helpers — PURE (DB-free, network-free, Express-free).
 * ------------------------------------------------------------------ *
 * Kept in a dependency-free module so the Node test runner can import
 * it WITHOUT pulling in prisma/db or Express (mirrors whatsappFormat.ts).
 * routes/push.ts re-imports these. Runtime behaviour is unchanged — this
 * is the SAME topic/user_id decision the /register handler used inline.
 * ------------------------------------------------------------------ */

/** Topics a device should be subscribed to, based on role/permissions. */
export function topicsForUser(role: string, permissions: string[]): string[] {
  const topics = ['all'];
  if (role === 'rider') topics.push('riders');
  else topics.push('customers');
  if (role === 'owner' || role === 'superadmin') topics.push('admins');
  else if (role === 'admin' && (permissions.includes('*') || permissions.includes('orders'))) topics.push('admins');
  return topics;
}

/** Minimal shape of the verified JWT claims the /register route cares about. */
export interface RegisterUser {
  sub: number;
  role: string;
  permissions?: string[];
}

/**
 * Decide the device_tokens `user_id` + FCM topics for a /register call.
 *
 * - Authenticated caller → user_id = BigInt(sub), topics from their role.
 * - Guest (no valid token) → user_id = null, topics as a plain customer
 *   (`['all','customers']`) so the device still receives the broadcast/promo
 *   pushes the staff `all`/`customers` broadcast targets.
 */
export function registerIdentity(user?: RegisterUser): { userId: bigint | null; topics: string[] } {
  if (user) {
    return { userId: BigInt(user.sub), topics: topicsForUser(user.role, user.permissions || []) };
  }
  return { userId: null, topics: topicsForUser('customer', []) };
}
