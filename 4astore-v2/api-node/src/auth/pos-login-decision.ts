/**
 * POS login privilege-decision helper — NO-DOWNGRADE RULE.
 *
 * Rule: "POS login may raise or keep privileges, never reduce them."
 *
 * Why this exists: the POS phone-OTP login (routes/pos-auth.ts) seeds/updates a
 * `users` row from the `admin_phones` allowlist entry. The original code blindly
 * overwrote role + permissions for an EXISTING user, which once DOWNGRADED the
 * owner in production — an owner account became role=admin with
 * permissions=["orders","dashboard"] simply because their number was present as
 * a limited `staff` allowlist entry. These pure functions decide what role +
 * permissions to persist so a POS login can never LOWER an existing account's
 * privileges. Do NOT "simplify" this back into a blind overwrite.
 *
 * Authorization model (see auth/middleware.ts): STAFF_ROLES = owner, superadmin,
 * admin. owner/superadmin implicitly have ALL permissions; admin is gated by its
 * permissions[] list ('*' meaning all). So the only rank question that matters
 * is: owner/superadmin (full) > admin (perms-gated) > everything else.
 *
 * All inputs/outputs here are plain values — no Prisma, no Express — so the
 * decision is unit-testable without a database.
 */

/**
 * Rank the privilege level of a role. Higher is more privileged.
 * owner === superadmin (both get all permissions via hasPermission) > admin > rest.
 */
export function roleRank(role: string): number {
  switch (String(role)) {
    case 'owner':
    case 'superadmin':
      return 3;
    case 'admin':
      return 2;
    default:
      // rider / customer / unknown
      return 1;
  }
}

/**
 * De-duplicated union of two permission lists. If either side contains '*'
 * (all permissions) the result collapses to ['*'] — a union can only ever keep
 * or grow the permission set, never shrink it.
 */
export function unionPerms(a: string[], b: string[]): string[] {
  const merged = [...(a || []), ...(b || [])].map(String);
  if (merged.includes('*')) return ['*'];
  return [...new Set(merged)];
}

export interface PosLoginDecisionInput {
  existingRole: string;
  existingPermissions: string[];
  allowlistRole: string;
  allowlistPermissions: string[];
}

export interface PosLoginDecisionResult {
  role: string;
  permissions: string[];
}

/**
 * Decide the role + permissions to persist for an EXISTING user logging in via
 * POS, applying the no-downgrade rule:
 *
 *  - existing OUTRANKS allowlist  → keep existing role AND permissions (e.g. an
 *    owner/superadmin logging in through a limited `staff` entry stays owner).
 *  - allowlist OUTRANKS existing  → upgrade to the allowlist role + permissions.
 *  - EQUAL (both resolve to admin) → keep role 'admin' and persist the UNION of
 *    existing + allowlist permissions, so an equal login never shrinks perms.
 */
export function decidePosLogin(input: PosLoginDecisionInput): PosLoginDecisionResult {
  const { existingRole, existingPermissions, allowlistRole, allowlistPermissions } = input;
  const existingRank = roleRank(existingRole);
  const allowlistRank = roleRank(allowlistRole);

  if (existingRank > allowlistRank) {
    // Keep privileges — never downgrade. (production-incident guard)
    return { role: existingRole, permissions: existingPermissions || [] };
  }

  if (allowlistRank > existingRank) {
    // Upgrade/refresh to the allowlist role + permissions (today's behaviour).
    return { role: allowlistRole, permissions: allowlistPermissions || [] };
  }

  // Equal rank (both admin): keep the role, merge permissions — never shrink.
  return { role: allowlistRole, permissions: unionPerms(existingPermissions || [], allowlistPermissions || []) };
}
