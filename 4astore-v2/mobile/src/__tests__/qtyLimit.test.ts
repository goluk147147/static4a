// Unit tests for the bilingual per-order quantity-cap helper (src/qtyLimit.ts).
// Proves the message copy matches the web storefront byte-for-byte and that
// `cap` normalizes any non-positive / non-numeric value to null (= unlimited).
import test from 'node:test';
import assert from 'node:assert/strict';
import { qtyLimitMsg, qtyLimitCaption, cap } from '../qtyLimit.ts';

test('qtyLimitMsg omits the unit suffix for pcs (and default)', () => {
  assert.equal(qtyLimitMsg(3), 'Max 3 allowed / सिर्फ 3 तक');
  assert.equal(qtyLimitMsg(2, 'pcs'), 'Max 2 allowed / सिर्फ 2 तक');
  assert.equal(qtyLimitMsg(2, 'PCS'), 'Max 2 allowed / सिर्फ 2 तक');
});

test('qtyLimitMsg shows the unit for weight (kg)', () => {
  assert.equal(qtyLimitMsg(1, 'kg'), 'Max 1 kg allowed / सिर्फ 1 kg तक');
});

test('qtyLimitCaption is the same copy as qtyLimitMsg', () => {
  assert.equal(qtyLimitCaption(3), qtyLimitMsg(3));
  assert.equal(qtyLimitCaption(1, 'kg'), qtyLimitMsg(1, 'kg'));
});

test('cap returns null for non-positive / non-numeric values', () => {
  assert.equal(cap(0), null);
  assert.equal(cap(-1), null);
  assert.equal(cap(null), null);
  assert.equal(cap(undefined), null);
  assert.equal(cap(NaN), null);
});

test('cap returns the positive number unchanged', () => {
  assert.equal(cap(3), 3);
  assert.equal(cap(1), 1);
});
