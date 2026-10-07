// Unit tests for the pure profile-gate helper (src/profileGate.ts).
// Proves the "Complete your profile" trigger fires for the Google 'g<digits>' placeholder and any
// empty/short/invalid mobile, and never for a real 10-digit number or a null user.
import test from 'node:test';
import assert from 'node:assert/strict';
import { needsRealMobile } from '../profileGate.ts';

test('null user -> false (nothing to gate)', () => {
  assert.equal(needsRealMobile(null), false);
  assert.equal(needsRealMobile(undefined), false);
});

test('a real 10-digit mobile -> false (no gate)', () => {
  assert.equal(needsRealMobile({ mobile: '9876543210' }), false);
});

test("the Google 'g<digits>' placeholder -> true (gate)", () => {
  assert.equal(needsRealMobile({ mobile: 'g1234567890' }), true);
});

test('empty string mobile -> true (gate)', () => {
  assert.equal(needsRealMobile({ mobile: '' }), true);
});

test('undefined mobile -> true (gate)', () => {
  assert.equal(needsRealMobile({ mobile: undefined }), true);
});

test('a non-starting-digit (does not start 6-9) -> true (gate)', () => {
  assert.equal(needsRealMobile({ mobile: '1234567890' }), true);
});
