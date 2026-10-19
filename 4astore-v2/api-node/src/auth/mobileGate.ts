/**
 * Pure, DB-free mobile-number predicates — the ONE source of truth for "is this
 * a real, reachable Indian mobile?" vs "is this a legacy Google placeholder?".
 *
 * Kept dependency-free (no prisma, no express) so it is unit-testable in the
 * node:test pure-import setup and reusable from both DB handlers (orders.ts
 * checkout gate, GET /orders/mine) and marketing.ts.
 */

/** A real, reachable 10-digit Indian mobile (starts 6-9). NULL/empty/placeholder → false. */
export const isRealMobile = (m: string | null | undefined): boolean => /^[6-9]\d{9}$/.test(String(m ?? ''));

/** A legacy Google sign-in placeholder mobile of the form `g<digits>` (never a real number). */
export const isGooglePlaceholderMobile = (m: string | null | undefined): boolean => /^g\d+$/.test(String(m ?? ''));
