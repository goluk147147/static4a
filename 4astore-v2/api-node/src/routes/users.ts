import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import { prisma } from '../db';
import { ok, fail } from '../utils/http';
import { config } from '../config';
import {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  AccessClaims,
} from '../auth/jwt';
import { requireAuth } from '../auth/middleware';
import { sendMail } from '../utils/mailer';

const router = Router();

const REFRESH_COOKIE = 'refresh_token';
const ACCESS_COOKIE = 'access_token';

// ---- Google Sign-In ----
// Client IDs are NOT secrets: read from env first, with documented defaults.
// The server accepts either audience so both web and the Android app can call
// the same /social-login endpoint. See .env.example for details.
const GOOGLE_WEB_CLIENT_ID =
  process.env.GOOGLE_WEB_CLIENT_ID || '707085023016-etp7au34rg3cd5eks6cdu0cs0vkj1svn.apps.googleusercontent.com';
const GOOGLE_ANDROID_CLIENT_ID =
  process.env.GOOGLE_ANDROID_CLIENT_ID || '707085023016-pc4gc5271kquti6recqo9juor3p44dn9.apps.googleusercontent.com';
const googleClient = new OAuth2Client();

function cookieOpts(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'lax' as const,
    maxAge: maxAgeMs,
    path: '/',
  };
}

function toClaims(user: {
  id: bigint;
  role: string;
  mobile: string;
  username: string;
  name: string;
  permissions: unknown;
  backend_rider: boolean;
}): AccessClaims {
  const perms = Array.isArray(user.permissions) ? (user.permissions as string[]) : [];
  return {
    sub: Number(user.id),
    role: user.role,
    mobile: user.mobile,
    username: user.username,
    name: user.name,
    permissions: perms,
    mode: user.role === 'rider' && user.backend_rider ? 'rider' : 'customer',
  };
}

/** Native app (no cookies) sends `X-Client: mobile` and keeps the refresh token in secure storage. */
function isMobileClient(req: Request): boolean {
  return String(req.headers['x-client'] || '').toLowerCase() === 'mobile';
}

function safeUser(user: Record<string, unknown>) {
  const { password, ...rest } = user;
  void password;
  return rest;
}

/** Issue access + refresh tokens and set them as HttpOnly cookies (life-long login). */
async function issueTokens(res: Response, user: Parameters<typeof toClaims>[0], deviceLabel?: string) {
  const claims = toClaims(user);
  const accessToken = signAccessToken(claims);
  const { token: refreshToken, hash, expiresAt } = generateRefreshToken();

  await prisma.refreshToken.create({
    data: { user_id: BigInt(claims.sub), token_hash: hash, device_label: deviceLabel, expires_at: expiresAt },
  });

  res.cookie(ACCESS_COOKIE, accessToken, cookieOpts(15 * 60 * 1000));
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOpts(config.refreshTokenTtlDays * 24 * 60 * 60 * 1000));
  return { accessToken, refreshToken, claims };
}

// ---------- POST /api/users/register ----------
const registerSchema = z.object({
  name: z.string().min(1),
  mobile: z.string().regex(/^[6-9]\d{9}$/),
  username: z.string().min(3).max(32),
  email: z.string().email(),
  password: z.string().min(4),
  otp: z.string().min(4),
});

router.post('/register', async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'Enter a name, valid 10-digit mobile, username, email and 4+ char password', 422);
  const { name, mobile, username, email, password, otp } = parsed.data;

  // Verify email OTP.
  const otpRow = await prisma.emailOtp.findFirst({
    where: { email: email.toLowerCase(), purpose: 'signup', consumed: false, expires_at: { gt: new Date() } },
    orderBy: { id: 'desc' },
  });
  if (!otpRow || otpRow.otp !== otp) return fail(res, 'Verify your email before creating an account.', 403);

  const dupUser = await prisma.user.findFirst({
    where: { OR: [{ username: username.toLowerCase() }, { mobile }] },
  });
  if (dupUser) {
    return fail(res, dupUser.mobile === mobile ? 'Mobile number already registered' : 'Username already taken', 409);
  }

  const user = await prisma.user.create({
    data: {
      name,
      mobile,
      username: username.toLowerCase(),
      recovery_email: email.toLowerCase(),
      recovery_email_verified: true,
      password: bcrypt.hashSync(password, 10),
      role: 'customer',
      registered_at: new Date(),
      last_login: new Date(),
    },
  });
  await prisma.emailOtp.update({ where: { id: otpRow.id }, data: { consumed: true } });

  const { accessToken, refreshToken } = await issueTokens(res, user, isMobileClient(req) ? 'mobile-app' : undefined);
  return ok(res, { user: safeUser(user), token: accessToken, ...(isMobileClient(req) ? { refreshToken } : {}) });
});

// ---------- POST /api/users/login ----------
const loginSchema = z.object({
  username: z.string().min(1), // username OR mobile OR email
  password: z.string().min(1),
});

router.post('/login', async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'Username and password required', 422);
  const { username, password } = parsed.data;

  const lower = username.toLowerCase();
  const user = await prisma.user.findFirst({
    where: { OR: [{ username: lower }, { mobile: username }, { email: lower }, { recovery_email: lower }] },
  });
  if (!user) return fail(res, 'Account not found. Please sign up first.', 404);

  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) return fail(res, 'Incorrect password. Please try again.', 401);

  if (user.role === 'rider' && !user.backend_rider) {
    return fail(res, 'Rider account must be created by admin', 403);
  }

  await prisma.user.update({ where: { id: user.id }, data: { last_login: new Date() } });
  const { accessToken, refreshToken } = await issueTokens(res, user, isMobileClient(req) ? 'mobile-app' : undefined);
  return ok(res, { user: safeUser(user), token: accessToken, ...(isMobileClient(req) ? { refreshToken } : {}) });
});

// ---------- POST /api/users/social-login (PUBLIC, no requireAuth) ----------
// Verifies a Google ID token (aud = web OR android client ID), upserts the user
// by email, and returns the SAME { user, token, refreshToken? } shape as /login
// via issueTokens() (honoring isMobileClient). Both web and the Android app call
// this endpoint. Provider is currently restricted to 'google'.
const socialLoginSchema = z.object({
  provider: z.string().optional(),
  idToken: z.string().min(1),
});

type GooglePayload = TokenPayload;

/**
 * Create a brand-new local user from a verified Google payload. Derives a
 * unique username + a non-colliding mobile placeholder (prefixed 'g' so it can
 * never match the /^[6-9]\d{9}$/ register regex). Retries on Prisma P2002
 * (unique constraint) by re-suffixing both so it never crashes under a race.
 */
async function createGoogleUser(p: GooglePayload) {
  const email = p.email as string;
  let base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  if (base.length < 3) base = (base + 'usr').slice(0, 3) || 'usr';
  const mobileBase = ('g' + String(p.sub || '').replace(/\D/g, '')).slice(0, 15);
  const password = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10);

  let lastErr: unknown = null;
  for (let i = 0; i < 5; i++) {
    const suffix = i === 0 ? '' : String(i);
    const username = (base + suffix).slice(0, 64);
    const mobile = (mobileBase + suffix).slice(0, 15);
    try {
      return await prisma.user.create({
        data: {
          name: p.name || base,
          email,
          recovery_email: email,
          recovery_email_verified: true,
          username,
          mobile,
          password,
          role: 'customer',
          registered_at: new Date(),
          last_login: new Date(),
        },
      });
    } catch (err) {
      // P2002 = unique constraint violation → re-suffix username/mobile and retry.
      if (err && typeof err === 'object' && (err as { code?: string }).code === 'P2002') {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error('Could not create Google user');
}

router.post('/social-login', async (req: Request, res: Response) => {
  const parsed = socialLoginSchema.safeParse(req.body);
  // Reject an explicitly non-google provider before the token check.
  if (req.body?.provider !== undefined && req.body.provider !== 'google') {
    return fail(res, 'Unsupported provider', 400);
  }
  if (!parsed.success) return fail(res, 'A valid Google idToken is required', 422);
  const { idToken } = parsed.data;

  let payload: GooglePayload | undefined;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: [GOOGLE_WEB_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID],
    });
    payload = ticket.getPayload();
  } catch {
    return fail(res, 'Invalid Google token', 401);
  }
  const p = payload;
  if (!p || p.email_verified !== true || !p.email) return fail(res, 'Invalid Google token', 401);

  let user = await prisma.user.findFirst({
    where: { OR: [{ email: p.email }, { recovery_email: p.email }] },
  });
  if (user) {
    user = await prisma.user.update({ where: { id: user.id }, data: { last_login: new Date() } });
  } else {
    user = await createGoogleUser(p);
  }

  const { accessToken, refreshToken } = await issueTokens(res, user, isMobileClient(req) ? 'mobile-app' : undefined);
  return ok(res, { user: safeUser(user), token: accessToken, ...(isMobileClient(req) ? { refreshToken } : {}) });
});

// ---------- POST /api/users/refresh (silent refresh keeps login alive ~1 year) ----------
router.post('/refresh', async (req: Request, res: Response) => {
  const token = (req.cookies?.[REFRESH_COOKIE] as string) || (req.body?.refreshToken as string);
  if (!token) return fail(res, 'No refresh token', 401);

  const row = await prisma.refreshToken.findUnique({ where: { token_hash: hashRefreshToken(token) } });
  if (!row || row.revoked || row.expires_at < new Date()) return fail(res, 'Refresh token invalid or expired', 401);

  const user = await prisma.user.findUnique({ where: { id: row.user_id } });
  if (!user) return fail(res, 'User not found', 404);

  const accessToken = signAccessToken(toClaims(user));
  res.cookie(ACCESS_COOKIE, accessToken, cookieOpts(15 * 60 * 1000));
  return ok(res, { token: accessToken, user: safeUser(user) });
});

// ---------- GET/POST /api/users/session ----------
router.get('/session', requireAuth, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: BigInt(req.user!.sub) } });
  return ok(res, { user: user ? safeUser(user) : null });
});

// ---------- POST /api/users/logout (revokes refresh token) ----------
router.post('/logout', async (req: Request, res: Response) => {
  const token = (req.cookies?.[REFRESH_COOKIE] as string | undefined) || (req.body?.refreshToken as string | undefined);
  if (token) {
    await prisma.refreshToken.updateMany({ where: { token_hash: hashRefreshToken(token) }, data: { revoked: true } });
  }
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/' });
  return ok(res);
});

// ---------- POST /api/users/deleteSelf ----------
router.post('/deleteSelf', requireAuth, async (req: Request, res: Response) => {
  await prisma.user.delete({ where: { id: BigInt(req.user!.sub) } }).catch(() => null);
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/' });
  return ok(res, { message: 'Account deleted' });
});

// ---------- Forgot / reset password (PUBLIC, no requireAuth) ----------
// Lets a logged-out user reset their password via an email OTP. Reuses the
// EmailOtp table (purpose='reset') + the existing sendMail. Enumeration-safe:
// both endpoints always return a generic 200 so they never reveal whether an
// account or email exists. Separate from the auth-gated recovery-email flow.

const forgotSendSchema = z.object({ identifier: z.string().trim().min(1) });
const RESET_GENERIC = 'If an account exists, a reset code has been sent to the registered email.';

/** Find a user by username, then mobile, then email/recovery_email. */
async function findUserByIdentifier(identifier: string) {
  const id = identifier.trim();
  const lower = id.toLowerCase();
  return prisma.user.findFirst({
    where: {
      OR: [{ username: lower }, { mobile: id }, { email: lower }, { recovery_email: lower }],
    },
  });
}

// POST /api/users/forgot-password/send { identifier } — username | mobile | email
router.post('/forgot-password/send', async (req: Request, res: Response) => {
  const parsed = forgotSendSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'Enter your username, mobile or email.', 422);

  const user = await findUserByIdentifier(parsed.data.identifier);
  // The email we send the code to: a verified recovery email first, else any email on file.
  const target = user ? (user.recovery_email || user.email || '') : '';
  if (user && target) {
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    await prisma.emailOtp.create({
      data: { email: target.toLowerCase(), otp, purpose: 'reset', expires_at: new Date(Date.now() + 10 * 60 * 1000) },
    });
    await sendMail(
      target,
      '4A Store password reset code',
      `Your 4A Store password reset code is ${otp}. It expires in 10 minutes. If you did not request this, ignore this email.`
    ).catch(() => null);
  }
  // Always generic (enumeration-safe) — never reveal whether the account/email exists.
  return ok(res, { message: RESET_GENERIC });
});

const resetSchema = z.object({
  identifier: z.string().trim().min(1),
  otp: z.string().trim().regex(/^\d{6}$/),
  newPassword: z.string().min(4),
});

// POST /api/users/reset-password { identifier, otp, newPassword }
router.post('/reset-password', async (req: Request, res: Response) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'Enter the 6-digit code and a 4+ character password.', 422);
  const { identifier, otp, newPassword } = parsed.data;

  const user = await findUserByIdentifier(identifier);
  const target = user ? (user.recovery_email || user.email || '') : '';
  if (!user || !target) return fail(res, 'Invalid or expired code', 422);

  const row = await prisma.emailOtp.findFirst({
    where: { email: target.toLowerCase(), purpose: 'reset', consumed: false, expires_at: { gt: new Date() } },
    orderBy: { id: 'desc' },
  });
  if (!row || row.otp !== otp) return fail(res, 'Invalid or expired code', 422);

  const hashed = bcrypt.hashSync(newPassword, 10);
  await prisma.$transaction([
    prisma.emailOtp.update({ where: { id: row.id }, data: { consumed: true } }),
    prisma.user.update({ where: { id: user.id }, data: { password: hashed } }),
    // Revoke existing refresh tokens so old sessions can't linger after a reset.
    prisma.refreshToken.updateMany({ where: { user_id: user.id, revoked: false }, data: { revoked: true } }),
  ]);
  // Keep the owner-approved readable copy in sync (plain_password is a raw column,
  // not a Prisma field — see ensurePlainPasswordColumn()). Best-effort.
  await prisma.$executeRawUnsafe('UPDATE users SET plain_password = ? WHERE id = ?', newPassword, user.id).catch(() => null);

  return ok(res, { message: 'Password reset successful. Please log in with your new password.' });
});

// ---------- Password-recovery email (profile page) ----------
// Mirrors the original password-recovery.php profileEmail / sendProfileEmailCode / verifyProfileEmailCode.

// GET /api/users/recovery-email → { email, verified }
router.get('/recovery-email', requireAuth, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: BigInt(req.user!.sub) } });
  if (!user) return fail(res, 'User not found', 404);
  return ok(res, { email: user.recovery_email || '', verified: !!user.recovery_email_verified });
});

const emailSchema = z.object({ email: z.string().trim().toLowerCase().email() });

// POST /api/users/recovery-email/send { email } → emails a 6-digit code (10 min)
router.post('/recovery-email/send', requireAuth, async (req: Request, res: Response) => {
  const parsed = emailSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'Enter a valid email address.', 422);
  const { email } = parsed.data;
  const userId = BigInt(req.user!.sub);

  const me = await prisma.user.findUnique({ where: { id: userId } });
  if (!me) return fail(res, 'User not found', 404);
  if (me.recovery_email === email && me.recovery_email_verified) return ok(res, { alreadyVerified: true });

  const taken = await prisma.user.findFirst({
    where: { id: { not: userId }, OR: [{ recovery_email: email }, { email }] },
  });
  if (taken) return fail(res, 'Email already linked to another account', 409);

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  await prisma.emailOtp.create({
    data: { email, otp, purpose: 'recovery', expires_at: new Date(Date.now() + 10 * 60 * 1000) },
  });
  await sendMail(email, '4A Store recovery email code', `Your 4A Store verification code is ${otp}. It expires in 10 minutes.`).catch(() => null);
  return ok(res, { message: 'Code sent', devOtp: config.env !== 'production' ? otp : undefined });
});

const verifySchema = z.object({ email: z.string().trim().toLowerCase().email(), otp: z.string().trim().regex(/^\d{6}$/) });

// POST /api/users/recovery-email/verify { email, otp } → saves the verified email
router.post('/recovery-email/verify', requireAuth, async (req: Request, res: Response) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'Enter the 6-digit code.', 422);
  const { email, otp } = parsed.data;

  const row = await prisma.emailOtp.findFirst({
    where: { email, purpose: 'recovery', consumed: false, expires_at: { gt: new Date() } },
    orderBy: { id: 'desc' },
  });
  if (!row || row.otp !== otp) return fail(res, 'Invalid or expired code.', 422);

  await prisma.$transaction([
    prisma.emailOtp.update({ where: { id: row.id }, data: { consumed: true } }),
    prisma.user.update({
      where: { id: BigInt(req.user!.sub) },
      data: { recovery_email: email, recovery_email_verified: true },
    }),
  ]);
  return ok(res, { message: 'Recovery email verified' });
});

// ---------- Set mobile (Google users) via EMAIL OTP ----------
// Lets an authenticated user (typically a Google sign-in with a 'g<digits>'
// placeholder mobile) set a real mobile number, verified by a code sent to
// their recovery/primary email. Modeled on recovery-email/send+verify; uses
// purpose='set_mobile' (NOT the signup OTP path).

// POST /api/users/mobile/send → emails a 6-digit code (10 min) to recovery/primary email
router.post('/mobile/send', requireAuth, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: BigInt(req.user!.sub) } });
  if (!user) return fail(res, 'User not found', 404);

  const target = user.recovery_email || user.email;
  if (!target) return fail(res, 'Add a recovery email first to receive the code.', 400);

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  await prisma.emailOtp.create({
    data: { email: target.toLowerCase(), otp, purpose: 'set_mobile', expires_at: new Date(Date.now() + 10 * 60 * 1000) },
  });
  await sendMail(target, '4A Store mobile verification code', `Your 4A Store code is ${otp}. It expires in 10 minutes.`).catch(() => null);
  return ok(res, { message: 'Code sent', devOtp: config.env !== 'production' ? otp : undefined });
});

const mobileVerifySchema = z.object({
  mobile: z.string().regex(/^[6-9]\d{9}$/),
  otp: z.string().trim().regex(/^\d{6}$/),
});

// POST /api/users/mobile/verify { mobile, otp } → verifies the code and saves the mobile
router.post('/mobile/verify', requireAuth, async (req: Request, res: Response) => {
  const parsed = mobileVerifySchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'Enter a valid 10-digit mobile and the 6-digit code.', 422);
  const { mobile, otp } = parsed.data;
  const id = BigInt(req.user!.sub);

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return fail(res, 'User not found', 404);
  const target = user.recovery_email || user.email;
  if (!target) return fail(res, 'Add a recovery email first to receive the code.', 422);

  const row = await prisma.emailOtp.findFirst({
    where: { email: target.toLowerCase(), purpose: 'set_mobile', consumed: false, expires_at: { gt: new Date() } },
    orderBy: { id: 'desc' },
  });
  if (!row || row.otp !== otp) return fail(res, 'Invalid or expired code.', 422);

  try {
    await prisma.user.update({ where: { id }, data: { mobile } });
  } catch (err) {
    if (err && typeof err === 'object' && (err as { code?: string }).code === 'P2002') {
      return fail(res, 'This mobile number is already registered to another account.', 409);
    }
    throw err;
  }
  await prisma.emailOtp.update({ where: { id: row.id }, data: { consumed: true } });

  const updatedUser = await prisma.user.findUnique({ where: { id } });
  return ok(res, { user: updatedUser ? safeUser(updatedUser) : null });
});

export default router;
