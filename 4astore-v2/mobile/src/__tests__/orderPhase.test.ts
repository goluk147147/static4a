// Unit tests for the pure two-phase order decision (src/orderPhase.ts).
// Proves the pending→'Pending Payment'/null and confirm→'Order Placed'/UTR mapping
// (plus the confirm-without-UTR rejection) match the server branch — no React, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOrderPhase, OrderPhaseError } from '../orderPhase.ts';

test('pending -> status "Pending Payment", paymentReference null (UTR ignored)', () => {
  const r = resolveOrderPhase('pending');
  assert.equal(r.status, 'Pending Payment');
  assert.equal(r.paymentReference, null);

  // Even if a UTR is somehow supplied on a pending create, it is not stored.
  const r2 = resolveOrderPhase('pending', '123456789012');
  assert.equal(r2.status, 'Pending Payment');
  assert.equal(r2.paymentReference, null);
});

test('confirm with a 12-digit UTR -> status "Order Placed", paymentReference set', () => {
  const r = resolveOrderPhase('confirm', '123456789012');
  assert.equal(r.status, 'Order Placed');
  assert.equal(r.paymentReference, '123456789012');
});

test('confirm strips non-digits before validating a 12-digit UTR', () => {
  const r = resolveOrderPhase('confirm', '1234 5678 9012');
  assert.equal(r.status, 'Order Placed');
  assert.equal(r.paymentReference, '123456789012');
});

test('confirm without a UTR is rejected', () => {
  assert.throws(() => resolveOrderPhase('confirm'), OrderPhaseError);
  assert.throws(() => resolveOrderPhase('confirm', ''), OrderPhaseError);
});

test('confirm with a non-12-digit UTR is rejected', () => {
  assert.throws(() => resolveOrderPhase('confirm', '12345'), OrderPhaseError);
  assert.throws(() => resolveOrderPhase('confirm', '1234567890123'), OrderPhaseError);
});
