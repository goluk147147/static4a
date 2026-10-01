import jwt, { SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config';

export interface AccessClaims {
  sub: number; // user id
  role: string;
  mobile: string;
  username: string;
  name: string;
  permissions: string[];
  mode?: 'customer' | 'rider';
}

/** Short-lived access token (rotated via refresh token). */
export function signAccessToken(claims: AccessClaims): string {
  const opts: SignOptions = { expiresIn: config.accessTokenTtl as SignOptions['expiresIn'] };
  return jwt.sign(claims, config.jwtSecret, opts);
}

export function verifyAccessToken(token: string): AccessClaims {
  return jwt.verify(token, config.jwtSecret) as unknown as AccessClaims;
}

/** Opaque long-lived refresh token (stored hashed in DB) — enables life-long login. */
export function generateRefreshToken(): { token: string; hash: string; expiresAt: Date } {
  const token = crypto.randomBytes(48).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + config.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
  return { token, hash, expiresAt };
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
