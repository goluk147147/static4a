/**
 * POS phone-OTP login (PUBLIC — this IS the login path, no requireAuth).
 *
 * Mounted at /api/pos/auth. The owner authorises a mobile number in
 * `admin_phones` (see routes/admin-pos.ts); this router lets that number log in
 * by OTP and seeds/updates the matching `users` row to the stored role +
 * permissions so EVERY existing guard (requireStaff / requireOwner reading JWT
 * claims) keeps working unchanged. The returned shape is byte-for-byte the same
 * as POST /api/users/login because it uses the SHARED session helpers in
 * auth/session.ts (issueTokens / safeUser / isMobileClient).
 *
 * OTP is stored in the existing `email_otps` table with purpose='pos_login' and
 * the `email` column holding `pos:<mobile>` (the table has no phone column; this
 * reuses it with no schema change). Both endpoints are enumeration-safe: /send
 * always returns a generic 200 whether or not the number is authorised.
 *
 * Delivery: the repo has no SMS provider. The OTP is delivered by FCM push to
 * the owner's already-registered devices when the number already maps to a
 * staff user with devices, and in non-production the code is also returned as
 * `devOtp` (mirrors routes/otp.ts). TODO(sms): wiring an SMS gateway later is a
 * drop-in replacement for the delivery step and does not change the API.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ok, fail } from '../utils/http';
import { config } from '../config';
import { rateLimit } from '../utils/rateLimit';
import { tokensForStaff, sendToTokens } from '../services/push';
import { issueTokens, safeUser, isMobileClient } from '../auth/session';
import { decidePosLogin } from '../auth/pos-login-decision';

const router = Router();

const MOBILE_RE = /^[6-9]\d{9}$/;
const OTP_RE = /^\d{6}$/;
const SEND_GENERIC = 'If this number is authorised, a login code has been sent.';

const sendSchema = z.object({ mobile: z.string().regex(MOBILE_RE) });
const verifySchema = z.object({ mobile: z.string().regex(MOBILE_RE), otp: z.string().regex(OTP_RE) });

/** Permission keys an admin phone may carry (keep in sync with ALLOWED_PERMS in routes/admin.ts). */
const ALLOWED_PERMS = [
  'dashboard', 'orders', 'riderTracking', 'products', 'categories', 'banners', 'ads',
  'users', 'earnings', 'settings', 'team', 'pos', 'inventory', 'pos_reports',
];

interface AdminPhoneRow {
  mobile: string;
  role: string;
  permissions: unknown;
  name: string | null;
  active: number | null;
}

/** Look up an ACTIVE allowlist row by mobile (raw SQL — admin_phones is runtime-created). */
async function findActivePhone(mobile: string): Promise<AdminPhoneRow | null> {
  const rows = await prisma
    .$queryRawUnsafe<AdminPhoneRow[]>(
      `SELECT mobile, role, permissions, name, active FROM admin_phones WHERE mobile = ? AND active = 1 LIMIT 1`,
      mobile
    )
    .catch(() => [] as AdminPhoneRow[]);
  return rows[0] ?? null;
}

/** Normalise a stored admin_phones.permissions value to a clean string[] of allowed keys. */
export function normalizePerms(raw: unknown): string[] {
  let arr: unknown = raw;
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch {
      arr = [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.map(String))].filter((p) => ALLOWED_PERMS.includes(p));
}

// POST /api/pos/auth/otp/send { mobile }
router.post(
  '/otp/send',
  rateLimit({ limit: 5, windowMs: 60_000, bucket: 'pos_otp_send' }),
  async (req: Request, res: Response) => {
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 'Enter a valid 10-digit mobile number.', 422);
    const { mobile } = parsed.data;

    const phone = await findActivePhone(mobile);
    if (!phone) {
      // Enumeration-safe: never reveal whether the number is authorised.
      return ok(res, { message: SEND_GENERIC });
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    await prisma.emailOtp.create({
      data: {
        email: `pos:${mobile}`,
        otp,
        purpose: 'pos_login',
        expires_at: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    // Deliver by push to the owner's already-registered devices (best-effort).
    // If the number maps to a staff user with devices they get the code in-tray.
    const staffTokens = await tokensForStaff('pos').catch(() => [] as string[]);
    if (staffTokens.length) {
      await sendToTokens(staffTokens, {
        title: '🔐 4A Store POS login code',
        body: `Your POS login code is ${otp}. It expires in 10 minutes.`,
        data: { type: 'pos_login_otp' },
      }).catch(() => 0);
    }

    const devOtp = config.env !== 'production' ? otp : undefined;
    return ok(res, { message: SEND_GENERIC, devOtp });
  }
);

// POST /api/pos/auth/otp/verify { mobile, otp }
router.post('/otp/verify', async (req: Request, res: Response) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'Enter your mobile and the 6-digit code.', 422);
  const { mobile, otp } = parsed.data;

  const phone = await findActivePhone(mobile);
  if (!phone) return fail(res, 'Invalid or expired code', 401);

  const row = await prisma.emailOtp.findFirst({
    where: { email: `pos:${mobile}`, purpose: 'pos_login', consumed: false, expires_at: { gt: new Date() } },
    orderBy: { id: 'desc' },
  });
  if (!row || row.otp !== otp) return fail(res, 'Invalid or expired code', 401);

  // Map the allowlist role to a user role + permissions. 'staff' → admin with
  // its permission list; 'owner' → owner (all permissions via hasPermission).
  const isOwner = String(phone.role) === 'owner';
  const role = isOwner ? 'owner' : 'admin';
  const permissions = isOwner ? ['*'] : normalizePerms(phone.permissions);

  // Upsert the user by mobile. A new POS staff number may not yet have a user
  // row, so create one; otherwise update the existing row's role/permissions so
  // the JWT claims carry staff access immediately.
  const existing = await prisma.user.findUnique({ where: { mobile } }).catch(() => null);
  let user;
  if (existing) {
    // NO-DOWNGRADE RULE: a POS login may raise or keep privileges, never reduce
    // them. The allowlist entry must not demote an account that already outranks
    // it — this once demoted the owner in production (owner → role=admin,
    // permissions=["orders","dashboard"]). decidePosLogin keeps the higher role
    // and unions perms on an equal-admin login. See auth/pos-login-decision.ts.
    const decided = decidePosLogin({
      existingRole: String(existing.role),
      existingPermissions: Array.isArray(existing.permissions)
        ? (existing.permissions as string[]).map(String)
        : normalizePerms(existing.permissions),
      allowlistRole: role,
      allowlistPermissions: permissions,
    });
    user = await prisma.user.update({
      where: { mobile },
      data: { role: decided.role, permissions: decided.permissions, last_login: new Date() },
    });
  } else {
    // Derive a unique, non-colliding username from the mobile.
    const bcrypt = await import('bcryptjs');
    const crypto = await import('node:crypto');
    let created;
    for (let i = 0; i < 5; i++) {
      const suffix = i === 0 ? '' : String(i);
      try {
        created = await prisma.user.create({
          data: {
            name: phone.name || `POS ${mobile}`,
            mobile,
            username: `pos${mobile}${suffix}`.slice(0, 64),
            password: bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10),
            role,
            permissions,
            registered_at: new Date(),
            last_login: new Date(),
          },
        });
        break;
      } catch (err) {
        if (err && typeof err === 'object' && (err as { code?: string }).code === 'P2002') continue;
        throw err;
      }
    }
    if (!created) return fail(res, 'Could not provision POS account. Try again.', 500);
    user = created;
  }

  await prisma.emailOtp.update({ where: { id: row.id }, data: { consumed: true } });

  const { accessToken, refreshToken } = await issueTokens(res, user, isMobileClient(req) ? 'mobile-app' : undefined);
  return ok(res, { user: safeUser(user), token: accessToken, ...(isMobileClient(req) ? { refreshToken } : {}) });
});

export default router;
