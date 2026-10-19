/* ------------------------------------------------------------------ *
 * Unverified-lead upsert (no-migration lead capture).
 * ------------------------------------------------------------------ *
 * "Lead capture is paramount": a user's NAME + contact must be stored the
 * INSTANT a signup code is requested, so a lead is never lost even if the user
 * abandons at the OTP step or every delivery channel fails. This creates the
 * `users` row as an UNVERIFIED lead at otp/send time instead of only after the
 * OTP matches (routes/otp.ts → services/otpDelivery.ts calls this before any
 * channel sends).
 *
 * NO SCHEMA CHANGE / NO MIGRATION (deploy.sh runs prisma generate + build only):
 *   - "unverified" is signalled by `last_login IS NULL` — an existing nullable
 *     column — NOT a new boolean. register (routes/users.ts) flips the lead to
 *     verified by setting last_login on a successful OTP.
 *
 * It keys the lookup on the SAME identifiers register uses (email lowercased /
 * recovery_email / mobile) so no duplicate lead rows are created, aligning with
 * the findFirst({ OR:[{username},{mobile}] }) uniqueness logic register enforces.
 *
 * Best-effort / NON-FATAL: every path is wrapped so a lead-write hiccup can NEVER
 * break OTP delivery — the function resolves (never throws) so deliverSignupOtp
 * continues to send the code regardless.
 * ------------------------------------------------------------------ */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../db';

export interface UpsertUnverifiedLeadInput {
  name?: string;
  email?: string;
  mobile?: string;
}

/** Derive a URL/username-safe base from an email local-part or a name. */
function deriveUsernameBase(email: string, name: string): string {
  const source = email ? email.split('@')[0] : name;
  let base = source.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (base.length < 3) base = (base + 'usr').slice(0, 3) || 'usr';
  return base.slice(0, 60);
}

/**
 * Create (or lightly update) an UNVERIFIED lead for a signup identifier.
 *
 * - Looks up an existing row by email (lowercased) / recovery_email / mobile.
 * - If none exists: creates a `users` row with name (or a safe placeholder,
 *   since users.name is NOT NULL), mobile (when a 10-digit number was given),
 *   recovery_email + recovery_email_verified:false when an email was given, a
 *   RANDOM bcrypt password, role 'customer', registered_at = now, and crucially
 *   `last_login: null` — the UNVERIFIED signal (treated as unverified until
 *   register flips it). Username is derived defensively and retried on P2002.
 * - If a row exists: only fills in a name when it was previously empty and a new
 *   one is supplied; NEVER overwrites a non-empty name, NEVER touches password,
 *   last_login, or role, and NEVER deletes.
 *
 * Returns silently on ANY error so OTP delivery is never blocked by a lead write.
 */
export async function upsertUnverifiedLead(input: UpsertUnverifiedLeadInput): Promise<void> {
  try {
    const email = input.email?.trim().toLowerCase() || '';
    const mobile = input.mobile?.trim() || '';
    const name = input.name?.trim() || '';
    if (!email && !mobile) return; // nothing to key a lead on

    // Key on the SAME identifiers register's uniqueness guard uses so we never
    // create a duplicate lead row for an identity that already exists.
    const or = [
      ...(email ? [{ email }, { recovery_email: email }] : []),
      ...(mobile ? [{ mobile }] : []),
    ];
    const existing = await prisma.user.findFirst({ where: { OR: or } }).catch(() => null);

    if (existing) {
      // Only backfill a missing name — never overwrite an existing one, and
      // never touch password / last_login / role (that would alter verified
      // state or credentials). No-op when there is nothing to add.
      if (name && !String(existing.name || '').trim()) {
        await prisma.user.update({ where: { id: existing.id }, data: { name } }).catch(() => null);
      }
      return;
    }

    // users.name is NOT NULL — fall back to a safe placeholder when no name was
    // supplied (e.g. a bare mobile-only /otp/send). Register later overwrites it
    // with the real name on completion.
    const safeName = name || (email ? email.split('@')[0] : 'Lead');
    const base = deriveUsernameBase(email, safeName);
    const password = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10);

    // Retry the USERNAME on a unique-constraint race (same defensive pattern as
    // createGoogleUser). mobile is unique too; if the mobile collided the
    // findFirst above would have matched, so a P2002 here is a username race.
    for (let i = 0; i < 5; i++) {
      const suffix = i === 0 ? '' : String(i);
      const username = (base + suffix).slice(0, 64);
      try {
        await prisma.user.create({
          data: {
            name: safeName,
            ...(mobile ? { mobile } : {}),
            username,
            ...(email ? { recovery_email: email, recovery_email_verified: false } : {}),
            password,
            role: 'customer',
            registered_at: new Date(),
            // UNVERIFIED signal — stays NULL until register flips it on OTP match.
            last_login: null,
          },
        });
        return;
      } catch (err) {
        if (err && typeof err === 'object' && (err as { code?: string }).code === 'P2002') continue;
        // Any other error → give up silently; OTP delivery must still proceed.
        return;
      }
    }
  } catch {
    // Never let a lead-write failure break OTP delivery.
  }
}
