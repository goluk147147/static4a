/**
 * Pure mobile-gate predicate tests.
 *
 * Pins the ONE rule for "real reachable Indian mobile" vs "legacy Google
 * `g<digits>` placeholder" that backs the checkout 403 gate, GET /orders/mine
 * and the web AddMobilePrompt. Pure functions only — no DB, no Express —
 * matching the posLoginDecision.test.ts import-a-pure-module pattern.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRealMobile, isGooglePlaceholderMobile } from '../auth/mobileGate';

test('isRealMobile: true for a real 10-digit 6-9 Indian mobile', () => {
  assert.equal(isRealMobile('9876543210'), true);
  assert.equal(isRealMobile('6000000000'), true);
});

test('isRealMobile: false for null, empty, placeholder, non-6-9 start and short numbers', () => {
  assert.equal(isRealMobile(null), false);
  assert.equal(isRealMobile(''), false);
  assert.equal(isRealMobile('g10873545365080'), false);
  assert.equal(isRealMobile('5876543210'), false);
  assert.equal(isRealMobile('98765'), false);
});

test('isGooglePlaceholderMobile: true for a g<digits> placeholder', () => {
  assert.equal(isGooglePlaceholderMobile('g10873545365080'), true);
});

test('isGooglePlaceholderMobile: false for bare g, non-digit suffix, a real number and null', () => {
  assert.equal(isGooglePlaceholderMobile('g'), false);
  assert.equal(isGooglePlaceholderMobile('g12ab'), false);
  assert.equal(isGooglePlaceholderMobile('9876543210'), false);
  assert.equal(isGooglePlaceholderMobile(null), false);
});
