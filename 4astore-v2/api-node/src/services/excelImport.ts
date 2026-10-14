/**
 * POS Excel import — the PURE parse / validate / duplicate-detection engine
 * (design §6.2). This module has NO Express / Prisma / DB import on purpose so
 * it is unit-tested directly (src/__tests__/excelValidation.test.ts) with
 * fixture rows, and the route layer (routes/pos-import.ts) feeds it the parsed
 * sheet rows + the small set of existing products it looked up.
 *
 * INVARIANTS (owned here):
 *   - Money columns (purchase_price, selling_price) are DECIMAL(10,2): 0..100000
 *     / 1..100000, <= 2 decimal places. Validated via integer-paise rounding so
 *     there is no float-equality drift (mirrors services/posBilling.ts).
 *   - Stock / low_stock_threshold are DECIMAL(10,3): <= 3 decimal places.
 *   - Every bad row is REPORTED as action='error' with a human message — never
 *     silently dropped (satisfies "row-wise errors + corrected re-upload").
 *   - Duplicate detection precedence: (1) sku, else (2) barcode, else (3)
 *     case-insensitive name + category. A row whose sku/barcode collides with a
 *     DIFFERENT existing product (not its own match) is an error, not a silent
 *     second insert ("prevent accidental duplicates").
 */

/** Canonical header keys we import, in sheet order. */
export const IMPORT_HEADERS = [
  'name',
  'sku',
  'barcode',
  'category',
  'purchase_price',
  'selling_price',
  'stock',
  'unit',
  'tax_rate',
  'low_stock_threshold',
] as const;

export type ImportHeader = (typeof IMPORT_HEADERS)[number];

/** Common header aliases → canonical key (lower-cased, trimmed, non-alnum stripped). */
const HEADER_ALIASES: Record<string, ImportHeader> = {
  name: 'name',
  productname: 'name',
  product: 'name',
  itemname: 'name',
  item: 'name',
  sku: 'sku',
  skucode: 'sku',
  code: 'sku',
  barcode: 'barcode',
  ean: 'barcode',
  upc: 'barcode',
  category: 'category',
  cat: 'category',
  purchaseprice: 'purchase_price',
  costprice: 'purchase_price',
  cost: 'purchase_price',
  purchase: 'purchase_price',
  sellingprice: 'selling_price',
  price: 'selling_price',
  saleprice: 'selling_price',
  mrp: 'selling_price',
  rate: 'selling_price',
  stock: 'stock',
  quantity: 'stock',
  qty: 'stock',
  currentstock: 'stock',
  unit: 'unit',
  uom: 'unit',
  taxrate: 'tax_rate',
  tax: 'tax_rate',
  gst: 'tax_rate',
  lowstockthreshold: 'low_stock_threshold',
  lowstock: 'low_stock_threshold',
  reorderlevel: 'low_stock_threshold',
  threshold: 'low_stock_threshold',
};

/** Allowed units (default `pcs`). */
export const ALLOWED_UNITS = ['pcs', 'g', 'kg', 'mg', 'ml', 'l', 'dozen', 'pack', 'box', 'unit'];

/** Normalise a header cell to its canonical key (or null if unknown). */
export function normaliseHeader(raw: unknown): ImportHeader | null {
  const key = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return HEADER_ALIASES[key] ?? null;
}

/** The validated/cleaned per-field values that go to the DB on commit. */
export interface CleanRowData {
  name: string;
  sku: string | null;
  barcode: string | null;
  category: string;
  purchase_price: number | null;
  selling_price: number;
  stock: number | null;
  unit: string;
  tax_rate: number;
  low_stock_threshold: number | null;
}

export interface PreviewRow {
  rowNum: number;
  action: 'insert' | 'update' | 'error';
  /** Cleaned data when valid; the raw echo otherwise (so the UI can show it). */
  data: Partial<CleanRowData> & Record<string, unknown>;
  /** Matched existing product id for an update, else null. */
  matchedProductId: number | null;
  errors: string[];
  /** Non-fatal notices (e.g. unknown category) — importable. */
  warnings: string[];
}

export interface PreviewSummary {
  total: number;
  insert: number;
  update: number;
  error: number;
}

/** The minimal existing-product shape the route looks up for duplicate detection. */
export interface ExistingProduct {
  id: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  category: string | null;
}

/** A raw sheet row as a header→cell map (cells are strings/numbers/null). */
export type RawRow = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Field validators (pure). Each returns { value } or throws a human message.
// ---------------------------------------------------------------------------

class FieldError extends Error {}

const PRICE_MAX = 100000;
const STOCK_MAX = 50000;

function toTrimmedString(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

/** Parse a numeric cell tolerant of currency symbols / commas; '' → null. */
function parseNumberCell(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  const s = String(v).trim();
  if (s === '') return null;
  const cleaned = s.replace(/[₹,\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

/** Enforce a max number of decimal places without float drift. */
function hasAtMostDp(value: number, dp: number): boolean {
  const factor = 10 ** dp;
  const scaled = Math.round(value * factor);
  return Math.abs(scaled / factor - value) < 1e-9;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function validateName(v: unknown): string {
  const s = toTrimmedString(v);
  if (!s) throw new FieldError('Name is required.');
  if (s.length > 200) throw new FieldError('Name must be 200 characters or fewer.');
  return s;
}

function validateCode(v: unknown, label: string): string | null {
  const s = toTrimmedString(v);
  if (!s) return null;
  if (s.length > 64) throw new FieldError(`${label} must be 64 characters or fewer.`);
  return s;
}

function validateCategory(v: unknown): string {
  const s = toTrimmedString(v);
  if (!s) throw new FieldError('Category is required.');
  if (s.length > 120) throw new FieldError('Category must be 120 characters or fewer.');
  return s;
}

function validateMoney(v: unknown, label: string, required: boolean, min: number): number | null {
  const n = parseNumberCell(v);
  if (n == null) {
    if (required) throw new FieldError(`${label} is required.`);
    return null;
  }
  if (Number.isNaN(n)) throw new FieldError(`${label} must be a number.`);
  if (n < min) throw new FieldError(`${label} must be at least ${min}.`);
  if (n > PRICE_MAX) throw new FieldError(`${label} must be ${PRICE_MAX} or less.`);
  if (!hasAtMostDp(n, 2)) throw new FieldError(`${label} supports at most 2 decimal places.`);
  return round2(n);
}

function validateStock(v: unknown, allowNegative: boolean): number | null {
  const n = parseNumberCell(v);
  if (n == null) return null;
  if (Number.isNaN(n)) throw new FieldError('Stock must be a number.');
  if (n < 0 && !allowNegative) throw new FieldError('Stock cannot be negative.');
  if (Math.abs(n) > STOCK_MAX) throw new FieldError(`Stock must be between -${STOCK_MAX} and ${STOCK_MAX}.`);
  if (!hasAtMostDp(n, 3)) throw new FieldError('Stock supports at most 3 decimal places.');
  return round3(n);
}

function validateUnit(v: unknown): string {
  const s = toTrimmedString(v).toLowerCase();
  if (!s) return 'pcs';
  if (!ALLOWED_UNITS.includes(s)) {
    throw new FieldError(`Unit must be one of: ${ALLOWED_UNITS.join(', ')}.`);
  }
  return s;
}

function validateTaxRate(v: unknown): number {
  const n = parseNumberCell(v);
  if (n == null) return 0;
  if (Number.isNaN(n)) throw new FieldError('Tax rate must be a number.');
  if (n < 0 || n > 100) throw new FieldError('Tax rate must be between 0 and 100.');
  if (!hasAtMostDp(n, 2)) throw new FieldError('Tax rate supports at most 2 decimal places.');
  return round2(n);
}

function validateThreshold(v: unknown): number | null {
  const n = parseNumberCell(v);
  if (n == null) return null;
  if (Number.isNaN(n)) throw new FieldError('Low-stock threshold must be a number.');
  if (n < 0) throw new FieldError('Low-stock threshold cannot be negative.');
  if (n > STOCK_MAX) throw new FieldError(`Low-stock threshold must be ${STOCK_MAX} or less.`);
  if (!hasAtMostDp(n, 3)) throw new FieldError('Low-stock threshold supports at most 3 decimal places.');
  return round3(n);
}

// ---------------------------------------------------------------------------
// Row + sheet validation.
// ---------------------------------------------------------------------------

export interface ValidateOptions {
  allowNegativeStock: boolean;
  /** Known category names (lower-cased) — unknown category is a warning, still importable. */
  knownCategories?: Set<string>;
}

/**
 * Validate ONE raw row (header→cell map). Returns the cleaned data + a list of
 * field errors/warnings. This is the function the unit test drives directly.
 */
export function validateRow(
  raw: RawRow,
  rowNum: number,
  opts: ValidateOptions
): { data: Partial<CleanRowData> & Record<string, unknown>; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const data: Partial<CleanRowData> & Record<string, unknown> = {};

  const run = <T>(fn: () => T, assign: (v: T) => void) => {
    try {
      assign(fn());
    } catch (e) {
      if (e instanceof FieldError) errors.push(e.message);
      else errors.push('Invalid value.');
    }
  };

  run(() => validateName(raw.name), (v) => (data.name = v));
  run(() => validateCode(raw.sku, 'SKU'), (v) => (data.sku = v));
  run(() => validateCode(raw.barcode, 'Barcode'), (v) => (data.barcode = v));
  run(() => validateCategory(raw.category), (v) => (data.category = v));
  run(() => validateMoney(raw.purchase_price, 'Purchase price', false, 0), (v) => (data.purchase_price = v));
  run(() => validateMoney(raw.selling_price, 'Selling price', true, 1), (v) => (data.selling_price = v as number));
  run(() => validateStock(raw.stock, opts.allowNegativeStock), (v) => (data.stock = v));
  run(() => validateUnit(raw.unit), (v) => (data.unit = v));
  run(() => validateTaxRate(raw.tax_rate), (v) => (data.tax_rate = v));
  run(() => validateThreshold(raw.low_stock_threshold), (v) => (data.low_stock_threshold = v));

  // Unknown category is a non-fatal warning (mirrors the free-text products.category).
  if (typeof data.category === 'string' && opts.knownCategories && opts.knownCategories.size) {
    if (!opts.knownCategories.has(data.category.toLowerCase())) {
      warnings.push(`Category "${data.category}" is new and will be created as free text.`);
    }
  }

  return { data, errors, warnings };
}

/**
 * Validate the whole sheet, detect existing-product matches + in-file
 * duplicates, and classify each row insert / update / error.
 *
 * @param rows   parsed raw rows (header→cell), in sheet order (rowNum starts at 2
 *               because row 1 is the header)
 * @param existing  the existing products the route looked up (by sku/barcode/name)
 */
export function validateSheet(
  rows: RawRow[],
  existing: ExistingProduct[],
  opts: ValidateOptions
): { rows: PreviewRow[]; summary: PreviewSummary } {
  // Index existing products for the three-tier precedence match.
  const bySku = new Map<string, ExistingProduct>();
  const byBarcode = new Map<string, ExistingProduct>();
  const byNameCat = new Map<string, ExistingProduct>();
  for (const p of existing) {
    if (p.sku) bySku.set(p.sku.toLowerCase(), p);
    if (p.barcode) byBarcode.set(p.barcode.toLowerCase(), p);
    byNameCat.set(`${(p.name || '').toLowerCase()}|${(p.category || '').toLowerCase()}`, p);
  }

  // Track codes already seen in THIS file so two rows cannot claim one sku/barcode.
  const seenSku = new Map<string, number>(); // lower(sku) -> rowNum
  const seenBarcode = new Map<string, number>();

  const out: PreviewRow[] = [];
  let insert = 0;
  let update = 0;
  let error = 0;

  rows.forEach((raw, i) => {
    const rowNum = i + 2; // header is row 1
    const { data, errors, warnings } = validateRow(raw, rowNum, opts);

    let matchedProductId: number | null = null;

    const sku = typeof data.sku === 'string' ? data.sku.toLowerCase() : null;
    const barcode = typeof data.barcode === 'string' ? data.barcode.toLowerCase() : null;

    // In-file duplicate codes (only meaningful if the field itself validated).
    if (sku) {
      const prev = seenSku.get(sku);
      if (prev != null) errors.push(`Duplicate SKU "${data.sku}" also on row ${prev}.`);
      else seenSku.set(sku, rowNum);
    }
    if (barcode) {
      const prev = seenBarcode.get(barcode);
      if (prev != null) errors.push(`Duplicate barcode "${data.barcode}" also on row ${prev}.`);
      else seenBarcode.set(barcode, rowNum);
    }

    // Duplicate detection precedence: sku -> barcode -> name+category.
    let match: ExistingProduct | undefined;
    if (sku) match = bySku.get(sku);
    if (!match && barcode) match = byBarcode.get(barcode);
    if (!match && typeof data.name === 'string' && typeof data.category === 'string') {
      match = byNameCat.get(`${data.name.toLowerCase()}|${data.category.toLowerCase()}`);
    }

    // "Prevent accidental duplicates": if this row's sku belongs to a DIFFERENT
    // existing product than the one it matched, it would create a collision.
    if (sku) {
      const skuOwner = bySku.get(sku);
      if (skuOwner && match && skuOwner.id !== match.id) {
        errors.push(`SKU "${data.sku}" already belongs to a different product.`);
      }
    }
    if (barcode) {
      const barcodeOwner = byBarcode.get(barcode);
      if (barcodeOwner && match && barcodeOwner.id !== match.id) {
        errors.push(`Barcode "${data.barcode}" already belongs to a different product.`);
      }
    }

    let action: PreviewRow['action'];
    if (errors.length) {
      action = 'error';
      error += 1;
    } else if (match) {
      action = 'update';
      matchedProductId = match.id;
      update += 1;
    } else {
      action = 'insert';
      insert += 1;
    }

    out.push({ rowNum, action, data, matchedProductId, errors, warnings });
  });

  return {
    rows: out,
    summary: { total: rows.length, insert, update, error },
  };
}

// ---------------------------------------------------------------------------
// CSV parsing — a small internal RFC-4180 splitter (no new dependency).
// ---------------------------------------------------------------------------

/**
 * Parse CSV text into an array of string-cell rows. Handles quoted fields,
 * escaped double-quotes ("") and CRLF/LF line endings per RFC 4180.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  // Strip a leading UTF-8 BOM if present.
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      // swallow — handled by the following \n (or treat lone \r as newline)
      if (s[i + 1] !== '\n') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
      }
    } else if (ch === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  // Flush the final field/row if the file did not end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Turn an array-of-arrays (first row = headers) into header→cell maps keyed by
 * the canonical import header. Unknown columns are dropped. Fully-empty rows are
 * skipped. Returns { rows, headers, unknownHeaders }.
 */
export function rowsFromMatrix(matrix: string[][]): {
  rows: RawRow[];
  headers: ImportHeader[];
  unknownHeaders: string[];
} {
  if (!matrix.length) return { rows: [], headers: [], unknownHeaders: [] };
  const headerCells = matrix[0];
  const headers: (ImportHeader | null)[] = headerCells.map(normaliseHeader);
  const known = headers.filter((h): h is ImportHeader => h != null);
  const unknownHeaders = headerCells
    .filter((_, idx) => headers[idx] == null)
    .map((h) => String(h ?? '').trim())
    .filter(Boolean);

  const rows: RawRow[] = [];
  for (let r = 1; r < matrix.length; r += 1) {
    const cells = matrix[r];
    if (!cells || cells.every((c) => String(c ?? '').trim() === '')) continue; // skip blank rows
    const obj: RawRow = {};
    headers.forEach((h, idx) => {
      if (h) obj[h] = cells[idx] ?? '';
    });
    rows.push(obj);
  }
  return { rows, headers: known, unknownHeaders };
}
