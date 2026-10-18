/**
 * Admin grant-access regression tests — reproduces the "team ko access dene ke
 * bad bhi admin panel me 403" root cause and pins the fix.
 *
 * Reported symptom: after an owner grants a team member admin-panel access, that
 * member STILL gets HTTP 403 on every /api/admin/* request
 * (/api/admin/pos/dashboard, /api/admin/users, /api/admin/stats,
 * /api/admin/products). The grant DOES write the new role/permissions to the DB,
 * but requireStaff authorises off the JWT *claims* (auth/middleware.ts reads
 * req.user), and the member's already-issued access token still carries the OLD
 * claims (role 'customer', permissions []). So the 403 is produced by a STALE
 * token, not by a broken permission check.
 *
 * These tests prove both halves of that fact with pure doubles (no DB, no real
 * Express app), matching the adminAccessModel.test.ts "drive the middleware
 * directly" pattern:
 *   1. A member whose claims carry the GRANTED keys passes requireStaff for each
 *      reported route key -> next() is called (the grant, once the token is
 *      refreshed, works).
 *   2. The SAME member with STALE claims (role 'customer', permissions []) is
 *      rejected 403 'Admin access required' -> this is exactly the reported
 *      symptom the fix (refresh-on-403 + revoke-stale-tokens-on-grant) removes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response, NextFunction } from 'express';
import { requireStaff } from '../auth/middleware';
import type { AccessClaims } from '../auth/jwt';

interface Recorded {
  statusCode?: number;
  body?: { success: boolean; message?: string };
  nextCalled: boolean;
}

/** Build fake req/res/next doubles that record what the middleware did. */
function drive(user: AccessClaims | undefined) {
  const rec: Recorded = { nextCalled: false };
  const res = {
    status(code: number) {
      rec.statusCode = code;
      return this;
    },
    json(payload: { success: boolean; message?: string }) {
      rec.body = payload;
      return this;
    },
  } as unknown as Response;
  const req = { user } as unknown as Request;
  const next: NextFunction = () => {
    rec.nextCalled = true;
  };
  return { rec, req, res, next };
}

function claims(role: string, permissions: string[] = []): AccessClaims {
  return { sub: 42, role, mobile: '9876543210', username: 'teammate', name: 'Teammate', permissions };
}

// The route keys the reported endpoints are guarded by (see admin.ts /
// admin-pos.ts): /pos/dashboard + /stats -> 'dashboard', /users -> 'users',
// /products -> 'products'.
const REPORTED_ROUTE_KEYS = ['dashboard', 'users', 'products'];

// --------------------------------------------------------------------------
// After the grant (FRESH claims): the member passes every reported guard.
// --------------------------------------------------------------------------
test('granted admin with the matching permission keys passes requireStaff for every reported route', () => {
  // Member granted exactly the keys the reported endpoints require.
  const granted = claims('admin', ['dashboard', 'users', 'products']);
  for (const key of REPORTED_ROUTE_KEYS) {
    const { rec, req, res, next } = drive(granted);
    requireStaff(key)(req, res, next);
    assert.equal(rec.nextCalled, true, `admin granted '${key}' should pass requireStaff('${key}')`);
    assert.equal(rec.statusCode, undefined, `admin granted '${key}' must not be 403'd`);
  }
});

test("granted admin with ['*'] passes every reported route guard", () => {
  const granted = claims('admin', ['*']);
  for (const key of REPORTED_ROUTE_KEYS) {
    const { rec, req, res, next } = drive(granted);
    requireStaff(key)(req, res, next);
    assert.equal(rec.nextCalled, true, `admin ['*'] should pass requireStaff('${key}')`);
  }
});

// --------------------------------------------------------------------------
// Before the token refreshes (STALE claims): the member is 403'd — the reported
// symptom. This documents WHY the DB grant alone doesn't help until the token is
// re-minted (client refresh-on-403) / revoked (server) by the fix.
// --------------------------------------------------------------------------
test("stale-token member (role 'customer', permissions []) is rejected 403 'Admin access required' — the reported symptom", () => {
  const stale = claims('customer', []);
  for (const key of REPORTED_ROUTE_KEYS) {
    const { rec, req, res, next } = drive(stale);
    requireStaff(key)(req, res, next);
    assert.equal(rec.nextCalled, false, `stale 'customer' token must be rejected for '${key}'`);
    assert.equal(rec.statusCode, 403);
    assert.equal(rec.body?.success, false);
    assert.equal(rec.body?.message, 'Admin access required');
  }
});

test("stale admin token missing a granted key is rejected 403 'Permission required: <key>'", () => {
  // Token minted BEFORE the grant: role became admin but perms list is still narrow.
  const stale = claims('admin', ['orders']);
  const { rec, req, res, next } = drive(stale);
  requireStaff('products')(req, res, next);
  assert.equal(rec.nextCalled, false);
  assert.equal(rec.statusCode, 403);
  assert.equal(rec.body?.message, 'Permission required: products');
});
