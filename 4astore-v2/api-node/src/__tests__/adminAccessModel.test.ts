/**
 * Admin access-model regression tests — pins the permission boundary that the
 * "Owner access required" (403) Products-blank live bug hinges on.
 *
 * The live symptom was the Admin > Products page showing "0 of 0 products" after
 * an owner-only endpoint returned 403 `{success:false, message:"Owner access
 * required"}`. The verified facts: that exact string is emitted ONLY by
 * `requireOwner`; the product list is guarded by `requireStaff('products')`
 * (NOT owner-gated). These tests lock in that boundary so a future edit can't
 * accidentally owner-gate the product list, and so only genuine owner tools emit
 * the reported string.
 *
 * Pure doubles only — no DB, no real Express app — matching the
 * posLoginDecision.test.ts "drive the function directly" pattern. We build
 * minimal `req`/`res`/`next` recorders (the shared `fail()` helper calls
 * `res.status().json({success:false,message})`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response, NextFunction } from 'express';
import { requireStaff, requireOwner, hasPermission } from '../auth/middleware';
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
  return { sub: 1, role, mobile: '0000000000', username: 'u', name: 'U', permissions };
}

// --------------------------------------------------------------------------
// requireStaff('products') — the product list guard. Must admit staff; must
// NEVER require owner.
// --------------------------------------------------------------------------
test("requireStaff('products') admits owner/superadmin (implicit all perms)", () => {
  for (const role of ['owner', 'superadmin']) {
    const { rec, req, res, next } = drive(claims(role, []));
    requireStaff('products')(req, res, next);
    assert.equal(rec.nextCalled, true, `${role} should pass`);
    assert.equal(rec.statusCode, undefined);
  }
});

test("requireStaff('products') admits admin with ['*'] or ['products']", () => {
  for (const perms of [['*'], ['products'], ['products', 'orders']]) {
    const { rec, req, res, next } = drive(claims('admin', perms));
    requireStaff('products')(req, res, next);
    assert.equal(rec.nextCalled, true, `admin ${JSON.stringify(perms)} should pass`);
  }
});

test("requireStaff('products') rejects admin lacking the perm with 403 'Permission required: products'", () => {
  const { rec, req, res, next } = drive(claims('admin', ['orders']));
  requireStaff('products')(req, res, next);
  assert.equal(rec.nextCalled, false);
  assert.equal(rec.statusCode, 403);
  assert.equal(rec.body?.success, false);
  assert.equal(rec.body?.message, 'Permission required: products');
});

test("requireStaff('products') rejects customer/rider with 403 'Admin access required'", () => {
  for (const role of ['customer', 'rider']) {
    const { rec, req, res, next } = drive(claims(role, []));
    requireStaff('products')(req, res, next);
    assert.equal(rec.nextCalled, false, `${role} should be rejected`);
    assert.equal(rec.statusCode, 403);
    assert.equal(rec.body?.message, 'Admin access required');
  }
});

test("requireStaff('products') NEVER emits 'Owner access required' (not owner-gated)", () => {
  for (const role of ['superadmin', 'admin', 'customer', 'rider']) {
    const { rec, req, res, next } = drive(claims(role, role === 'admin' ? [] : []));
    requireStaff('products')(req, res, next);
    assert.notEqual(rec.body?.message, 'Owner access required', `${role} must not see the owner string`);
  }
});

// --------------------------------------------------------------------------
// requireOwner — the ONLY source of "Owner access required". Must admit only a
// genuine owner.
// --------------------------------------------------------------------------
test('requireOwner admits only role === owner', () => {
  const { rec, req, res, next } = drive(claims('owner', ['*']));
  requireOwner(req, res, next);
  assert.equal(rec.nextCalled, true);
  assert.equal(rec.statusCode, undefined);
});

test("requireOwner rejects superadmin/admin/customer with EXACT 403 'Owner access required'", () => {
  for (const role of ['superadmin', 'admin', 'customer', 'rider']) {
    const { rec, req, res, next } = drive(claims(role, ['*']));
    requireOwner(req, res, next);
    assert.equal(rec.nextCalled, false, `${role} must be rejected`);
    assert.equal(rec.statusCode, 403);
    assert.equal(rec.body?.success, false);
    assert.equal(rec.body?.message, 'Owner access required');
  }
});

test('requireOwner rejects a missing user with 401 Login required', () => {
  const { rec, req, res, next } = drive(undefined);
  requireOwner(req, res, next);
  assert.equal(rec.nextCalled, false);
  assert.equal(rec.statusCode, 401);
  assert.equal(rec.body?.message, 'Login required');
});

// --------------------------------------------------------------------------
// hasPermission — the shared helper requireStaff relies on.
// --------------------------------------------------------------------------
test('hasPermission: owner/superadmin always true; admin gated by list; others false', () => {
  assert.equal(hasPermission(claims('owner', []), 'products'), true);
  assert.equal(hasPermission(claims('superadmin', []), 'products'), true);
  assert.equal(hasPermission(claims('admin', ['*']), 'products'), true);
  assert.equal(hasPermission(claims('admin', ['products']), 'products'), true);
  assert.equal(hasPermission(claims('admin', ['orders']), 'products'), false);
  assert.equal(hasPermission(claims('customer', ['*']), 'products'), false);
  assert.equal(hasPermission(undefined, 'products'), false);
});
