/**
 * Unit test for the shared bilingual qtyLimitMessage() helper
 * (src/utils/qtyLimit.ts) used by BOTH the authoritative order-placement
 * enforcement (routes/admin.ts) and the public POST /api/cart/validate endpoint
 * (routes/cart.ts). Asserts the piece-unit vs weight-unit copy so storefront and
 * server stay identical.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qtyLimitMessage } from '../utils/qtyLimit';

test('pcs cap leaves the unit implicit', () => {
  assert.equal(qtyLimitMessage(3, 'pcs'), 'Max 3 allowed / सिर्फ 3 तक');
});

test('empty/undefined unit is treated as pcs', () => {
  assert.equal(qtyLimitMessage(3, ''), 'Max 3 allowed / सिर्फ 3 तक');
  assert.equal(qtyLimitMessage(3, null), 'Max 3 allowed / सिर्फ 3 तक');
  assert.equal(qtyLimitMessage(3), 'Max 3 allowed / सिर्फ 3 तक');
});

test('weight cap shows the unit on both sides', () => {
  assert.equal(qtyLimitMessage(1, 'kg'), 'Max 1 kg allowed / सिर्फ 1 kg तक');
  assert.equal(qtyLimitMessage(0.5, 'kg'), 'Max 0.5 kg allowed / सिर्फ 0.5 kg तक');
});
