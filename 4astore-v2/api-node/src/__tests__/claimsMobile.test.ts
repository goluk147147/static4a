/**
 * toClaims null-mobile regression tests.
 *
 * Google sign-in now stores a NULL account mobile (no synthetic `g<sub>`
 * placeholder), so toClaims must accept mobile: string | null and emit a safe
 * '' into the JWT (AccessClaims.mobile stays a string). Pins both the null and
 * the real-number paths. Pure import of toClaims (auth/session.ts) — same style
 * as permissionsParse.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toClaims } from '../auth/session';

test('toClaims maps a NULL mobile to an empty-string claim', () => {
  const c = toClaims({
    id: 7n,
    role: 'customer',
    mobile: null,
    username: 'u',
    name: 'U',
    permissions: [],
    backend_rider: false,
  });
  assert.equal(c.mobile, '');
});

test('toClaims passes a real mobile straight through', () => {
  const c = toClaims({
    id: 7n,
    role: 'customer',
    mobile: '9876543210',
    username: 'u',
    name: 'U',
    permissions: [],
    backend_rider: false,
  });
  assert.equal(c.mobile, '9876543210');
});
