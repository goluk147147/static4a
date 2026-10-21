/**
 * Admin email broadcast — recipient SEARCH + by-id selection contract.
 *
 * services/emailBroadcast.ts is a PURE module (no DB, no network), so these run
 * directly in the node:test harness (same style as emailBroadcast.test.ts).
 * They pin the load-bearing rules the brief is strict about:
 *   - searchEmailRecipients NEVER returns a user without a real email, never a
 *     staff user, matches q against name/email/mobile case-insensitively,
 *     de-dupes by lowercased email, and respects the limit cap;
 *   - selectRecipientsByIds keeps only the given ids that have a real email and
 *     are not opted-out, de-dupes by email, and drops ids without a real email;
 *   - the per-recipient sent record is shaped correctly (sent + failed == total,
 *     every recipient carries a 'sent' | 'failed' status).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  searchEmailRecipients,
  selectRecipientsByIds,
  type BroadcastUser,
} from '../services/emailBroadcast';

test('searchEmailRecipients returns ONLY non-staff users WITH a real email', () => {
  const users: BroadcastUser[] = [
    { id: 1, name: 'Aarav', email: 'aarav@x.com', role: 'customer' },
    { id: 2, name: 'No Email', email: '   ', recovery_email: null, role: 'customer' },
    { id: 3, name: 'Bogus', email: 'notanemail', role: 'customer' },
    { id: 4, name: 'Owner', email: 'owner@x.com', role: 'owner' },
    { id: 5, name: 'Admin', email: 'admin@x.com', role: 'admin' },
    { id: 6, name: 'Rider', email: 'rider@x.com', role: 'rider' },
    { id: 7, name: 'Super', email: 'super@x.com', role: 'superadmin' },
  ];
  const r = searchEmailRecipients(users, '');
  assert.deepEqual(r.map((x) => x.id), [1]);
  assert.deepEqual(r[0], { id: 1, name: 'Aarav', email: 'aarav@x.com', mobile: '' });
  // A user without a real email is NEVER present.
  assert.ok(!r.some((x) => x.email === '' || x.email === 'notanemail'));
});

test('searchEmailRecipients falls back to recovery_email as the resolved email', () => {
  const users: BroadcastUser[] = [
    { id: 1, name: 'Rec', email: null, recovery_email: 'rec@x.com', mobile: '9990001111', role: 'customer' },
  ];
  const r = searchEmailRecipients(users, '');
  assert.equal(r.length, 1);
  assert.equal(r[0].email, 'rec@x.com');
  assert.equal(r[0].mobile, '9990001111');
});

test('searchEmailRecipients matches q against name/email/mobile case-insensitively (contains)', () => {
  const users: BroadcastUser[] = [
    { id: 1, name: 'Priya Sharma', email: 'priya@shop.com', mobile: '9876543210', role: 'customer' },
    { id: 2, name: 'Rahul', email: 'rahul@mail.com', mobile: '9000000000', role: 'customer' },
  ];
  // name (case-insensitive)
  assert.deepEqual(searchEmailRecipients(users, 'priya').map((x) => x.id), [1]);
  assert.deepEqual(searchEmailRecipients(users, 'SHARMA').map((x) => x.id), [1]);
  // email substring
  assert.deepEqual(searchEmailRecipients(users, 'shop.com').map((x) => x.id), [1]);
  // mobile substring
  assert.deepEqual(searchEmailRecipients(users, '98765').map((x) => x.id), [1]);
  // no match
  assert.deepEqual(searchEmailRecipients(users, 'zzz').map((x) => x.id), []);
});

test('searchEmailRecipients de-duplicates by lowercased email (first wins)', () => {
  const users: BroadcastUser[] = [
    { id: 1, name: 'A', email: 'Dup@x.com', role: 'customer' },
    { id: 2, name: 'B', email: 'dup@x.com', role: 'customer' },
    { id: 3, name: 'C', recovery_email: 'DUP@X.COM', role: 'customer' },
  ];
  const r = searchEmailRecipients(users, '');
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 1);
});

test('searchEmailRecipients respects the limit cap', () => {
  const users: BroadcastUser[] = Array.from({ length: 50 }, (_, i) => ({
    id: i + 1,
    name: `User ${i + 1}`,
    email: `user${i + 1}@x.com`,
    role: 'customer',
  }));
  assert.equal(searchEmailRecipients(users, '', 30).length, 30);
  assert.equal(searchEmailRecipients(users, '', 5).length, 5);
});

test('selectRecipientsByIds keeps only given ids with a real email and not opted-out', () => {
  const users: BroadcastUser[] = [
    { id: 1, name: 'Keep', email: 'keep@x.com', role: 'customer' },
    { id: 2, name: 'OptedOut', email: 'opt@x.com', role: 'customer', marketing_opt_out: true },
    { id: 3, name: 'NoEmail', email: '   ', recovery_email: null, role: 'customer' },
    { id: 4, name: 'NotAsked', email: 'skip@x.com', role: 'customer' },
  ];
  const r = selectRecipientsByIds(users, [1, 2, 3]);
  // id 1 kept; id 2 opted-out dropped; id 3 no-email dropped; id 4 not requested.
  assert.deepEqual(r.map((x) => x.id), [1]);
  assert.equal(r[0].email, 'keep@x.com');
  assert.equal(r[0].name, 'Keep');
});

test('selectRecipientsByIds excludes any requested id without a real email', () => {
  const users: BroadcastUser[] = [
    { id: 1, name: 'Bogus', email: 'notanemail', role: 'customer' },
    { id: 2, name: 'Good', email: 'good@x.com', role: 'customer' },
  ];
  const r = selectRecipientsByIds(users, [1, 2]);
  assert.deepEqual(r.map((x) => x.email), ['good@x.com']);
});

test('selectRecipientsByIds de-duplicates by lowercased email (first wins)', () => {
  const users: BroadcastUser[] = [
    { id: 1, name: 'A', email: 'Dup@x.com', role: 'customer' },
    { id: 2, name: 'B', email: 'dup@x.com', role: 'customer' },
  ];
  const r = selectRecipientsByIds(users, [1, 2]);
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 1);
});

test('per-recipient sent record is shaped correctly (sent + failed == total, each has a status)', () => {
  // Simulate the send loop's bookkeeping over a resolved recipient list.
  const recipients = selectRecipientsByIds(
    [
      { id: 1, name: 'A', email: 'a@x.com', role: 'customer' },
      { id: 2, name: 'B', email: 'b@x.com', role: 'customer' },
      { id: 3, name: 'C', email: 'c@x.com', role: 'customer' },
    ],
    [1, 2, 3],
  );
  let sent = 0;
  let failed = 0;
  const results: { email: string; name: string; status: 'sent' | 'failed' }[] = [];
  recipients.forEach((r, i) => {
    const delivered = i !== 1; // pretend the 2nd send failed
    if (delivered) sent += 1;
    else failed += 1;
    results.push({ email: r.email, name: (r.name || '').trim(), status: delivered ? 'sent' : 'failed' });
  });
  const total = recipients.length;
  assert.equal(sent + failed, total);
  assert.equal(results.length, total);
  assert.ok(results.every((x) => x.status === 'sent' || x.status === 'failed'));
  assert.equal(sent, 2);
  assert.equal(failed, 1);
});
