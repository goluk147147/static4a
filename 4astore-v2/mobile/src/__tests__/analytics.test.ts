// Smoke tests for the analytics helper's no-throw contract (src/analytics.ts).
// The '@react-native-firebase/analytics' native module is mocked by loader.mjs, so these
// run in plain Node with no native dependency. The point is NOT to assert what Firebase
// received — it is to lock in the requirement that a logging call NEVER throws into the
// app, even with odd inputs. No React, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { logScreenView, logAddToCart, logPurchase, logAppOpen, logEvent } from '../analytics.ts';

test('logScreenView does not throw', () => {
  assert.doesNotThrow(() => logScreenView('/products'));
  assert.doesNotThrow(() => logScreenView('/product/[id]', 'ProductDetail'));
});

test('logAddToCart does not throw (with and without price)', () => {
  assert.doesNotThrow(() => logAddToCart({ id: 1, name: 'Milk', price: 55 }, 2));
  assert.doesNotThrow(() => logAddToCart({ id: 'abc', name: 'Rice' }, 1));
});

test('logPurchase does not throw (with and without items)', () => {
  assert.doesNotThrow(() => logPurchase('4ADEADBEEF', 250));
  assert.doesNotThrow(() =>
    logPurchase('4ADEADBEEF', 250, [{ id: 1, name: 'Milk', quantity: 2, price: 55 }])
  );
});

test('logAppOpen does not throw', () => {
  assert.doesNotThrow(() => logAppOpen());
});

test('logEvent does not throw (with and without params)', () => {
  assert.doesNotThrow(() => logEvent('custom_event'));
  assert.doesNotThrow(() => logEvent('custom_event', { foo: 'bar', n: 1, b: true }));
});
