/* ------------------------------------------------------------------ *
 * Admin email broadcast — PURE helpers (no DB / no network).
 * ------------------------------------------------------------------ *
 * The broadcast endpoint in routes/admin.ts loads candidate users from the DB
 * and hands a plain array to these functions, so recipient selection + image
 * URL absolutization are unit-testable without a database or SMTP socket (same
 * technique as emailTemplate.ts / emailTemplate.test.ts).
 * ------------------------------------------------------------------ */

/** The minimal shape the selector reads off a user row (DB-agnostic). */
export interface BroadcastUser {
  id: number;
  name?: string | null;
  email?: string | null;
  recovery_email?: string | null;
  mobile?: string | null;
  role?: string | null;
  marketing_opt_out?: boolean | null;
}

/** A resolved recipient: a user id + the real email we will send to. */
export interface EmailRecipient {
  id: number;
  email: string;
  /** Display name (best-effort), carried through to the per-recipient sent record. */
  name?: string | null;
}

/**
 * A searched recipient surfaced in the admin multi-select — a user that HAS a
 * real email (users without one are never returned). `email` is the RESOLVED
 * email (see pickRealEmail), `name`/`mobile` are display helpers (empty string
 * when the DB value is null).
 */
export interface SearchedRecipient {
  id: number;
  name: string;
  email: string;
  mobile: string;
}

/** Who the broadcast targets. 'customers' == only role 'customer'. */
export type BroadcastTarget = 'all' | 'customers';

// Staff/operational roles are NEVER customers — excluded from every broadcast
// (a marketing email to the owner/admins/riders is noise, not reach).
const STAFF_ROLES = new Set(['owner', 'superadmin', 'admin', 'rider']);

/**
 * Pick the user's real email: prefer `email`, else `recovery_email`. A value
 * must be non-empty after trimming AND contain '@' to count. Returns null when
 * neither qualifies.
 */
export function pickRealEmail(u: BroadcastUser): string | null {
  for (const raw of [u.email, u.recovery_email]) {
    const v = (raw || '').trim();
    if (v !== '' && v.includes('@')) return v;
  }
  return null;
}

/**
 * Select de-duplicated recipients with a real email for the given target.
 * Rules:
 *   - must have a real email (see pickRealEmail);
 *   - EXCLUDE marketing_opt_out === true;
 *   - EXCLUDE staff roles (owner/superadmin/admin/rider) for BOTH targets;
 *   - for target 'customers' keep only role === 'customer';
 *   - DE-DUPLICATE by lowercased email (first user wins).
 */
export function selectEmailRecipients(users: BroadcastUser[], target: BroadcastTarget): EmailRecipient[] {
  const seen = new Set<string>();
  const out: EmailRecipient[] = [];
  for (const u of users) {
    if (u.marketing_opt_out === true) continue;
    const role = (u.role || 'customer').trim();
    if (STAFF_ROLES.has(role)) continue;
    if (target === 'customers' && role !== 'customer') continue;
    const email = pickRealEmail(u);
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: u.id, email, name: u.name ?? null });
  }
  return out;
}

/**
 * Pure email-only user search for the admin multi-select. Returns up to `limit`
 * NON-STAFF users that HAVE a real email (see pickRealEmail), matching `q`
 * (case-insensitive "contains") against the name, the RESOLVED email, or the
 * mobile. An empty `q` returns the first `limit` eligible users. De-duplicated
 * by lowercased email (first user wins). CRITICAL: a user without a real email
 * is NEVER returned — this is the single source of truth shared with the send
 * paths (same pickRealEmail + STAFF_ROLES as selectEmailRecipients).
 */
export function searchEmailRecipients(users: BroadcastUser[], q: string, limit = 30): SearchedRecipient[] {
  const needle = (q || '').trim().toLowerCase();
  const seen = new Set<string>();
  const out: SearchedRecipient[] = [];
  for (const u of users) {
    const role = (u.role || 'customer').trim();
    if (STAFF_ROLES.has(role)) continue;
    const email = pickRealEmail(u);
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    const name = (u.name || '').trim();
    const mobile = (u.mobile || '').trim();
    if (needle !== '') {
      const hay = `${name}\u0000${email}\u0000${mobile}`.toLowerCase();
      if (!hay.includes(needle)) continue;
    }
    seen.add(key);
    out.push({ id: u.id, name, email, mobile });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Resolve an explicit list of user ids to send-ready recipients. Keeps ONLY the
 * given ids that have a real email (see pickRealEmail) AND are not
 * marketing_opt_out, de-duplicated by lowercased email (first match wins, in the
 * order the users appear). Uses the SAME real-email + opt-out rule as
 * selectEmailRecipients so 'selected' sends agree with 'all'/'customers'. An id
 * without a real email is silently dropped (never sent to).
 */
export function selectRecipientsByIds(users: BroadcastUser[], ids: number[]): EmailRecipient[] {
  const wanted = new Set(ids.map((n) => Number(n)));
  const seen = new Set<string>();
  const out: EmailRecipient[] = [];
  for (const u of users) {
    if (!wanted.has(Number(u.id))) continue;
    if (u.marketing_opt_out === true) continue;
    const email = pickRealEmail(u);
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: u.id, email, name: u.name ?? null });
  }
  return out;
}

/**
 * Turn an admin-supplied image URL into an ABSOLUTE https URL for the email.
 *   - an already-absolute `http(s)://…` value passes through unchanged;
 *   - a leading `/api/…` path maps onto the API origin (apiOrigin minus its
 *     trailing `/api`, then the path) — this is what uploadBannerImage returns;
 *   - any other leading `/…` path maps onto siteOrigin;
 *   - an empty or `data:` value returns undefined (never embed inline images).
 */
export function absolutizeImageUrl(
  raw: string | undefined | null,
  siteOrigin: string,
  apiOrigin: string,
): string | undefined {
  const v = (raw || '').trim();
  if (v === '') return undefined;
  if (/^data:/i.test(v)) return undefined;
  if (/^https?:\/\//i.test(v)) return v;

  const path = v.startsWith('/') ? v : `/${v}`;
  const site = siteOrigin.replace(/\/+$/, '');
  if (/^\/api\//i.test(path)) {
    // apiOrigin is typically `${SITE_ORIGIN}/api`; strip the trailing `/api`
    // so `/api/uploads/x.png` resolves to `${host}/api/uploads/x.png`.
    const apiBase = apiOrigin.replace(/\/+$/, '').replace(/\/api$/i, '');
    return `${apiBase}${path}`;
  }
  return `${site}${path}`;
}
