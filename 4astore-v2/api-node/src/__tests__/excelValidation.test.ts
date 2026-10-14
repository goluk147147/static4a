/**
 * POS Excel import validation tests (FEAT-003, acceptance: "Excel validation
 * unit test passes — precedence + error rows").
 *
 * These drive the PURE engine in services/excelImport.ts (no Express/Prisma/DB)
 * with fixture rows that cover:
 *   - every per-field rule from design §6.2 (required, ranges, decimal places),
 *   - the three-tier duplicate-detection precedence (sku → barcode → name+cat),
 *   - "prevent accidental duplicates" (a code already owned by a DIFFERENT
 *     product is an error, not a silent second insert),
 *   - in-file duplicate codes across two rows,
 *   - error rows are REPORTED (action='error'), never silently dropped,
 *   - the internal RFC-4180 CSV splitter + header aliasing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateRow,
  validateSheet,
  parseCsv,
  rowsFromMatrix,
  normaliseHeader,
  type ExistingProduct,
  type RawRow,
} from '../services/excelImport';

const NO_OPTS = { allowNegativeStock: false };

// ---------------------------------------------------------------------------
// Per-field validation (design §6.2).
// ---------------------------------------------------------------------------

test('a fully valid row cleans to typed values with no errors', () => {
  const { data, errors } = validateRow(
    {
      name: '  Maggi 70g ',
      sku: 'MG70',
      barcode: '8901234567890',
      category: 'Noodles',
      purchase_price: '10',
      selling_price: '14',
      stock: '2',
      unit: 'pcs',
      tax_rate: '5',
      low_stock_threshold: '2',
    },
    2,
    NO_OPTS
  );
  assert.deepEqual(errors, []);
  assert.equal(data.name, 'Maggi 70g');
  assert.equal(data.sku, 'MG70');
  assert.equal(data.selling_price, 14);
  assert.equal(data.purchase_price, 10);
  assert.equal(data.stock, 2);
  assert.equal(data.tax_rate, 5);
  assert.equal(data.unit, 'pcs');
});

test('name and category are required; selling_price is required ≥ 1', () => {
  const r = validateRow({ sku: 'X1' }, 2, NO_OPTS);
  assert.ok(r.errors.some((e) => /name is required/i.test(e)));
  assert.ok(r.errors.some((e) => /category is required/i.test(e)));
  assert.ok(r.errors.some((e) => /selling price is required/i.test(e)));
});

test('selling_price below 1 and above 100000 are errors', () => {
  const low = validateRow({ name: 'a', category: 'c', selling_price: '0' }, 2, NO_OPTS);
  assert.ok(low.errors.some((e) => /selling price must be at least 1/i.test(e)));
  const high = validateRow({ name: 'a', category: 'c', selling_price: '100001' }, 2, NO_OPTS);
  assert.ok(high.errors.some((e) => /selling price must be 100000 or less/i.test(e)));
});

test('money rejects more than 2 decimal places; stock rejects more than 3', () => {
  const price = validateRow({ name: 'a', category: 'c', selling_price: '14.999' }, 2, NO_OPTS);
  assert.ok(price.errors.some((e) => /2 decimal places/i.test(e)));
  const stock = validateRow({ name: 'a', category: 'c', selling_price: '14', stock: '1.2345' }, 2, NO_OPTS);
  assert.ok(stock.errors.some((e) => /3 decimal places/i.test(e)));
});

test('negative stock is an error unless the global toggle is on', () => {
  const off = validateRow({ name: 'a', category: 'c', selling_price: '14', stock: '-3' }, 2, NO_OPTS);
  assert.ok(off.errors.some((e) => /cannot be negative/i.test(e)));
  const on = validateRow(
    { name: 'a', category: 'c', selling_price: '14', stock: '-3' },
    2,
    { allowNegativeStock: true }
  );
  assert.deepEqual(on.errors, []);
  assert.equal(on.data.stock, -3);
});

test('unit must be in the allowed set; tax_rate 0..100; defaults applied', () => {
  const badUnit = validateRow({ name: 'a', category: 'c', selling_price: '14', unit: 'litres' }, 2, NO_OPTS);
  assert.ok(badUnit.errors.some((e) => /unit must be one of/i.test(e)));
  const badTax = validateRow({ name: 'a', category: 'c', selling_price: '14', tax_rate: '120' }, 2, NO_OPTS);
  assert.ok(badTax.errors.some((e) => /between 0 and 100/i.test(e)));
  const defaults = validateRow({ name: 'a', category: 'c', selling_price: '14' }, 2, NO_OPTS);
  assert.deepEqual(defaults.errors, []);
  assert.equal(defaults.data.unit, 'pcs');
  assert.equal(defaults.data.tax_rate, 0);
  assert.equal(defaults.data.stock, null);
});

test('currency symbols and thousands separators are tolerated', () => {
  const r = validateRow({ name: 'a', category: 'c', selling_price: '₹1,250.50' }, 2, NO_OPTS);
  assert.deepEqual(r.errors, []);
  assert.equal(r.data.selling_price, 1250.5);
});

test('unknown category is a warning, still importable', () => {
  const r = validateRow(
    { name: 'a', category: 'Brand New', selling_price: '14' },
    2,
    { allowNegativeStock: false, knownCategories: new Set(['noodles']) }
  );
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => /new/i.test(w)));
});

// ---------------------------------------------------------------------------
// Duplicate detection precedence + classification (design §6.2).
// ---------------------------------------------------------------------------

const existing: ExistingProduct[] = [
  { id: 10, name: 'Maggi 70g', sku: 'MG70', barcode: '8900000000001', category: 'Noodles' },
  { id: 20, name: 'Parle-G', sku: 'PG100', barcode: '8900000000002', category: 'Biscuit' },
];

test('match precedence: sku wins, then barcode, then name+category', () => {
  const rows: RawRow[] = [
    // (1) sku match → update #10 even though name/barcode differ.
    { name: 'Renamed', sku: 'MG70', category: 'Anything', selling_price: '15' },
    // (2) no sku, barcode match → update #20.
    { name: 'Whatever', barcode: '8900000000002', category: 'Biscuit', selling_price: '12' },
    // (3) no sku/barcode, name+category match (case-insensitive) → update #10.
    { name: 'maggi 70g', category: 'noodles', selling_price: '14' },
    // insert: nothing matches.
    { name: 'New Item', category: 'Misc', selling_price: '9' },
  ];
  const { rows: out, summary } = validateSheet(rows, existing, NO_OPTS);
  assert.equal(out[0].action, 'update');
  assert.equal(out[0].matchedProductId, 10);
  assert.equal(out[1].action, 'update');
  assert.equal(out[1].matchedProductId, 20);
  assert.equal(out[2].action, 'update');
  assert.equal(out[2].matchedProductId, 10);
  assert.equal(out[3].action, 'insert');
  assert.equal(out[3].matchedProductId, null);
  assert.equal(summary.update, 3);
  assert.equal(summary.insert, 1);
  assert.equal(summary.error, 0);
});

test('a code owned by a different product is an error (prevent accidental duplicates)', () => {
  // The row matches #10 by SKU (highest precedence) but carries a barcode that
  // belongs to #20 — committing it would steal #20's barcode → collision error.
  const rows: RawRow[] = [
    { name: 'Maggi 70g', category: 'Noodles', sku: 'MG70', barcode: '8900000000002', selling_price: '14' },
  ];
  const { rows: out, summary } = validateSheet(rows, existing, NO_OPTS);
  assert.equal(out[0].action, 'error');
  assert.ok(out[0].errors.some((e) => /belongs to a different product/i.test(e)));
  assert.equal(summary.error, 1);
});

test('two rows claiming the same sku both report an in-file duplicate', () => {
  const rows: RawRow[] = [
    { name: 'A', category: 'c', sku: 'DUP1', selling_price: '5' },
    { name: 'B', category: 'c', sku: 'DUP1', selling_price: '6' },
  ];
  const { rows: out } = validateSheet(rows, [], NO_OPTS);
  // The first row seeds the code; the second flags the collision.
  assert.equal(out[1].action, 'error');
  assert.ok(out[1].errors.some((e) => /duplicate sku/i.test(e)));
});

test('error rows are reported (not dropped) and counted in the summary', () => {
  const rows: RawRow[] = [
    { name: '', category: '', selling_price: '' }, // all-required missing
    { name: 'Good', category: 'c', selling_price: '10' },
  ];
  const { rows: out, summary } = validateSheet(rows, [], NO_OPTS);
  assert.equal(out.length, 2); // nothing dropped
  assert.equal(out[0].action, 'error');
  assert.ok(out[0].errors.length >= 1);
  assert.equal(out[1].action, 'insert');
  assert.equal(summary.total, 2);
  assert.equal(summary.error, 1);
  assert.equal(summary.insert, 1);
  // rowNum is 1-based on the SHEET (header = row 1, first data = row 2).
  assert.equal(out[0].rowNum, 2);
  assert.equal(out[1].rowNum, 3);
});

// ---------------------------------------------------------------------------
// Header aliasing + the internal RFC-4180 CSV splitter.
// ---------------------------------------------------------------------------

test('header aliases map to canonical keys', () => {
  assert.equal(normaliseHeader('Product Name'), 'name');
  assert.equal(normaliseHeader('SKU Code'), 'sku');
  assert.equal(normaliseHeader('Selling Price'), 'selling_price');
  assert.equal(normaliseHeader('MRP'), 'selling_price');
  assert.equal(normaliseHeader('GST %'), 'tax_rate');
  assert.equal(normaliseHeader('Reorder Level'), 'low_stock_threshold');
  assert.equal(normaliseHeader('totally unknown'), null);
});

test('CSV splitter handles quotes, escaped quotes, commas and CRLF', () => {
  const csv =
    'name,category,selling_price\r\n' +
    '"Maggi, 70g","Noodles",14\r\n' +
    '"He said ""hi""","Misc",5\r\n';
  const matrix = parseCsv(csv);
  assert.deepEqual(matrix[0], ['name', 'category', 'selling_price']);
  assert.deepEqual(matrix[1], ['Maggi, 70g', 'Noodles', '14']);
  assert.deepEqual(matrix[2], ['He said "hi"', 'Misc', '5']);
});

test('rowsFromMatrix keys by canonical header, drops unknown cols and blank rows', () => {
  const matrix = [
    ['Product', 'Price', 'Notes'],
    ['Soap', '25', 'ignore me'],
    ['', '', ''], // blank row skipped
  ];
  const { rows, headers, unknownHeaders } = rowsFromMatrix(matrix);
  assert.deepEqual(headers.sort(), ['name', 'selling_price']);
  assert.deepEqual(unknownHeaders, ['Notes']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Soap');
  assert.equal(rows[0].selling_price, '25');
});

test('an end-to-end CSV round-trip validates and classifies', () => {
  const csv = 'name,category,selling_price,stock\nSoap,Bath,25,10\n,Bath,5,1\n';
  const matrix = parseCsv(csv);
  const { rows } = rowsFromMatrix(matrix);
  const { rows: out, summary } = validateSheet(rows, [], NO_OPTS);
  assert.equal(summary.total, 2);
  assert.equal(out[0].action, 'insert');
  assert.equal(out[1].action, 'error'); // missing name
});
