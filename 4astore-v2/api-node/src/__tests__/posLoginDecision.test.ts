/**
 * POS login no-downgrade decision tests.
 *
 * Pins the rule "POS login may raise or keep privileges, never reduce them"
 * (routes/pos-auth.ts existing-user branch), reproducing the production incident
 * where an owner's number sat in admin_phones as a limited `staff` entry and the
 * old blind-overwrite demoted the owner to role=admin perms=["orders","dashboard"].
 *
 * Pure functions only — no DB, no Express — matching the posBilling.test.ts
 * import-a-pure-function pattern.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidePosLogin, roleRank, unionPerms } from '../auth/pos-login-decision';

test('roleRank: owner === superadmin > admin > rest', () => {
  assert.equal(roleRank('owner'), 3);
  assert.equal(roleRank('superadmin'), 3);
  assert.equal(roleRank('admin'), 2);
  assert.equal(roleRank('rider'), 1);
  assert.equal(roleRank('customer'), 1);
  assert.equal(roleRank('anything-else'), 1);
});

test('unionPerms: de-duped union, with "*" collapsing to ["*"]', () => {
  assert.deepEqual(unionPerms(['orders'], ['dashboard']).sort(), ['dashboard', 'orders']);
  assert.deepEqual(unionPerms(['orders'], ['orders']), ['orders']);
  assert.deepEqual(unionPerms(['*'], ['orders']), ['*']);
  assert.deepEqual(unionPerms(['orders'], ['*']), ['*']);
  assert.deepEqual(unionPerms([], []), []);
});

test('PRODUCTION INCIDENT: existing owner + limited staff allowlist entry STAYS owner', () => {
  // The exact regression: owner's number present as a `staff` admin_phones row
  // (allowlist role → admin, perms ["orders","dashboard"]). Must NOT downgrade.
  const result = decidePosLogin({
    existingRole: 'owner',
    existingPermissions: ['*'],
    allowlistRole: 'admin',
    allowlistPermissions: ['orders', 'dashboard'],
  });
  assert.equal(result.role, 'owner');
  assert.deepEqual(result.permissions, ['*']);
});

test('existing superadmin + allowlist admin STAYS superadmin', () => {
  const result = decidePosLogin({
    existingRole: 'superadmin',
    existingPermissions: [],
    allowlistRole: 'admin',
    allowlistPermissions: ['orders'],
  });
  assert.equal(result.role, 'superadmin');
  assert.deepEqual(result.permissions, []);
});

test('existing customer + allowlist admin UPGRADES to admin with allowlist perms', () => {
  const result = decidePosLogin({
    existingRole: 'customer',
    existingPermissions: [],
    allowlistRole: 'admin',
    allowlistPermissions: ['pos', 'orders'],
  });
  assert.equal(result.role, 'admin');
  assert.deepEqual(result.permissions, ['pos', 'orders']);
});

test('existing customer + allowlist owner UPGRADES to owner', () => {
  const result = decidePosLogin({
    existingRole: 'customer',
    existingPermissions: [],
    allowlistRole: 'owner',
    allowlistPermissions: ['*'],
  });
  assert.equal(result.role, 'owner');
  assert.deepEqual(result.permissions, ['*']);
});

test('EQUAL admin: permissions are UNIONED, never shrunk', () => {
  const result = decidePosLogin({
    existingRole: 'admin',
    existingPermissions: ['orders'],
    allowlistRole: 'admin',
    allowlistPermissions: ['dashboard'],
  });
  assert.equal(result.role, 'admin');
  assert.deepEqual(result.permissions.sort(), ['dashboard', 'orders']);
});

test('EQUAL admin: "*" on either side keeps full access', () => {
  const existingStar = decidePosLogin({
    existingRole: 'admin',
    existingPermissions: ['*'],
    allowlistRole: 'admin',
    allowlistPermissions: ['orders'],
  });
  assert.deepEqual(existingStar.permissions, ['*']);

  const allowlistStar = decidePosLogin({
    existingRole: 'admin',
    existingPermissions: ['orders'],
    allowlistRole: 'admin',
    allowlistPermissions: ['*'],
  });
  assert.deepEqual(allowlistStar.permissions, ['*']);
});

test('EQUAL admin: existing broad perms are not reduced by a narrower allowlist', () => {
  const result = decidePosLogin({
    existingRole: 'admin',
    existingPermissions: ['orders', 'dashboard', 'pos', 'inventory'],
    allowlistRole: 'admin',
    allowlistPermissions: ['orders'],
  });
  assert.equal(result.role, 'admin');
  // No permission the user already had is dropped.
  for (const p of ['orders', 'dashboard', 'pos', 'inventory']) {
    assert.ok(result.permissions.includes(p), `kept ${p}`);
  }
});
