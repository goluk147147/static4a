// Unit tests for the per-user orders cache and per-slug CMS page cache
// (src/persistCache.ts). Proves "My Orders open" and "static (CMS) pages open"
// resolve INSTANTLY from local storage, are corrupt-safe, and isolated per key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resetMocks, apiCalls, seedRaw } from './helpers.ts';
import {
  loadOrdersCache,
  saveOrdersCache,
  loadPageCache,
  savePageCache,
} from '../persistCache.ts';
import type { Order, CmsPage } from '../types.ts';

const ORDERS_KEY = (mobile: string) => `4astore:orders:v1:${mobile}`;
const PAGE_KEY = (slug: string) => `4astore:page:v1:${slug}`;

function order(over: Partial<Order> = {}): Order {
  return {
    order_id: 'ORD-1',
    order_status: 'placed',
    order_date: '2024-01-01',
    subtotal: 100,
    discount: 0,
    delivery_charge: 10,
    total_amount: 110,
    payment_method: 'cod',
    customer: { name: 'Asha', mobile: '9990001111' },
    items: [{ name: 'Rice', price: 50, quantity: 2 }],
    ...over,
  };
}

function page(over: Partial<CmsPage> = {}): CmsPage {
  return {
    id: 1,
    slug: 'about',
    title: 'About Us',
    metaDescription: 'about',
    content: '<p>Hello</p>',
    showInFooter: true,
    ...over,
  };
}

test.beforeEach(() => resetMocks());

// --- B1: orders cache — My Orders open instant -------------------------------
test('loadOrdersCache returns null when empty', async () => {
  assert.equal(await loadOrdersCache('9990001111'), null);
  assert.equal(apiCalls().get, 0, 'orders cache read must not touch the network');
});

test('loadOrdersCache returns the saved Order[] after saveOrdersCache', async () => {
  const orders = [order({ order_id: 'A' }), order({ order_id: 'B' })];
  await saveOrdersCache('9990001111', orders);
  assert.deepEqual(await loadOrdersCache('9990001111'), orders);
});

test('loadOrdersCache returns null on corrupt JSON (never throws)', async () => {
  seedRaw(ORDERS_KEY('9990001111'), 'not-json{{');
  assert.equal(await loadOrdersCache('9990001111'), null);
});

test('orders cache is isolated per mobile number', async () => {
  await saveOrdersCache('111', [order({ order_id: 'FOR-111' })]);
  await saveOrdersCache('222', [order({ order_id: 'FOR-222' })]);
  assert.equal((await loadOrdersCache('111'))?.[0].order_id, 'FOR-111');
  assert.equal((await loadOrdersCache('222'))?.[0].order_id, 'FOR-222');
});

// --- B2: CMS page cache — static pages open instant --------------------------
test('loadPageCache returns null when empty', async () => {
  assert.equal(await loadPageCache('about'), null);
  assert.equal(apiCalls().get, 0, 'page cache read must not touch the network');
});

test('loadPageCache returns the saved CmsPage after savePageCache', async () => {
  const p = page({ slug: 'privacy', title: 'Privacy Policy' });
  await savePageCache('privacy', p);
  assert.deepEqual(await loadPageCache('privacy'), p);
});

test('loadPageCache returns null on corrupt JSON (never throws)', async () => {
  seedRaw(PAGE_KEY('about'), '<<broken');
  assert.equal(await loadPageCache('about'), null);
});

test('page cache is isolated per slug', async () => {
  await savePageCache('about', page({ slug: 'about', title: 'About' }));
  await savePageCache('terms', page({ slug: 'terms', title: 'Terms' }));
  assert.equal((await loadPageCache('about'))?.title, 'About');
  assert.equal((await loadPageCache('terms'))?.title, 'Terms');
});

// --- B3: react-query import is runtime-erasable ------------------------------
// persistCache.ts does `import type { QueryClient } from '@tanstack/react-query'`.
// If that were a runtime import this module would fail to load in plain Node
// without a react-query dependency. The fact that every test above imported and
// exercised persistCache.ts successfully (with NO @tanstack/react-query runtime
// mock being needed) proves the import is type-only and fully erased by Node's
// type-stripping. This test documents that contract explicitly.
test('persistCache imports cleanly in Node — react-query import is type-only/erased', async () => {
  const mod = await import('../persistCache.ts');
  assert.equal(typeof mod.loadOrdersCache, 'function');
  assert.equal(typeof mod.loadPageCache, 'function');
  assert.equal(typeof mod.saveOrdersCache, 'function');
  assert.equal(typeof mod.savePageCache, 'function');
});
