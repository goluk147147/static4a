/**
 * Guest-push register decision — PURE helper tests (DB-free, network-free).
 *
 * Imports ONLY the dependency-free `pushAudience.ts` (no prisma/db, no Express),
 * matching the pure-import pattern of whatsappFormat.test.ts. Proves the
 * optional-auth /register route stores the right user_id + topics for both a
 * guest and an authenticated caller, WITHOUT a running DB.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerIdentity, topicsForUser } from '../services/pushAudience';

test('guest (no user) → user_id null, subscribed to all+customers (the broadcast audience)', () => {
  const out = registerIdentity(undefined);
  assert.equal(out.userId, null);
  assert.deepEqual(out.topics, ['all', 'customers']);
});

test('customer user → user_id = BigInt(sub), topics all+customers', () => {
  const out = registerIdentity({ sub: 42, role: 'customer' });
  assert.equal(out.userId, BigInt(42));
  assert.deepEqual(out.topics, ['all', 'customers']);
});

test('rider user → topics include riders (not customers)', () => {
  const out = registerIdentity({ sub: 7, role: 'rider' });
  assert.equal(out.userId, BigInt(7));
  assert.deepEqual(out.topics, ['all', 'riders']);
});

test('owner user → topics include admins', () => {
  const out = registerIdentity({ sub: 1, role: 'owner' });
  assert.equal(out.userId, BigInt(1));
  assert.ok(out.topics.includes('admins'));
});

test('admin with orders permission → topics include admins', () => {
  assert.ok(topicsForUser('admin', ['orders']).includes('admins'));
  assert.ok(topicsForUser('admin', ['*']).includes('admins'));
});

test('admin WITHOUT the orders/* permission → no admins topic', () => {
  assert.ok(!topicsForUser('admin', ['products']).includes('admins'));
});
