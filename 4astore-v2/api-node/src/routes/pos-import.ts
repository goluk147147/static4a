/**
 * POS Excel import / export + bulk update + audit log (design §6). Mounted at
 * /api/admin/pos (alongside admin-pos's /phones), BEFORE the generic /api/admin
 * router. EVERY route is requireAuth + requireStaff('inventory') — protected
 * server-side, never by frontend hiding.
 *
 * Flow (design §6.1):
 *   - POST /import/preview (multipart `file`) — parse .xlsx/.csv, per-row
 *     validate (services/excelImport.ts), detect existing products, create a
 *     pos_import_batches row status='previewed' with the row-wise error list,
 *     and return the classified rows. NO product write.
 *   - POST /import/commit {batchPreviewId, rows} — RE-VALIDATE server-side
 *     (never trust the client echo), then in ONE prisma.$transaction insert new
 *     + update existing products, writing a product_change_log row per changed
 *     field and a stock_movements (reason='import') row per stock change,
 *     recompute in_stock, update the batch counters + status='committed'. A
 *     mid-file failure rolls the whole batch back and marks status='failed'.
 *   - GET /export/products.xlsx — stream the full product + inventory workbook.
 *   - POST /bulk-update {field, updates[]} — transactional bulk price/stock
 *     update with change-log + (for stock) stock_movements (reason='bulk_update').
 *   - GET /import/history — keyset list of batches.
 *   - GET /change-log?productId=&limit=&cursor= — product change log.
 *
 * POS tables (pos_import_batches, product_change_log, stock_movements) are
 * runtime-created and their Prisma delegates are NOT generated in the worktree,
 * so they are read/written via raw $queryRawUnsafe/$executeRawUnsafe —
 * consistent with routes/pos.ts and routes/admin-pos.ts. `products` IS a
 * generated model but is also touched via raw SQL inside the tx so the
 * per-product UPDATE + atomic read are expressed directly.
 */
import { Router, Request, Response } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { prisma } from '../db';
import { ok, fail } from '../utils/http';
import { requireAuth, requireStaff } from '../auth/middleware';
import {
  validateSheet,
  validateRow,
  parseCsv,
  rowsFromMatrix,
  normaliseHeader,
  IMPORT_HEADERS,
  type RawRow,
  type ExistingProduct,
  type PreviewRow,
  type CleanRowData,
} from '../services/excelImport';
import * as posNotify from '../services/posNotify';

/**
 * A manual/bulk stock adjustment fires an owner push only when the absolute
 * change is "significant" (design §7). Default: |Δ| >= 10 units. Kept here as a
 * single tunable so the threshold is easy to find and change.
 */
const SIGNIFICANT_STOCK_DELTA = 10;

const router = Router();
router.use(requireAuth, requireStaff('inventory'));

// --------------------------------------------------------------------------
// Upload — memory storage, 5 MB, accept .xlsx / .csv by extension.
// --------------------------------------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = (file.originalname || '').toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.csv')) cb(null, true);
    else cb(new Error('Only .xlsx or .csv files are accepted.'));
  },
});

const actor = (req: Request): string =>
  req.user?.username || req.user?.mobile || String(req.user?.sub ?? 'staff');

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  return Number(v);
}

// Magic bytes: .xlsx is a ZIP ("PK\x03\x04"); CSV is plain text (no reliable
// signature) so it is accepted by extension + successful parse.
const XLSX_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
function looksLikeXlsx(buf: Buffer): boolean {
  return buf.length >= 4 && buf.subarray(0, 4).equals(XLSX_MAGIC);
}

// --------------------------------------------------------------------------
// Parse an uploaded buffer into canonical header→cell raw rows.
// --------------------------------------------------------------------------
async function parseWorkbook(
  buf: Buffer,
  filename: string
): Promise<{ rows: RawRow[]; unknownHeaders: string[] }> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv') && !looksLikeXlsx(buf)) {
    const matrix = parseCsv(buf.toString('utf8'));
    const { rows, unknownHeaders } = rowsFromMatrix(matrix);
    return { rows, unknownHeaders };
  }

  // .xlsx (ZIP). exceljs reads the first worksheet.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return { rows: [], unknownHeaders: [] };

  // Build the header map from the first row.
  const headerRow = ws.getRow(1);
  const colToHeader = new Map<number, string>();
  const unknownHeaders: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const canonical = normaliseHeader(cellText(cell.value));
    if (canonical) colToHeader.set(colNumber, canonical);
    else {
      const t = cellText(cell.value).trim();
      if (t) unknownHeaders.push(t);
    }
  });

  const rows: RawRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const obj: RawRow = {};
    let anyValue = false;
    colToHeader.forEach((header, colNumber) => {
      const text = cellText(row.getCell(colNumber).value);
      if (text.trim() !== '') anyValue = true;
      obj[header] = text;
    });
    if (anyValue) rows.push(obj);
  });

  return { rows, unknownHeaders };
}

/** Flatten an exceljs cell value (which may be rich text / formula / date) to text. */
function cellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.text === 'string') return v.text; // hyperlink / rich text
    if (typeof v.result !== 'undefined') return String(v.result); // formula result
    if (Array.isArray(v.richText)) {
      return (v.richText as Array<{ text?: string }>).map((p) => p.text ?? '').join('');
    }
  }
  return String(value);
}

// --------------------------------------------------------------------------
// Look up the existing products a parsed sheet could match (sku/barcode/name).
// --------------------------------------------------------------------------
interface ProductMatchRow {
  id: bigint | number;
  name: string;
  sku: string | null;
  barcode: string | null;
  category: string | null;
}

async function findExistingMatches(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conn: { $queryRawUnsafe: (q: string, ...p: unknown[]) => Promise<any> },
  rows: RawRow[]
): Promise<ExistingProduct[]> {
  const skus = new Set<string>();
  const barcodes = new Set<string>();
  const names = new Set<string>();
  for (const r of rows) {
    const sku = String(r.sku ?? '').trim();
    const barcode = String(r.barcode ?? '').trim();
    const name = String(r.name ?? '').trim();
    if (sku) skus.add(sku);
    if (barcode) barcodes.add(barcode);
    if (name) names.add(name);
  }
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (skus.size) {
    clauses.push(`sku IN (${[...skus].map(() => '?').join(',')})`);
    params.push(...skus);
  }
  if (barcodes.size) {
    clauses.push(`barcode IN (${[...barcodes].map(() => '?').join(',')})`);
    params.push(...barcodes);
  }
  if (names.size) {
    clauses.push(`name IN (${[...names].map(() => '?').join(',')})`);
    params.push(...names);
  }
  if (!clauses.length) return [];
  const found = (await conn.$queryRawUnsafe(
    `SELECT id, name, sku, barcode, category FROM products WHERE ${clauses.join(' OR ')}`,
    ...params
  )) as ProductMatchRow[];
  return found.map((p) => ({
    id: Number(p.id),
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    category: p.category,
  }));
}

async function readKnownCategories(): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category <> ''`
    )) as Array<{ category: string }>;
    for (const r of rows) set.add(String(r.category).toLowerCase());
  } catch {
    /* categories lookup is best-effort — unknown category is only a warning */
  }
  return set;
}

async function readAllowNegativeStock(): Promise<boolean> {
  try {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT pos_allow_negative_stock FROM settings WHERE id = 1 LIMIT 1`
    )) as Array<{ pos_allow_negative_stock: number | null }>;
    return !!(rows[0]?.pos_allow_negative_stock ?? 0);
  } catch {
    return false;
  }
}

// ==========================================================================
// POST /api/admin/pos/import/preview  (multipart `file`)
// ==========================================================================
router.post(
  '/import/preview',
  upload.single('file'),
  async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) return fail(res, 'Upload an .xlsx or .csv file as "file".', 422);
    if (!looksLikeXlsx(file.buffer) && !file.originalname.toLowerCase().endsWith('.csv')) {
      return fail(res, 'The file is not a valid .xlsx or .csv.', 422);
    }

    let parsed: { rows: RawRow[]; unknownHeaders: string[] };
    try {
      parsed = await parseWorkbook(file.buffer, file.originalname);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[pos-import] parse failed', e);
      return fail(res, 'Could not read the file — it may be corrupt or password-protected.', 422);
    }

    if (!parsed.rows.length) {
      return fail(res, 'No data rows found. Check the header row and try again.', 422);
    }

    const [existing, knownCategories, allowNegativeStock] = await Promise.all([
      findExistingMatches(prisma, parsed.rows),
      readKnownCategories(),
      readAllowNegativeStock(),
    ]);

    const { rows, summary } = validateSheet(parsed.rows, existing, {
      allowNegativeStock,
      knownCategories,
    });

    // Persist a previewed batch row carrying the row-wise error list (history view).
    await prisma.$executeRawUnsafe(
      `INSERT INTO pos_import_batches
         (filename, status, total_rows, inserted, updated, skipped, errors, error_json, created_by)
       VALUES (?, 'previewed', ?, ?, ?, 0, ?, ?, ?)`,
      file.originalname.slice(0, 255),
      summary.total,
      summary.insert,
      summary.update,
      summary.error,
      JSON.stringify(rows.filter((r) => r.errors.length).map((r) => ({ rowNum: r.rowNum, errors: r.errors }))),
      actor(req)
    );
    const idRows = (await prisma.$queryRawUnsafe(
      `SELECT LAST_INSERT_ID() AS id`
    )) as Array<{ id: bigint | number }>;
    const batchPreviewId = Number(idRows[0]?.id ?? 0);

    return ok(res, {
      batchPreviewId,
      rows,
      summary,
      unknownHeaders: parsed.unknownHeaders,
    });
  }
);

// ==========================================================================
// POST /api/admin/pos/import/commit  { batchPreviewId, rows }
// ==========================================================================
const commitRowSchema = z.object({
  rowNum: z.number().int().positive(),
  // The client echoes back the raw cells; the server RE-VALIDATES, never trusts
  // the client's `action`/cleaned values.
  data: z.record(z.string(), z.unknown()),
});
const commitSchema = z.object({
  batchPreviewId: z.number().int().positive().optional(),
  rows: z.array(commitRowSchema).min(1).max(10000),
});

router.post('/import/commit', async (req: Request, res: Response) => {
  const parsed = commitSchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(res, parsed.error.issues[0]?.message || 'Invalid commit payload.', 422);
  }
  const { batchPreviewId, rows: echoed } = parsed.data;
  const createdBy = actor(req);

  // Re-build raw rows from the client echo (only the known import columns).
  const rawRows: RawRow[] = echoed.map((r) => {
    const obj: RawRow = {};
    for (const h of IMPORT_HEADERS) {
      if (h in r.data) obj[h] = (r.data as Record<string, unknown>)[h];
    }
    return obj;
  });

  const [existing, knownCategories, allowNegativeStock] = await Promise.all([
    findExistingMatches(prisma, rawRows),
    readKnownCategories(),
    readAllowNegativeStock(),
  ]);

  // Re-validate the whole sheet server-side.
  const { rows: validated, summary } = validateSheet(rawRows, existing, {
    allowNegativeStock,
    knownCategories,
  });

  if (summary.error > 0) {
    const firstErr = validated.find((r) => r.errors.length);
    await markBatch(batchPreviewId, 'failed', summary, createdBy, validated);
    return fail(
      res,
      `Cannot commit — ${summary.error} row(s) still have errors (e.g. row ${firstErr?.rowNum}: ${firstErr?.errors[0]}).`,
      422
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      let inserted = 0;
      let updated = 0;
      for (const row of validated) {
        const d = row.data as CleanRowData;
        if (row.action === 'insert') {
          await insertProduct(tx, d, createdBy, batchPreviewId ?? null);
          inserted += 1;
        } else if (row.action === 'update') {
          await updateProduct(tx, row.matchedProductId!, d, createdBy, batchPreviewId ?? null);
          updated += 1;
        }
      }
      return { inserted, updated };
    });

    const finalSummary = { ...summary, insert: result.inserted, update: result.updated };
    await markBatch(batchPreviewId, 'committed', finalSummary, createdBy, validated);
    return ok(res, {
      summary: { ...finalSummary, committed: true },
      batchPreviewId: batchPreviewId ?? null,
    });
  } catch (e) {
    // Mid-file failure → the whole $transaction rolled back (no half import).
    // eslint-disable-next-line no-console
    console.error('[pos-import] commit failed', e);
    await markBatch(batchPreviewId, 'failed', summary, createdBy, validated).catch(() => undefined);
    return fail(res, 'Import failed and was rolled back — no products were changed.', 500);
  }
});

// --------------------------------------------------------------------------
// Transactional product writers (raw SQL — FOR the import tx).
// --------------------------------------------------------------------------
type Tx = {
  $executeRawUnsafe: (q: string, ...p: unknown[]) => Promise<number>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $queryRawUnsafe: (q: string, ...p: unknown[]) => Promise<any>;
};

async function insertProduct(
  tx: Tx,
  d: CleanRowData,
  actorName: string,
  batchId: number | null
): Promise<void> {
  const stock = d.stock ?? 0;
  const inStock = stock > 0 ? 1 : 0;
  await tx.$executeRawUnsafe(
    `INSERT INTO products
       (name, category, mrp, price, sku, barcode, purchase_price, stock, unit,
        tax_rate, low_stock_threshold, in_stock)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    d.name,
    d.category,
    d.selling_price, // seed mrp = selling price for a brand-new product
    d.selling_price,
    d.sku,
    d.barcode,
    d.purchase_price,
    stock,
    d.unit,
    d.tax_rate,
    d.low_stock_threshold,
    inStock
  );
  const idRows = (await tx.$queryRawUnsafe(`SELECT LAST_INSERT_ID() AS id`)) as Array<{
    id: bigint | number;
  }>;
  const productId = Number(idRows[0]?.id ?? 0);

  // Change log: record every seeded field so the history is complete.
  await logChange(tx, productId, 'price', null, d.selling_price, actorName, batchId);
  if (d.stock != null) {
    await logChange(tx, productId, 'stock', null, d.stock, actorName, batchId);
    // Opening stock is a movement so the audit trail balances.
    await tx.$executeRawUnsafe(
      `INSERT INTO stock_movements
         (product_id, change_qty, balance_after, reason, batch_id, created_by)
       VALUES (?, ?, ?, 'import', ?, ?)`,
      productId,
      stock,
      stock,
      batchId,
      actorName
    );
  }
}

async function updateProduct(
  tx: Tx,
  productId: number,
  d: CleanRowData,
  actorName: string,
  batchId: number | null
): Promise<void> {
  // Lock + read the current row so we only log/move what actually changes.
  const curRows = (await tx.$queryRawUnsafe(
    `SELECT price, purchase_price, stock, unit, tax_rate, low_stock_threshold,
            category, sku, barcode, track_inventory, allow_negative_stock
       FROM products WHERE id = ? FOR UPDATE`,
    productId
  )) as Array<{
    price: unknown;
    purchase_price: unknown;
    stock: unknown;
    unit: string;
    tax_rate: unknown;
    low_stock_threshold: unknown;
    category: string | null;
    sku: string | null;
    barcode: string | null;
    track_inventory: number;
    allow_negative_stock: number | null;
  }>;
  const cur = curRows[0];
  if (!cur) throw new Error(`Product #${productId} vanished mid-import.`);

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, value: unknown) => {
    sets.push(`${col} = ?`);
    params.push(value);
  };

  // Scalar field changes (log each one that differs).
  if (d.selling_price != null && num(cur.price) !== d.selling_price) {
    set('price', d.selling_price);
    await logChange(tx, productId, 'price', num(cur.price), d.selling_price, actorName, batchId);
  }
  if (d.purchase_price != null && num(cur.purchase_price) !== d.purchase_price) {
    set('purchase_price', d.purchase_price);
    await logChange(tx, productId, 'purchase_price', num(cur.purchase_price), d.purchase_price, actorName, batchId);
  }
  if (d.unit && cur.unit !== d.unit) {
    set('unit', d.unit);
    await logChange(tx, productId, 'unit', cur.unit, d.unit, actorName, batchId);
  }
  if (d.tax_rate != null && num(cur.tax_rate) !== d.tax_rate) {
    set('tax_rate', d.tax_rate);
    await logChange(tx, productId, 'tax_rate', num(cur.tax_rate), d.tax_rate, actorName, batchId);
  }
  if (d.low_stock_threshold != null && num(cur.low_stock_threshold) !== d.low_stock_threshold) {
    set('low_stock_threshold', d.low_stock_threshold);
    await logChange(tx, productId, 'low_stock_threshold', num(cur.low_stock_threshold), d.low_stock_threshold, actorName, batchId);
  }
  if (d.category && cur.category !== d.category) {
    set('category', d.category);
    await logChange(tx, productId, 'category', cur.category, d.category, actorName, batchId);
  }
  if (d.sku && cur.sku !== d.sku) {
    set('sku', d.sku);
    await logChange(tx, productId, 'sku', cur.sku, d.sku, actorName, batchId);
  }
  if (d.barcode && cur.barcode !== d.barcode) {
    set('barcode', d.barcode);
    await logChange(tx, productId, 'barcode', cur.barcode, d.barcode, actorName, batchId);
  }

  // Stock change — set the ABSOLUTE value, record a signed movement + recompute
  // in_stock so the online catalog stays truthful (design §6.3).
  if (d.stock != null && num(cur.stock) !== d.stock) {
    const before = num(cur.stock);
    const after = d.stock;
    const allowNeg = cur.allow_negative_stock == null ? false : !!cur.allow_negative_stock;
    set('stock', after);
    if (cur.track_inventory) {
      set('in_stock', after > 0 || allowNeg ? 1 : 0);
    }
    await logChange(tx, productId, 'stock', before, after, actorName, batchId);
    await tx.$executeRawUnsafe(
      `INSERT INTO stock_movements
         (product_id, change_qty, balance_after, reason, batch_id, created_by)
       VALUES (?, ?, ?, 'import', ?, ?)`,
      productId,
      Math.round((after - before) * 1000) / 1000,
      after,
      batchId,
      actorName
    );
  }

  if (sets.length) {
    params.push(productId);
    await tx.$executeRawUnsafe(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, ...params);
  }
}

async function logChange(
  tx: Tx,
  productId: number,
  field: string,
  oldVal: unknown,
  newVal: unknown,
  actorName: string,
  batchId: number | null,
  source: 'import' | 'bulk_update' = 'import'
): Promise<void> {
  await tx.$executeRawUnsafe(
    `INSERT INTO product_change_log
       (product_id, field, old_val, new_val, source, batch_id, actor)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    productId,
    field,
    oldVal == null ? null : String(oldVal),
    newVal == null ? null : String(newVal),
    source,
    batchId,
    actorName
  );
}

async function markBatch(
  batchId: number | undefined,
  status: 'committed' | 'failed',
  summary: { total: number; insert: number; update: number; error: number },
  actorName: string,
  rows: PreviewRow[]
): Promise<void> {
  const errorJson = JSON.stringify(
    rows.filter((r) => r.errors.length).map((r) => ({ rowNum: r.rowNum, errors: r.errors }))
  );
  if (batchId) {
    await prisma.$executeRawUnsafe(
      `UPDATE pos_import_batches
         SET status = ?, total_rows = ?, inserted = ?, updated = ?, errors = ?, error_json = ?
       WHERE id = ?`,
      status,
      summary.total,
      summary.insert,
      summary.update,
      summary.error,
      errorJson,
      batchId
    );
  } else {
    // Commit without a prior preview id — record a fresh batch for the history.
    await prisma.$executeRawUnsafe(
      `INSERT INTO pos_import_batches
         (filename, status, total_rows, inserted, updated, skipped, errors, error_json, created_by)
       VALUES ('(direct commit)', ?, ?, ?, ?, 0, ?, ?, ?)`,
      status,
      summary.total,
      summary.insert,
      summary.update,
      summary.error,
      errorJson,
      actorName
    );
  }
}

// ==========================================================================
// GET /api/admin/pos/export/products.xlsx  — stream the inventory workbook.
// ==========================================================================
router.get('/export/products.xlsx', async (_req: Request, res: Response) => {
  const products = (await prisma.$queryRawUnsafe(
    `SELECT id, name, sku, barcode, category, purchase_price, price, stock, unit,
            tax_rate, low_stock_threshold, in_stock
       FROM products ORDER BY id ASC`
  )) as Array<Record<string, unknown>>;

  const wb = new ExcelJS.Workbook();
  wb.creator = '4A Store POS';
  wb.created = new Date();
  const ws = wb.addWorksheet('Products');
  ws.columns = [
    { header: 'id', key: 'id', width: 8 },
    { header: 'name', key: 'name', width: 32 },
    { header: 'sku', key: 'sku', width: 16 },
    { header: 'barcode', key: 'barcode', width: 16 },
    { header: 'category', key: 'category', width: 20 },
    { header: 'purchase_price', key: 'purchase_price', width: 14 },
    { header: 'selling_price', key: 'selling_price', width: 14 },
    { header: 'stock', key: 'stock', width: 12 },
    { header: 'unit', key: 'unit', width: 8 },
    { header: 'tax_rate', key: 'tax_rate', width: 10 },
    { header: 'low_stock_threshold', key: 'low_stock_threshold', width: 18 },
    { header: 'in_stock', key: 'in_stock', width: 10 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const p of products) {
    ws.addRow({
      id: Number(p.id),
      name: p.name ?? '',
      sku: p.sku ?? '',
      barcode: p.barcode ?? '',
      category: p.category ?? '',
      purchase_price: p.purchase_price == null ? '' : num(p.purchase_price),
      selling_price: num(p.price),
      stock: num(p.stock),
      unit: p.unit ?? 'pcs',
      tax_rate: num(p.tax_rate),
      low_stock_threshold: p.low_stock_threshold == null ? '' : num(p.low_stock_threshold),
      in_stock: p.in_stock ? 1 : 0,
    });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="4astore-products-${stamp}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// ==========================================================================
// POST /api/admin/pos/bulk-update  { field, updates: [{ id|sku, value }] }
// ==========================================================================
const bulkUpdateSchema = z.object({
  field: z.enum(['price', 'selling_price', 'stock']),
  updates: z
    .array(
      z.object({
        id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).optional(),
        sku: z.string().trim().max(64).optional(),
        value: z.number().finite(),
      })
    )
    .min(1)
    .max(5000),
});

router.post('/bulk-update', async (req: Request, res: Response) => {
  const parsed = bulkUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(res, parsed.error.issues[0]?.message || 'Invalid bulk-update payload.', 422);
  }
  const { field, updates } = parsed.data;
  const column = field === 'selling_price' ? 'price' : field; // selling_price → products.price
  const logField = field === 'selling_price' ? 'price' : field;
  const createdBy = actor(req);
  const allowNegativeStock = await readAllowNegativeStock();

  // Validate values up front (reject the WHOLE batch — nothing written on error).
  for (const u of updates) {
    if (u.id == null && !u.sku) return fail(res, 'Each update needs an id or sku.', 422);
    if (column === 'stock') {
      if (u.value < 0 && !allowNegativeStock) return fail(res, 'Stock cannot be negative.', 422);
      if (Math.abs(u.value) > 50000) return fail(res, 'Stock must be between -50000 and 50000.', 422);
      if (Math.abs(Math.round(u.value * 1000) / 1000 - u.value) > 1e-9) {
        return fail(res, 'Stock supports at most 3 decimal places.', 422);
      }
    } else {
      if (u.value < 1 || u.value > 100000) return fail(res, 'Price must be between 1 and 100000.', 422);
      if (Math.abs(Math.round(u.value * 100) / 100 - u.value) > 1e-9) {
        return fail(res, 'Price supports at most 2 decimal places.', 422);
      }
    }
  }

  // Significant stock adjustments collected inside the tx, fired fire-and-forget
  // AFTER commit (design §7). Never blocks the response — posNotify swallows all.
  const adjustments: Array<{ id: number; name: string; from: number; to: number }> = [];

  try {
    const result = await prisma.$transaction(async (tx) => {
      let changed = 0;
      let missing = 0;
      for (const u of updates) {
        const where = u.id != null ? 'id = ?' : 'sku = ?';
        const key = u.id != null ? Number(u.id) : u.sku;
        const curRows = (await tx.$queryRawUnsafe(
          `SELECT id, name, ${column} AS val, stock, track_inventory, allow_negative_stock
             FROM products WHERE ${where} LIMIT 1 FOR UPDATE`,
          key
        )) as Array<{
          id: bigint | number;
          name: string;
          val: unknown;
          stock: unknown;
          track_inventory: number;
          allow_negative_stock: number | null;
        }>;
        const cur = curRows[0];
        if (!cur) {
          missing += 1;
          continue;
        }
        const productId = Number(cur.id);
        const before = num(cur.val);
        const after = column === 'stock' ? Math.round(u.value * 1000) / 1000 : Math.round(u.value * 100) / 100;
        if (before === after) continue;

        if (column === 'stock') {
          const allowNeg = cur.allow_negative_stock == null ? allowNegativeStock : !!cur.allow_negative_stock;
          const inStock = after > 0 || allowNeg ? 1 : 0;
          if (cur.track_inventory) {
            await tx.$executeRawUnsafe(
              `UPDATE products SET stock = ?, in_stock = ? WHERE id = ?`,
              after,
              inStock,
              productId
            );
          } else {
            await tx.$executeRawUnsafe(`UPDATE products SET stock = ? WHERE id = ?`, after, productId);
          }
          await tx.$executeRawUnsafe(
            `INSERT INTO stock_movements
               (product_id, change_qty, balance_after, reason, created_by)
             VALUES (?, ?, ?, 'bulk_update', ?)`,
            productId,
            Math.round((after - before) * 1000) / 1000,
            after,
            createdBy
          );
          // Flag significant stock swings for an after-commit owner push.
          if (Math.abs(after - before) >= SIGNIFICANT_STOCK_DELTA) {
            adjustments.push({ id: productId, name: cur.name, from: before, to: after });
          }
        } else {
          await tx.$executeRawUnsafe(`UPDATE products SET ${column} = ? WHERE id = ?`, after, productId);
        }
        await logChange(tx as Tx, productId, logField, before, after, createdBy, null, 'bulk_update');
        changed += 1;
      }
      return { changed, missing };
    });

    // After-commit, fire-and-forget significant-adjustment alerts (design §7).
    for (const a of adjustments) void posNotify.stockAdjust(a);

    return ok(res, { message: `Updated ${result.changed} product(s).`, ...result });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[pos-import] bulk-update failed', e);
    return fail(res, 'Bulk update failed and was rolled back — no products were changed.', 500);
  }
});

// ==========================================================================
// GET /api/admin/pos/import/history  — keyset list of batches.
// ==========================================================================
router.get('/import/history', async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20'), 10) || 20, 1), 100);
  const cursor = req.query.cursor != null ? Number(req.query.cursor) : null;
  const where: string[] = [];
  const params: unknown[] = [];
  if (cursor != null && Number.isFinite(cursor)) {
    where.push('id < ?');
    params.push(cursor);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, filename, status, total_rows, inserted, updated, skipped, errors, created_by, created_at
       FROM pos_import_batches ${whereSql} ORDER BY id DESC LIMIT ?`,
    ...params,
    limit
  )) as Array<Record<string, unknown>>;
  const batches = rows.map((r) => ({
    id: Number(r.id),
    filename: r.filename,
    status: r.status,
    total_rows: Number(r.total_rows ?? 0),
    inserted: Number(r.inserted ?? 0),
    updated: Number(r.updated ?? 0),
    skipped: Number(r.skipped ?? 0),
    errors: Number(r.errors ?? 0),
    created_by: r.created_by,
    created_at: r.created_at,
  }));
  const nextCursor = rows.length === limit ? Number(rows[rows.length - 1].id) : null;
  return ok(res, { batches, nextCursor });
});

// GET /api/admin/pos/import/history/:id — the row-wise errors of one batch.
router.get('/import/history/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 'Invalid batch id.', 422);
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, filename, status, total_rows, inserted, updated, skipped, errors, error_json, created_by, created_at
       FROM pos_import_batches WHERE id = ? LIMIT 1`,
    id
  )) as Array<Record<string, unknown>>;
  const b = rows[0];
  if (!b) return fail(res, 'Batch not found.', 404);
  let errorRows: unknown = [];
  if (typeof b.error_json === 'string') {
    try {
      errorRows = JSON.parse(b.error_json);
    } catch {
      errorRows = [];
    }
  } else if (b.error_json != null) {
    errorRows = b.error_json;
  }
  return ok(res, {
    batch: {
      id: Number(b.id),
      filename: b.filename,
      status: b.status,
      total_rows: Number(b.total_rows ?? 0),
      inserted: Number(b.inserted ?? 0),
      updated: Number(b.updated ?? 0),
      skipped: Number(b.skipped ?? 0),
      errors: Number(b.errors ?? 0),
      created_by: b.created_by,
      created_at: b.created_at,
      errorRows,
    },
  });
});

// ==========================================================================
// GET /api/admin/pos/change-log?productId=&limit=&cursor=
// ==========================================================================
router.get('/change-log', async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 200);
  const cursor = req.query.cursor != null ? Number(req.query.cursor) : null;
  const productId = req.query.productId != null ? Number(req.query.productId) : null;
  const where: string[] = [];
  const params: unknown[] = [];
  if (productId != null && Number.isFinite(productId)) {
    where.push('product_id = ?');
    params.push(productId);
  }
  if (cursor != null && Number.isFinite(cursor)) {
    where.push('id < ?');
    params.push(cursor);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, product_id, field, old_val, new_val, source, batch_id, actor, created_at
       FROM product_change_log ${whereSql} ORDER BY id DESC LIMIT ?`,
    ...params,
    limit
  )) as Array<Record<string, unknown>>;
  const entries = rows.map((r) => ({
    id: Number(r.id),
    product_id: r.product_id == null ? null : Number(r.product_id),
    field: r.field,
    old_val: r.old_val,
    new_val: r.new_val,
    source: r.source,
    batch_id: r.batch_id == null ? null : Number(r.batch_id),
    actor: r.actor,
    created_at: r.created_at,
  }));
  const nextCursor = rows.length === limit ? Number(rows[rows.length - 1].id) : null;
  return ok(res, { entries, nextCursor });
});

// Re-export the pure validators so tests importing from the route still resolve
// (the real logic lives in services/excelImport.ts).
export { validateRow, validateSheet };

export default router;
