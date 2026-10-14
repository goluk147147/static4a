/**
 * POS billing + stock engine (design §4–§5). Mounted at /api/pos, EVERY route
 * is requireAuth + requireStaff('pos') — protected server-side, never by
 * frontend hiding (acceptance: all /api/pos/* guarded).
 *
 * Exactly-once checkout (acceptance d) is enforced two ways:
 *   1. An idempotency pre-check SELECT by idempotency_key returns the existing
 *      bill (and does NOTHING else) on any retry/refresh.
 *   2. The uq_pos_bills_idem UNIQUE index is the race backstop: if two requests
 *      slip past the pre-check, the second INSERT throws 1062/P2002 and we
 *      re-select and return the first bill. Stock is therefore deducted ONCE.
 *
 * All money is recomputed server-side from the authoritative product
 * price/tax_rate (services/posBilling.ts) — the client total is never trusted.
 * The whole checkout runs in one interactive prisma.$transaction with the
 * catalogue rows locked FOR UPDATE so concurrent sales cannot oversell.
 *
 * POS tables (pos_bills, pos_bill_items, stock_movements) are runtime-created
 * (ensurePosTables) and their Prisma delegates are NOT generated in the
 * worktree, so they are read/written via raw $queryRawUnsafe/$executeRawUnsafe —
 * consistent with the repo's handling of other runtime-created tables
 * (admin_phones, settings). `products` IS a generated model but is also touched
 * via raw SQL inside the tx so the FOR UPDATE lock + atomic decrement are
 * expressed directly.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ok, fail } from '../utils/http';
import { requireAuth, requireStaff } from '../auth/middleware';
import {
  computeBill,
  formatBillNo,
  paymentStatusFor,
  round2,
  BillValidationError,
  BillLineInput,
} from '../services/posBilling';

const router = Router();
router.use(requireAuth);

// --------------------------------------------------------------------------
// Validation schemas (every external input is validated — §4.4).
// --------------------------------------------------------------------------
const itemSchema = z.object({
  productId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).nullish(),
  name: z.string().trim().min(1).max(200),
  unit: z.string().trim().max(12).optional().default('pcs'),
  quantity: z.number().finite().positive(),
  rate: z.number().finite().min(0).optional(),
  taxRate: z.number().finite().min(0).max(100).optional(),
  isManual: z.boolean().optional(),
});

const paymentSchema = z.object({
  method: z.enum(['cash', 'upi', 'other', 'split']).default('cash'),
  amountPaid: z.number().finite().min(0).optional(),
  breakdown: z.record(z.string(), z.number()).optional(),
});

const customerSchema = z.object({
  name: z.string().trim().max(120).optional(),
  mobile: z.string().trim().regex(/^[6-9]\d{9}$/).optional(),
});

const billSchema = z.object({
  idempotencyKey: z.string().uuid().optional(),
  status: z.enum(['completed', 'held']).default('completed'),
  customer: customerSchema.optional(),
  items: z.array(itemSchema).min(1),
  discount: z.number().finite().min(0).optional().default(0),
  payment: paymentSchema.optional(),
  note: z.string().trim().max(500).optional(),
});

// --------------------------------------------------------------------------
// Row shapes for the raw reads.
// --------------------------------------------------------------------------
interface ProductRow {
  id: bigint | number;
  name: string;
  sku: string | null;
  barcode: string | null;
  unit: string;
  price: unknown; // Decimal (string from raw SQL)
  tax_rate: unknown;
  stock: unknown;
  in_stock: number | boolean;
  track_inventory: number | boolean;
  allow_negative_stock: number | boolean | null;
}

interface BillRow {
  id: bigint | number;
  bill_no: string | null;
  idempotency_key: string | null;
  status: string;
  customer_name: string | null;
  customer_mobile: string | null;
  subtotal: unknown;
  discount: unknown;
  tax_total: unknown;
  grand_total: unknown;
  amount_paid: unknown;
  balance_due: unknown;
  payment_method: string | null;
  payment_status: string | null;
  payments_json: unknown;
  note: string | null;
  created_by: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

interface BillItemRow {
  id: bigint | number;
  bill_id: bigint | number;
  product_id: bigint | number | null;
  name: string;
  sku: string | null;
  unit: string;
  quantity: unknown;
  rate: unknown;
  tax_rate: unknown;
  line_total: unknown;
  is_manual: number | boolean;
}

const actor = (req: Request): string =>
  req.user?.username || req.user?.mobile || String(req.user?.sub ?? 'staff');

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  return Number(v);
}

function serializeBill(bill: BillRow, items: BillItemRow[] = []) {
  return {
    id: Number(bill.id),
    bill_no: bill.bill_no,
    idempotency_key: bill.idempotency_key,
    status: bill.status,
    customer_name: bill.customer_name,
    customer_mobile: bill.customer_mobile,
    subtotal: num(bill.subtotal),
    discount: num(bill.discount),
    tax_total: num(bill.tax_total),
    grand_total: num(bill.grand_total),
    amount_paid: num(bill.amount_paid),
    balance_due: num(bill.balance_due),
    payment_method: bill.payment_method,
    payment_status: bill.payment_status,
    payments_json:
      typeof bill.payments_json === 'string'
        ? (() => {
            try {
              return JSON.parse(bill.payments_json as string);
            } catch {
              return null;
            }
          })()
        : bill.payments_json ?? null,
    note: bill.note,
    created_by: bill.created_by,
    cancelled_by: bill.cancelled_by,
    cancel_reason: bill.cancel_reason,
    created_at: bill.created_at,
    updated_at: bill.updated_at,
    items: items.map((it) => ({
      id: Number(it.id),
      product_id: it.product_id == null ? null : Number(it.product_id),
      name: it.name,
      sku: it.sku,
      unit: it.unit,
      quantity: num(it.quantity),
      rate: num(it.rate),
      tax_rate: num(it.tax_rate),
      line_total: num(it.line_total),
      is_manual: !!it.is_manual,
    })),
  };
}

/** Load a bill + its items by numeric id (raw — pos tables are runtime-created). */
async function loadBillById(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conn: { $queryRawUnsafe: (q: string, ...p: unknown[]) => Promise<any> },
  id: bigint | number
): Promise<ReturnType<typeof serializeBill> | null> {
  const bills = await conn.$queryRawUnsafe(`SELECT * FROM pos_bills WHERE id = ? LIMIT 1`, id);
  const bill = (bills as BillRow[])[0];
  if (!bill) return null;
  const items = (await conn.$queryRawUnsafe(
    `SELECT * FROM pos_bill_items WHERE bill_id = ? ORDER BY id ASC`,
    bill.id
  )) as BillItemRow[];
  return serializeBill(bill, items);
}

async function loadBillByNo(no: string): Promise<ReturnType<typeof serializeBill> | null> {
  const bills = await prisma.$queryRawUnsafe<BillRow[]>(
    `SELECT * FROM pos_bills WHERE bill_no = ? LIMIT 1`,
    no
  );
  const bill = bills[0];
  if (!bill) return null;
  const items = await prisma.$queryRawUnsafe<BillItemRow[]>(
    `SELECT * FROM pos_bill_items WHERE bill_id = ? ORDER BY id ASC`,
    bill.id
  );
  return serializeBill(bill, items);
}

// --------------------------------------------------------------------------
// GET /api/pos/products/search?q=
// --------------------------------------------------------------------------
router.get('/products/search', requireStaff('pos'), async (req: Request, res: Response) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) return ok(res, { products: [] });
  const like = `${q}%`;
  const contains = `%${q}%`;
  // Match by SKU/barcode prefix (indexed) OR name contains. Limited for the
  // debounced search box. Only POS-relevant columns are returned.
  const rows = await prisma.$queryRawUnsafe<ProductRow[]>(
    `SELECT id, name, sku, barcode, unit, price, tax_rate, stock, in_stock,
            track_inventory, allow_negative_stock
       FROM products
      WHERE sku = ? OR barcode = ? OR sku LIKE ? OR barcode LIKE ? OR name LIKE ?
      ORDER BY name ASC
      LIMIT 25`,
    q,
    q,
    like,
    like,
    contains
  );
  const products = rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    sku: r.sku,
    barcode: r.barcode,
    unit: r.unit,
    price: num(r.price),
    tax_rate: num(r.tax_rate),
    stock: num(r.stock),
    in_stock: !!r.in_stock,
  }));
  return ok(res, { products });
});

// --------------------------------------------------------------------------
// Settings helper — global negative-stock + manual-item toggles + bill prefix.
// --------------------------------------------------------------------------
interface PosSettings {
  pos_allow_negative_stock: boolean;
  pos_allow_manual_items: boolean;
  pos_bill_prefix: string;
}
async function readPosSettings(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conn: { $queryRawUnsafe: (q: string, ...p: unknown[]) => Promise<any> } = prisma
): Promise<PosSettings> {
  const rows = (await conn.$queryRawUnsafe(
    `SELECT pos_allow_negative_stock, pos_allow_manual_items, pos_bill_prefix
       FROM settings WHERE id = 1 LIMIT 1`
  )) as Array<{
    pos_allow_negative_stock: number | null;
    pos_allow_manual_items: number | null;
    pos_bill_prefix: string | null;
  }>;
  const r = rows[0];
  return {
    pos_allow_negative_stock: !!(r?.pos_allow_negative_stock ?? 0),
    pos_allow_manual_items: !!(r?.pos_allow_manual_items ?? 1),
    pos_bill_prefix: r?.pos_bill_prefix || 'INV-',
  };
}

// --------------------------------------------------------------------------
// POST /api/pos/bills — create/complete a bill (idempotent, transactional).
// --------------------------------------------------------------------------
router.post('/bills', requireStaff('pos'), async (req: Request, res: Response) => {
  const parsed = billSchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(res, parsed.error.issues[0]?.message || 'Invalid bill.', 422);
  }
  const body = parsed.data;

  if (body.status === 'completed' && !body.idempotencyKey) {
    return fail(res, 'An idempotency key is required to complete a bill.', 422);
  }

  // A held bill never moves stock, never consumes a bill number.
  if (body.status === 'held') {
    return holdBill(req, res, body);
  }

  const idempotencyKey = body.idempotencyKey!;

  // (1) Idempotency pre-check OUTSIDE the tx — a refresh/retry returns the
  // existing bill and does NOTHING else, so stock is deducted exactly once.
  const existing = await loadBillByIdemKey(idempotencyKey);
  if (existing) {
    return ok(res, { bill: existing, idempotent: true });
  }

  const settings = await readPosSettings();

  // Manual-item guard: off-catalogue lines require the global toggle.
  const hasManual = body.items.some((it) => it.isManual || it.productId == null);
  if (hasManual && !settings.pos_allow_manual_items) {
    return fail(res, 'Manual (off-catalogue) items are disabled.', 403);
  }

  const createdBy = actor(req);

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Collect the distinct catalogue product ids to lock.
      const catalogueIds = [
        ...new Set(
          body.items
            .filter((it) => it.productId != null && !it.isManual)
            .map((it) => Number(it.productId))
        ),
      ];

      const productById = new Map<number, ProductRow>();
      if (catalogueIds.length) {
        // Lock the rows FOR UPDATE so concurrent sales cannot oversell.
        const placeholders = catalogueIds.map(() => '?').join(',');
        const locked = (await tx.$queryRawUnsafe(
          `SELECT id, name, sku, barcode, unit, price, tax_rate, stock, in_stock,
                  track_inventory, allow_negative_stock
             FROM products WHERE id IN (${placeholders}) FOR UPDATE`,
          ...catalogueIds
        )) as ProductRow[];
        for (const p of locked) productById.set(Number(p.id), p);
        // Any requested catalogue id that does not exist → recoverable 422.
        for (const id of catalogueIds) {
          if (!productById.has(id)) {
            throw new CheckoutError(422, `Product #${id} not found.`);
          }
        }
      }

      // Build authoritative line inputs. For catalogue lines the server
      // OVERRIDES the client rate/taxRate with the locked product's values.
      const lineInputs: BillLineInput[] = body.items.map((it) => {
        const isManual = !!it.isManual || it.productId == null;
        if (isManual) {
          return {
            productId: null,
            name: it.name,
            unit: it.unit || 'pcs',
            quantity: it.quantity,
            rate: it.rate ?? 0,
            taxRate: it.taxRate ?? 0,
            isManual: true,
          };
        }
        const p = productById.get(Number(it.productId))!;
        return {
          productId: Number(p.id),
          name: p.name, // snapshot the authoritative name
          unit: p.unit,
          quantity: it.quantity,
          rate: num(p.price), // authoritative price — client rate ignored
          taxRate: num(p.tax_rate),
          isManual: false,
        };
      });

      const computed = computeBill(lineInputs, body.discount);

      // Stock check for every tracked catalogue line (honour per-product then
      // global negative-stock). Aggregate per product so repeated lines of the
      // same product are summed. Nothing is written if any line fails.
      const demand = new Map<number, number>();
      for (const line of computed.lines) {
        if (line.productId == null) continue;
        demand.set(line.productId, (demand.get(line.productId) ?? 0) + line.quantity);
      }
      for (const [pid, qty] of demand) {
        const p = productById.get(pid)!;
        const tracks = !!p.track_inventory;
        if (!tracks) continue;
        const allowNeg =
          p.allow_negative_stock == null
            ? settings.pos_allow_negative_stock
            : !!p.allow_negative_stock;
        const after = round2(num(p.stock) - qty);
        if (after < 0 && !allowNeg) {
          throw new CheckoutError(409, `Insufficient stock for ${p.name}.`, pid);
        }
      }

      // Reserve the bill number inside the tx (same connection → no race).
      await tx.$executeRawUnsafe(
        `UPDATE settings SET pos_next_bill_seq = pos_next_bill_seq + 1 WHERE id = 1`
      );
      const seqRows = (await tx.$queryRawUnsafe(
        `SELECT pos_next_bill_seq AS seq FROM settings WHERE id = 1 LIMIT 1`
      )) as Array<{ seq: bigint | number }>;
      const billNo = formatBillNo(settings.pos_bill_prefix, Number(seqRows[0]?.seq ?? 1));

      // Payment.
      const method = body.payment?.method ?? 'cash';
      const amountPaid =
        body.payment?.amountPaid != null
          ? round2(body.payment.amountPaid)
          : computed.grandTotal;
      const balanceDue = round2(computed.grandTotal - amountPaid);
      const paymentStatus = paymentStatusFor(computed.grandTotal, amountPaid);
      const paymentsJson = body.payment?.breakdown ? JSON.stringify(body.payment.breakdown) : null;

      // Insert the bill. The uq_pos_bills_idem UNIQUE is the race backstop.
      await tx.$executeRawUnsafe(
        `INSERT INTO pos_bills
           (bill_no, idempotency_key, status, customer_name, customer_mobile,
            subtotal, discount, tax_total, grand_total, amount_paid, balance_due,
            payment_method, payment_status, payments_json, note, created_by)
         VALUES (?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        billNo,
        idempotencyKey,
        body.customer?.name ?? null,
        body.customer?.mobile ?? null,
        computed.subtotal,
        computed.discount,
        computed.taxTotal,
        computed.grandTotal,
        amountPaid,
        balanceDue,
        method,
        paymentStatus,
        paymentsJson,
        body.note ?? null,
        createdBy
      );
      const idRows = (await tx.$queryRawUnsafe(
        `SELECT LAST_INSERT_ID() AS id`
      )) as Array<{ id: bigint | number }>;
      const billId = Number(idRows[0]?.id ?? 0);

      // Insert items + deduct stock + append stock_movements for catalogue lines.
      for (const line of computed.lines) {
        const p = line.productId != null ? productById.get(line.productId) : undefined;
        await tx.$executeRawUnsafe(
          `INSERT INTO pos_bill_items
             (bill_id, product_id, name, sku, unit, quantity, rate, tax_rate, line_total, is_manual)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          billId,
          line.productId ?? null,
          line.name,
          p?.sku ?? null,
          line.unit,
          line.quantity,
          line.rate,
          line.taxRate,
          line.lineTotal,
          line.isManual ? 1 : 0
        );
      }

      // Deduct stock once per product (aggregated demand), recompute in_stock,
      // and append the sale movement with the post-deduction balance.
      for (const [pid, qty] of demand) {
        const p = productById.get(pid)!;
        if (!p.track_inventory) continue;
        const allowNeg =
          p.allow_negative_stock == null
            ? settings.pos_allow_negative_stock
            : !!p.allow_negative_stock;
        const balanceAfter = round2(num(p.stock) - qty);
        const inStock = balanceAfter > 0 || allowNeg ? 1 : 0;
        await tx.$executeRawUnsafe(
          `UPDATE products SET stock = ?, in_stock = ? WHERE id = ?`,
          balanceAfter,
          inStock,
          pid
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO stock_movements
             (product_id, change_qty, balance_after, reason, bill_no, created_by)
           VALUES (?, ?, ?, 'sale', ?, ?)`,
          pid,
          round2(-qty),
          balanceAfter,
          billNo,
          createdBy
        );
      }

      return loadBillById(tx as never, billId);
    });

    return ok(res, { bill: result, idempotent: false });
  } catch (e) {
    if (e instanceof CheckoutError) {
      return failWith(res, e.message, e.status, e.productId);
    }
    // (2) Race backstop: a concurrent request inserted the same idempotency_key
    // first (1062/P2002). Re-select and return that bill — stock was deducted
    // exactly once (by whichever tx committed).
    if (isDuplicateKeyError(e)) {
      const dup = await loadBillByIdemKey(idempotencyKey);
      if (dup) return ok(res, { bill: dup, idempotent: true });
    }
    // eslint-disable-next-line no-console
    console.error('[pos] checkout failed', e);
    return fail(res, 'Could not complete the bill.', 500);
  }
});

/** Hold a bill — no stock move, no bill number, status='held', addressed by id. */
async function holdBill(
  req: Request,
  res: Response,
  body: z.infer<typeof billSchema>
): Promise<Response> {
  const settings = await readPosSettings();
  const hasManual = body.items.some((it) => it.isManual || it.productId == null);
  if (hasManual && !settings.pos_allow_manual_items) {
    return fail(res, 'Manual (off-catalogue) items are disabled.', 403);
  }

  // Recompute totals for display even on hold, using authoritative prices for
  // catalogue lines. No locking is needed because no stock moves.
  const catalogueIds = [
    ...new Set(body.items.filter((it) => it.productId != null && !it.isManual).map((it) => Number(it.productId))),
  ];
  const productById = new Map<number, ProductRow>();
  if (catalogueIds.length) {
    const placeholders = catalogueIds.map(() => '?').join(',');
    const rows = await prisma.$queryRawUnsafe<ProductRow[]>(
      `SELECT id, name, sku, unit, price, tax_rate FROM products WHERE id IN (${placeholders})`,
      ...catalogueIds
    );
    for (const p of rows) productById.set(Number(p.id), p);
  }
  const lineInputs: BillLineInput[] = body.items.map((it) => {
    const isManual = !!it.isManual || it.productId == null;
    if (isManual) {
      return { productId: null, name: it.name, unit: it.unit || 'pcs', quantity: it.quantity, rate: it.rate ?? 0, taxRate: it.taxRate ?? 0, isManual: true };
    }
    const p = productById.get(Number(it.productId));
    if (!p) throw new CheckoutError(422, `Product #${it.productId} not found.`);
    return { productId: Number(p.id), name: p.name, unit: p.unit, quantity: it.quantity, rate: num(p.price), taxRate: num(p.tax_rate), isManual: false };
  });

  let computed;
  try {
    computed = computeBill(lineInputs, body.discount);
  } catch (e) {
    if (e instanceof BillValidationError) return fail(res, e.message, 422);
    if (e instanceof CheckoutError) return fail(res, e.message, e.status);
    throw e;
  }

  const createdBy = actor(req);
  const method = body.payment?.method ?? 'cash';
  await prisma.$executeRawUnsafe(
    `INSERT INTO pos_bills
       (bill_no, idempotency_key, status, customer_name, customer_mobile,
        subtotal, discount, tax_total, grand_total, amount_paid, balance_due,
        payment_method, payment_status, payments_json, note, created_by)
     VALUES (NULL, NULL, 'held', ?, ?, ?, ?, ?, ?, 0, ?, ?, 'pending', NULL, ?, ?)`,
    body.customer?.name ?? null,
    body.customer?.mobile ?? null,
    computed.subtotal,
    computed.discount,
    computed.taxTotal,
    computed.grandTotal,
    computed.grandTotal,
    method,
    body.note ?? null,
    createdBy
  );
  const idRows = await prisma.$queryRawUnsafe<Array<{ id: bigint | number }>>(`SELECT LAST_INSERT_ID() AS id`);
  const billId = Number(idRows[0]?.id ?? 0);
  for (const line of computed.lines) {
    const p = line.productId != null ? productById.get(line.productId) : undefined;
    await prisma.$executeRawUnsafe(
      `INSERT INTO pos_bill_items
         (bill_id, product_id, name, sku, unit, quantity, rate, tax_rate, line_total, is_manual)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      billId,
      line.productId ?? null,
      line.name,
      p?.sku ?? null,
      line.unit,
      line.quantity,
      line.rate,
      line.taxRate,
      line.lineTotal,
      line.isManual ? 1 : 0
    );
  }
  const bill = await loadBillById(prisma as never, billId);
  return ok(res, { bill });
}

// Separate /bills/hold route (design §4.1) — delegates to the same holdBill path.
router.post('/bills/hold', requireStaff('pos'), async (req: Request, res: Response) => {
  const parsed = billSchema.safeParse({ ...req.body, status: 'held' });
  if (!parsed.success) return fail(res, parsed.error.issues[0]?.message || 'Invalid bill.', 422);
  try {
    return await holdBill(req, res, parsed.data);
  } catch (e) {
    if (e instanceof CheckoutError) return fail(res, e.message, e.status);
    throw e;
  }
});

// --------------------------------------------------------------------------
// GET /api/pos/bills — history (keyset pagination + filters).
// --------------------------------------------------------------------------
router.get('/bills', requireStaff('pos'), async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20'), 10) || 20, 1), 100);
  const cursor = req.query.cursor != null ? Number(req.query.cursor) : null;
  const status = typeof req.query.status === 'string' ? req.query.status : null;
  const mobile = typeof req.query.mobile === 'string' ? req.query.mobile : null;
  const billNo = typeof req.query.billNo === 'string' ? req.query.billNo : null;

  const where: string[] = [];
  const params: unknown[] = [];
  if (cursor != null && Number.isFinite(cursor)) {
    where.push('id < ?');
    params.push(cursor);
  }
  if (status && ['held', 'completed', 'cancelled', 'refunded'].includes(status)) {
    where.push('status = ?');
    params.push(status);
  }
  if (mobile) {
    where.push('customer_mobile = ?');
    params.push(mobile);
  }
  if (billNo) {
    where.push('bill_no = ?');
    params.push(billNo);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await prisma.$queryRawUnsafe<BillRow[]>(
    `SELECT * FROM pos_bills ${whereSql} ORDER BY id DESC LIMIT ?`,
    ...params,
    limit
  );
  const bills = rows.map((b) => serializeBill(b));
  const nextCursor = rows.length === limit ? Number(rows[rows.length - 1].id) : null;
  return ok(res, { bills, nextCursor });
});

// GET /api/pos/bills/id/:id — reopen a held bill (or fetch any bill by id).
router.get('/bills/id/:id', requireStaff('pos'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 'Invalid bill id.', 422);
  const bill = await loadBillById(prisma as never, id);
  if (!bill) return fail(res, 'Bill not found.', 404);
  return ok(res, { bill });
});

// GET /api/pos/bills/:billNo — a completed/cancelled/refunded bill by bill_no.
router.get('/bills/:billNo', requireStaff('pos'), async (req: Request, res: Response) => {
  const billNo = String(req.params.billNo);
  const bill = await loadBillByNo(billNo);
  if (!bill) return fail(res, 'Bill not found.', 404);
  return ok(res, { bill });
});

// --------------------------------------------------------------------------
// POST /api/pos/bills/:billNo/cancel and /refund — controlled stock reversal.
// --------------------------------------------------------------------------
const reversalSchema = z.object({ reason: z.string().trim().max(255).optional() });

async function reverseBill(
  req: Request,
  res: Response,
  kind: 'cancel' | 'refund'
): Promise<Response> {
  const billNo = String(req.params.billNo);
  const parsed = reversalSchema.safeParse(req.body ?? {});
  const reason = parsed.success ? parsed.data.reason ?? null : null;
  const newStatus = kind === 'cancel' ? 'cancelled' : 'refunded';
  const movementReason = kind === 'cancel' ? 'cancel_reversal' : 'refund_reversal';
  const cancelledBy = actor(req);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const bills = (await tx.$queryRawUnsafe(
        `SELECT * FROM pos_bills WHERE bill_no = ? LIMIT 1 FOR UPDATE`,
        billNo
      )) as BillRow[];
      const bill = bills[0];
      if (!bill) throw new CheckoutError(404, 'Bill not found.');

      // Idempotent: only a currently-completed bill reverses. Already
      // cancelled/refunded → no-op, return the bill unchanged (no double restock).
      if (bill.status !== 'completed') {
        return loadBillById(tx as never, bill.id);
      }

      const items = (await tx.$queryRawUnsafe(
        `SELECT * FROM pos_bill_items WHERE bill_id = ? ORDER BY id ASC`,
        bill.id
      )) as BillItemRow[];

      // Restock each CATALOGUE line (manual lines have no product to restock).
      const restock = new Map<number, number>();
      for (const it of items) {
        if (it.product_id == null || it.is_manual) continue;
        const pid = Number(it.product_id);
        restock.set(pid, (restock.get(pid) ?? 0) + num(it.quantity));
      }
      for (const [pid, qty] of restock) {
        const locked = (await tx.$queryRawUnsafe(
          `SELECT stock, allow_negative_stock, track_inventory FROM products WHERE id = ? FOR UPDATE`,
          pid
        )) as Array<{ stock: unknown; allow_negative_stock: number | null; track_inventory: number }>;
        const p = locked[0];
        if (!p || !p.track_inventory) continue;
        const balanceAfter = round2(num(p.stock) + qty);
        const inStock = balanceAfter > 0 || !!p.allow_negative_stock ? 1 : 0;
        await tx.$executeRawUnsafe(
          `UPDATE products SET stock = ?, in_stock = ? WHERE id = ?`,
          balanceAfter,
          inStock,
          pid
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO stock_movements
             (product_id, change_qty, balance_after, reason, bill_no, created_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
          pid,
          round2(qty), // positive — restock
          balanceAfter,
          movementReason,
          bill.bill_no,
          cancelledBy
        );
      }

      await tx.$executeRawUnsafe(
        `UPDATE pos_bills SET status = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ?`,
        newStatus,
        cancelledBy,
        reason,
        bill.id
      );

      return loadBillById(tx as never, bill.id);
    });

    return ok(res, { bill: result });
  } catch (e) {
    if (e instanceof CheckoutError) return failWith(res, e.message, e.status, e.productId);
    // eslint-disable-next-line no-console
    console.error(`[pos] ${kind} failed`, e);
    return fail(res, `Could not ${kind} the bill.`, 500);
  }
}

router.post('/bills/:billNo/cancel', requireStaff('pos'), (req: Request, res: Response) =>
  reverseBill(req, res, 'cancel')
);
router.post('/bills/:billNo/refund', requireStaff('pos'), (req: Request, res: Response) =>
  reverseBill(req, res, 'refund')
);

// --------------------------------------------------------------------------
// Helpers.
// --------------------------------------------------------------------------
async function loadBillByIdemKey(key: string): Promise<ReturnType<typeof serializeBill> | null> {
  const bills = await prisma.$queryRawUnsafe<BillRow[]>(
    `SELECT * FROM pos_bills WHERE idempotency_key = ? LIMIT 1`,
    key
  );
  const bill = bills[0];
  if (!bill) return null;
  const items = await prisma.$queryRawUnsafe<BillItemRow[]>(
    `SELECT * FROM pos_bill_items WHERE bill_id = ? ORDER BY id ASC`,
    bill.id
  );
  return serializeBill(bill, items);
}

/** A recoverable checkout error carrying an HTTP status (+ optional productId). */
class CheckoutError extends Error {
  status: number;
  productId?: number;
  constructor(status: number, message: string, productId?: number) {
    super(message);
    this.status = status;
    this.productId = productId;
  }
}

/** Detect a MySQL duplicate-key / Prisma unique-constraint error. */
function isDuplicateKeyError(e: unknown): boolean {
  if (e && typeof e === 'object') {
    const code = (e as { code?: string }).code;
    if (code === 'P2002') return true;
    const msg = e instanceof Error ? e.message : String(e);
    if (/1062|Duplicate entry|uq_pos_bills_idem/i.test(msg)) return true;
  }
  return false;
}

/** fail() with an optional productId payload for the 409 insufficient-stock case. */
function failWith(res: Response, message: string, status: number, productId?: number) {
  return res.status(status).json({ success: false, message, ...(productId != null ? { productId } : {}) });
}

export default router;
