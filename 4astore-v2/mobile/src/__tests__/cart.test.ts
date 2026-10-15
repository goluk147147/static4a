// Unit tests for the cart store's per-order quantity-cap clamp (src/store/cart.ts).
// Proves `add` and `setQty` clamp to the cap, carry maxQty/unit onto the item,
// refresh them from the live product, treat null/0 as unlimited, and never crash
// on a legacy persisted item that has no maxQty. No React, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resetMocks } from './helpers.ts';
import { useCart } from '../store/cart.ts';
import type { Product } from '../types.ts';

function prod(over: Partial<Product> = {}): Product {
  return {
    id: 1,
    name: 'Milk',
    category: 'Dairy',
    weight: '1 L',
    mrp: 60,
    price: 55,
    discount: 0,
    in_stock: true,
    ...over,
  };
}

test.beforeEach(() => {
  resetMocks();
  useCart.setState({ items: [] });
});

test('add clamps a NEW item to the cap and stores maxQty + unit', () => {
  useCart.getState().add(prod({ max_qty_per_order: 3, unit: 'pcs' }), 5);
  const it = useCart.getState().items[0];
  assert.equal(it.quantity, 3);
  assert.equal(it.maxQty, 3);
  assert.equal(it.unit, 'pcs');
});

test('add on an EXISTING item clamps the running sum and refreshes maxQty/unit', () => {
  useCart.getState().add(prod({ max_qty_per_order: 3 }), 2); // -> 2
  useCart.getState().add(prod({ max_qty_per_order: 3, unit: 'kg' }), 2); // 2+2=4 -> clamp 3
  const it = useCart.getState().items[0];
  assert.equal(it.quantity, 3);
  assert.equal(it.maxQty, 3);
  assert.equal(it.unit, 'kg'); // refreshed from the live product
});

test('a product with null / 0 cap is unlimited', () => {
  useCart.getState().add(prod({ id: 1, max_qty_per_order: null }), 9);
  useCart.getState().add(prod({ id: 2, max_qty_per_order: 0 }), 9);
  const items = useCart.getState().items;
  assert.equal(items.find((i) => i.id === 1)?.quantity, 9);
  assert.equal(items.find((i) => i.id === 2)?.quantity, 9);
});

test('setQty clamps up to the stored cap but leaves lower values alone', () => {
  useCart.getState().add(prod({ max_qty_per_order: 3 }), 1);
  useCart.getState().setQty(1, 10);
  assert.equal(useCart.getState().items[0].quantity, 3);
  useCart.getState().setQty(1, 2);
  assert.equal(useCart.getState().items[0].quantity, 2);
});

test('setQty(id, 0) removes the item', () => {
  useCart.getState().add(prod(), 1);
  useCart.getState().setQty(1, 0);
  assert.equal(useCart.getState().items.length, 0);
});

test('a legacy item with no maxQty is treated as unlimited and does not throw', () => {
  // Simulate a persisted cart item from before the cap feature (no maxQty/unit).
  useCart.setState({ items: [{ id: 1, name: 'Rice', price: 50, quantity: 2 }] });
  useCart.getState().setQty(1, 8);
  assert.equal(useCart.getState().items[0].quantity, 8);
});
