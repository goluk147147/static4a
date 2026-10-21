/**
 * Admin email broadcast — recipient selection + image absolutization contract.
 *
 * services/emailBroadcast.ts is a PURE module (no DB, no network), so it runs
 * directly in the node:test harness. These tests pin the load-bearing audience
 * rules: real-email only, opt-out excluded, staff excluded, de-duped, segment
 * respected — plus that image URLs become absolute (and data:/empty are dropped).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickRealEmail,
  selectEmailRecipients,
  absolutizeImageUrl,
  type BroadcastUser,
} from '../services/emailBroadcast';

const SITE = 'https://4astore.com';
const API = 'https://4astore.com/api';

test('pickRealEmail prefers email, falls back to recovery_email, rejects non-emails', () => {
  assert.equal(pickRealEmail({ id: 1, email: 'a@x.com', recovery_email: 'b@x.com' }), 'a@x.com');
  assert.equal(pickRealEmail({ id: 2, email: null, recovery_email: 'b@x.com' }), 'b@x.com');
  assert.equal(pickRealEmail({ id: 3, email: '  ', recovery_email: 'c@x.com' }), 'c@x.com');
  assert.equal(pickRealEmail({ id: 4, email: 'notanemail', recovery_email: null }), null);
  assert.equal(pickRealEmail({ id: 5, email: null, recovery_email: null }), null);
});

test('selectEmailRecipients excludes opted-out customers', () => {
  const users: BroadcastUser[] = [
    { id: 1, email: 'keep@x.com', role: 'customer', marketing_opt_out: false },
    { id: 2, email: 'opt@x.com', role: 'customer', marketing_opt_out: true },
  ];
  const r = selectEmailRecipients(users, 'all');
  assert.deepEqual(r.map((x) => x.email), ['keep@x.com']);
});

test('selectEmailRecipients excludes users with no real email', () => {
  const users: BroadcastUser[] = [
    { id: 1, email: 'ok@x.com', role: 'customer' },
    { id: 2, email: '   ', recovery_email: null, role: 'customer' },
    { id: 3, email: 'bogus', role: 'customer' },
  ];
  const r = selectEmailRecipients(users, 'all');
  assert.deepEqual(r.map((x) => x.email), ['ok@x.com']);
});

test('selectEmailRecipients de-duplicates by lowercased email (first wins)', () => {
  const users: BroadcastUser[] = [
    { id: 1, email: 'Dup@x.com', role: 'customer' },
    { id: 2, email: 'dup@x.com', role: 'customer' },
    { id: 3, recovery_email: 'DUP@X.COM', role: 'customer' },
  ];
  const r = selectEmailRecipients(users, 'all');
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 1);
});

test("target 'customers' keeps only customers; excludes staff and riders", () => {
  const users: BroadcastUser[] = [
    { id: 1, email: 'cust@x.com', role: 'customer' },
    { id: 2, email: 'owner@x.com', role: 'owner' },
    { id: 3, email: 'admin@x.com', role: 'admin' },
    { id: 4, email: 'super@x.com', role: 'superadmin' },
    { id: 5, email: 'rider@x.com', role: 'rider' },
  ];
  const r = selectEmailRecipients(users, 'customers');
  assert.deepEqual(r.map((x) => x.email), ['cust@x.com']);
});

test("target 'all' keeps customers but still excludes staff and riders", () => {
  const users: BroadcastUser[] = [
    { id: 1, email: 'cust@x.com', role: 'customer' },
    { id: 2, email: 'admin@x.com', role: 'admin' },
    { id: 3, email: 'rider@x.com', role: 'rider' },
    { id: 4, email: 'owner@x.com', role: 'owner' },
  ];
  const r = selectEmailRecipients(users, 'all');
  assert.deepEqual(r.map((x) => x.email), ['cust@x.com']);
});

test('absolutizeImageUrl passes through https and absolutizes relative paths', () => {
  assert.equal(absolutizeImageUrl('https://cdn.x.com/a.png', SITE, API), 'https://cdn.x.com/a.png');
  assert.equal(
    absolutizeImageUrl('/api/uploads/banners/x.png', SITE, API),
    'https://4astore.com/api/uploads/banners/x.png',
  );
  assert.equal(absolutizeImageUrl('/foo.png', SITE, API), 'https://4astore.com/foo.png');
});

test('absolutizeImageUrl returns undefined for empty and data: URIs', () => {
  assert.equal(absolutizeImageUrl('', SITE, API), undefined);
  assert.equal(absolutizeImageUrl('   ', SITE, API), undefined);
  assert.equal(absolutizeImageUrl('data:image/png;base64,AAAA', SITE, API), undefined);
  assert.equal(absolutizeImageUrl(undefined, SITE, API), undefined);
});
