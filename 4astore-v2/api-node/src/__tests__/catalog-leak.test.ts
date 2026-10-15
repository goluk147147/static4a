/**
 * §10 public-catalog leakage test (acceptance criterion a / design §2.1a).
 *
 * Asserts that the shared PUBLIC_PRODUCT_SELECT projection applied by BOTH
 * public product endpoints — GET /api/products (list, findMany) and
 * GET /api/products/:id (single, findUnique) — never carries the owner-only
 * inventory/cost columns the POS work added to the Product model
 * (purchase_price, low_stock_threshold, allow_negative_stock, track_inventory),
 * while keeping the public inventory hints (stock, unit, in_stock).
 *
 * DB-free by design: the worktree has no reachable database, so instead of
 * hitting the HTTP route we exercise the SAME source-of-truth projection
 * (routes/catalogSelect.ts) that both routes pass to Prisma. Prisma's `select`
 * returns exactly the keys set to `true`, so filtering a fully-populated product
 * row by that projection reproduces the exact response-body shape of both
 * endpoints. The routes are a one-line application of this constant, so this
 * proves the shape they return.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PUBLIC_PRODUCT_SELECT, FORBIDDEN_PUBLIC_PRODUCT_FIELDS } from '../routes/catalogSelect';

/** A full products row as the DB would return it (every column, incl. owner-only). */
const FULL_PRODUCT_ROW: Record<string, unknown> = {
  id: 1n,
  name: 'Maggi 70g',
  brand: 'Nestle',
  category: 'Instant Food',
  weight: '70g',
  mrp: '14.00',
  price: '14.00',
  discount: 0,
  image: '/img/maggi.png',
  description: 'Masala noodles',
  features: [],
  seo_title: null,
  seo_description: null,
  seo_keywords: null,
  og_image: null,
  seo_slug: null,
  seo_overrides: null,
  seo_auto_json: null,
  seo_score: null,
  seo_problems: null,
  seo_generated_at: null,
  seo_source_hash: null,
  in_stock: true,
  featured: false,
  // POS/inventory columns:
  sku: 'MAG70',
  barcode: '8901234567890',
  purchase_price: '10.50', // OWNER-ONLY — must never leak
  stock: '12.000', // public hint — stays
  unit: 'pcs', // public hint — stays
  tax_rate: '0.00', // public — stays
  low_stock_threshold: '2.000', // OWNER-ONLY — must never leak
  track_inventory: true, // OWNER-ONLY — must never leak
  allow_negative_stock: false, // OWNER-ONLY — must never leak
  max_qty_per_order: '3.000', // public purchase HINT — stays
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
};

/** Reproduce Prisma `select` semantics: keep only keys whose select value is true. */
function applySelect(row: Record<string, unknown>, select: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(select)) {
    if (select[key] === true) out[key] = row[key];
  }
  return out;
}

test('GET /api/products (list) payload omits every owner-only product field', () => {
  const projected = applySelect(FULL_PRODUCT_ROW, PUBLIC_PRODUCT_SELECT as Record<string, unknown>);
  // Shape the list endpoint returns: { products: [projected, ...] }.
  const body = { products: [projected] };
  for (const field of FORBIDDEN_PUBLIC_PRODUCT_FIELDS) {
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body.products[0], field),
      `public product list leaked owner-only field "${field}"`
    );
  }
});

test('GET /api/products/:id (single) payload omits every owner-only product field', () => {
  const projected = applySelect(FULL_PRODUCT_ROW, PUBLIC_PRODUCT_SELECT as Record<string, unknown>);
  // Shape the single endpoint returns: { product: projected }.
  const body = { product: projected };
  for (const field of FORBIDDEN_PUBLIC_PRODUCT_FIELDS) {
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body.product, field),
      `public product detail leaked owner-only field "${field}"`
    );
  }
});

test('public inventory hints (stock, unit, in_stock, max_qty_per_order) ARE still exposed', () => {
  const projected = applySelect(FULL_PRODUCT_ROW, PUBLIC_PRODUCT_SELECT as Record<string, unknown>);
  for (const field of ['stock', 'unit', 'in_stock', 'max_qty_per_order']) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(projected, field),
      `public product payload is missing expected field "${field}"`
    );
  }
});
