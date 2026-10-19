/**
 * Shared session helpers — the ONE source of truth for issuing login tokens,
 * stripping the password before serialising a user, building JWT claims and
 * detecting the native mobile client.
 *
 * These were originally module-private in routes/users.ts. They were extracted
 * here so routes/pos-auth.ts (phone-OTP login) can reuse the EXACT same token /
 * cookie / claims logic without duplicating it (duplication would risk drift in
 * cookie flags, refresh-token hashing and the `X-Client: mobile` handling).
 * routes/users.ts imports these so its behaviour is byte-for-byte unchanged.
 */
import { Request, Response } from 'express';
import { prisma } from '../db';
import { config } from '../config';
import { signAccessToken, generateRefreshToken, AccessClaims } from './jwt';

export const REFRESH_COOKIE = 'refresh_token';
export const ACCESS_COOKIE = 'access_token';

export function cookieOpts(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'lax' as const,
    maxAge: maxAgeMs,
    path: '/',
  };
}

export function toClaims(user: {
  id: bigint;
  role: string;
  mobile: string | null;
  username: string;
  name: string;
  permissions: unknown;
  backend_rider: boolean;
}): AccessClaims {
  const perms = Array.isArray(user.permissions) ? (user.permissions as string[]) : [];
  return {
    sub: Number(user.id),
    role: user.role,
    mobile: user.mobile ?? '',
    username: user.username,
    name: user.name,
    permissions: perms,
    mode: user.role === 'rider' && user.backend_rider ? 'rider' : 'customer',
  };
}

/** Native app (no cookies) sends `X-Client: mobile` and keeps the refresh token in secure storage. */
export function isMobileClient(req: Request): boolean {
  return String(req.headers['x-client'] || '').toLowerCase() === 'mobile';
}

export function safeUser(user: Record<string, unknown>) {
  const { password, ...rest } = user;
  void password;
  return rest;
}

/** Issue access + refresh tokens and set them as HttpOnly cookies (life-long login). */
export async function issueTokens(res: Response, user: Parameters<typeof toClaims>[0], deviceLabel?: string) {
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
