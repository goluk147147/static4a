import { NextFunction, Request, Response } from 'express';
import { verifyAccessToken, AccessClaims } from './jwt';
import { fail } from '../utils/http';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AccessClaims;
    }
  }
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  // Fallback to HttpOnly cookie for the web client.
  if (req.cookies && typeof req.cookies.access_token === 'string') return req.cookies.access_token;
  return null;
}

/** Attaches req.user if a valid token is present, but does not block. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (token) {
    try {
      req.user = verifyAccessToken(token);
    } catch {
      /* ignore invalid token for optional routes */
    }
  }
  next();
}

/** Blocks the request unless a valid token is present. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return fail(res, 'Login required', 401);
  try {
    req.user = verifyAccessToken(token);
    return next();
  } catch {
    return fail(res, 'Session expired. Please log in again.', 401);
  }
}

const STAFF_ROLES = ['owner', 'superadmin', 'admin'];

export function hasPermission(user: AccessClaims | undefined, permission: string): boolean {
  if (!user) return false;
  if (user.role === 'owner' || user.role === 'superadmin') return true;
  if (user.role === 'admin') {
    const perms = user.permissions || [];
    return perms.includes('*') || perms.includes(permission);
  }
  return false;
}

/** Blocks the request unless the authenticated user is the OWNER (not superadmin/admin). */
export function requireOwner(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return fail(res, 'Login required', 401);
  if (req.user.role !== 'owner') return fail(res, 'Owner access required', 403);
  return next();
}

export function requireStaff(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return fail(res, 'Login required', 401);
    if (!STAFF_ROLES.includes(req.user.role)) return fail(res, 'Admin access required', 403);
    if (!hasPermission(req.user, permission)) return fail(res, `Permission required: ${permission}`, 403);
    return next();
  };
}

/** Rider in rider mode (admin-created rider). */
export function requireRiderMode(req: Request, res: Response, next: NextFunction) {
  const u = req.user;
  if (!u) return fail(res, 'Login required', 401);
  if (u.role !== 'rider' || (u.mode || 'rider') !== 'rider') {
    return fail(res, 'Delivery mode required', 403);
  }
  return next();
}
