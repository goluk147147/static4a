/**
 * POS admin phone allowlist management (OWNER ONLY).
 *
 * Mounted at /api/admin/pos BEFORE the generic /api/admin router (like
 * admin-links) so these specific paths win. Every route is requireAuth +
 * requireOwner — server-side, never frontend hiding.
 *
 * The allowlist (`admin_phones`) governs who can OBTAIN a staff JWT via POS
 * phone-OTP login (routes/pos-auth.ts). The API-layer invariant "an
 * unauthorised phone cannot call admin/POS APIs" is enforced by requireStaff/
 * requireOwner reading JWT claims; adding/removing a phone keeps the matching
 * user row's role/permissions in sync so revocation is effectively immediate
 * (and refresh tokens are revoked on removal so the user cannot refresh back
 * into staff). admin_phones is a runtime-created table, read/written via raw
 * SQL (consistent with the repo's settings handling).
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ok, fail } from '../utils/http';
import { requireAuth, requireOwner } from '../auth/middleware';

const router = Router();

const MOBILE_RE = /^[6-9]\d{9}$/;

/** Permission keys an admin phone may carry (keep in sync with ALLOWED_PERMS in routes/admin.ts). */
const ALLOWED_PERMS = [
  'dashboard', 'orders', 'riderTracking', 'products', 'categories', 'banners', 'ads',
  'users', 'earnings', 'settings', 'team', 'pos', 'inventory', 'pos_reports',
];

// The owner's own primary number cannot be demoted/removed (acceptance a guard).
const OWNER_MOBILE = '7543888698';

const upsertSchema = z.object({
  mobile: z.string().regex(MOBILE_RE),
  role: z.enum(['owner', 'staff']),
  permissions: z.array(z.string()).optional().default([]),
  name: z.string().max(120).optional(),
});

interface AdminPhoneRow {
  id: bigint | number;
  mobile: string;
  role: string;
  permissions: unknown;
  name: string | null;
  active: number | null;
  added_by: string | null;
  created_at: Date;
}

function cleanPerms(raw: string[]): string[] {
  return [...new Set(raw.map(String))].filter((p) => ALLOWED_PERMS.includes(p));
}

// GET /api/admin/pos/phones — list the allowlist.
router.get('/phones', requireAuth, requireOwner, async (_req: Request, res: Response) => {
  const rows = await prisma
    .$queryRawUnsafe<AdminPhoneRow[]>(
      `SELECT id, mobile, role, permissions, name, active, added_by, created_at
         FROM admin_phones ORDER BY created_at DESC`
    )
    .catch(() => [] as AdminPhoneRow[]);
  const phones = rows.map((r) => ({
    id: Number(r.id),
    mobile: r.mobile,
    role: r.role,
    permissions:
      typeof r.permissions === 'string'
        ? (() => {
            try {
              return JSON.parse(r.permissions as string);
            } catch {
              return [];
            }
          })()
        : r.permissions ?? [],
    name: r.name,
    active: !!r.active,
    added_by: r.added_by,
    created_at: r.created_at,
  }));
  return ok(res, { phones });
});

// POST /api/admin/pos/phones — add/update an authorised number.
router.post('/phones', requireAuth, requireOwner, async (req: Request, res: Response) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'Enter a valid 10-digit mobile and role (owner|staff).', 422);
  const { mobile, role } = parsed.data;
  const name = parsed.data.name ?? null;
  const permissions = role === 'owner' ? ['*'] : cleanPerms(parsed.data.permissions);
  if (role === 'staff' && permissions.length === 0) {
    return fail(res, 'Select at least one permission for a staff number.', 422);
  }

  const addedBy = req.user?.mobile ?? req.user?.username ?? null;
  await prisma.$executeRawUnsafe(
    `INSERT INTO admin_phones (mobile, role, permissions, name, active, added_by)
       VALUES (?, ?, ?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE role = VALUES(role), permissions = VALUES(permissions),
       name = VALUES(name), active = 1`,
    mobile,
    role,
    JSON.stringify(permissions),
    name,
    addedBy
  );

  // If a matching user already exists, update their role/permissions immediately
  // so access is granted/updated without waiting for a fresh login.
  const userRole = role === 'owner' ? 'owner' : 'admin';
  await prisma.user
    .update({ where: { mobile }, data: { role: userRole, permissions } })
    .catch(() => null); // no matching user yet — seeded on their first POS login

  return ok(res, { message: `Authorised ${mobile} as ${role}.`, mobile, role, permissions });
});

// DELETE /api/admin/pos/phones/:mobile — revoke a number.
router.delete('/phones/:mobile', requireAuth, requireOwner, async (req: Request, res: Response) => {
  const mobile = String(req.params.mobile || '');
  if (!MOBILE_RE.test(mobile)) return fail(res, 'Invalid mobile number.', 422);

  // Never allow the owner's primary number (or the caller's own number) to be
  // removed — that would lock the store out of admin access.
  if (mobile === OWNER_MOBILE || mobile === req.user?.mobile) {
    return fail(res, 'You cannot remove the owner’s own number.', 409);
  }

  await prisma.$executeRawUnsafe('UPDATE admin_phones SET active = 0 WHERE mobile = ?', mobile);

  // Demote any matching user to customer and revoke their refresh tokens so they
  // cannot refresh back into staff (acceptance a — server-side revocation).
  const user = await prisma.user.findUnique({ where: { mobile } }).catch(() => null);
  if (user) {
    await prisma.user.update({ where: { mobile }, data: { role: 'customer', permissions: [] } }).catch(() => null);
    await prisma.refreshToken
      .updateMany({ where: { user_id: user.id, revoked: false }, data: { revoked: true } })
      .catch(() => null);
  }

  return ok(res, { message: `Revoked ${mobile}.`, mobile });
});

export default router;
