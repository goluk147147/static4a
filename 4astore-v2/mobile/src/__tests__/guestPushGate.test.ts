// Unit tests for the pure push-registration gate (src/pushGate.ts).
// Proves a GUEST (no login / no access token) still passes the gate, so a freshly
// installed app registers its FCM token and receives broadcast/promo pushes. The only
// gates are a push-enabled build (HAS_PUSH) and a real device.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRegisterPush } from '../pushGate.ts';

test('guest on a real push-enabled build registers (login state is irrelevant)', () => {
  assert.equal(shouldRegisterPush({ hasPush: true, isDevice: true }), true);
});

test('no push config (HAS_PUSH false) → do not register', () => {
  assert.equal(shouldRegisterPush({ hasPush: false, isDevice: true }), false);
});

test('simulator / not a real device → do not register', () => {
  assert.equal(shouldRegisterPush({ hasPush: true, isDevice: false }), false);
});

test('neither push nor device → do not register', () => {
  assert.equal(shouldRegisterPush({ hasPush: false, isDevice: false }), false);
});
