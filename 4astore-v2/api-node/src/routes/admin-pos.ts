/**
 * POS admin phone allowlist management (OWNER ONLY).
 *
 * Mounted at /api/admin/pos BEFORE the generic /api/admin router (like
 * admin-links) so these specific paths win. Every route is requireAuth +
 * requireOwner — server-side, never frontend hiding.
 *
 * The allowlist (`admin_phones`) governs who can OBTAIN a staff JWT via POS
 * phone-OTP login (routes/pos-auth.ts). The API-layer invariant "an
 * unauthorised phone cannot call admin/POS APIs" is enforced by requireStaff/
 * requireOwner reading JWT claims; adding/removing a phone keeps the matching
 * user row's role/permissions in sync so revocation is effectively immediate
 * (and refresh tokens are revoked on removal so the user cannot refresh back
 * into staff). admin_phones is a runtime-created table, read/written via raw
 * SQL (consistent with the repo's settings handling).
 */
import { Router, Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { prisma } from '../db';
import { ok, fail } from '../utils/http';
import { requireAuth, requireOwner, requireStaff } from '../auth/middleware';

const router = Router();

const MOBILE_RE = /^[6-9]\d{9}$/;

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  return Number(v) || 0;
}

/** Permission keys an admin phone may carry (keep in sync with ALLOWED_PERMS in routes/admin.ts). */
const ALLOWED_PERMS = [
  'dashboard', 'orders', 'riderTracking', 'products', 'categories', 'banners', 'ads',
  'users', 'earnings', 'settings', 'team', 'pos', 'inventory', 'pos_reports',
];

// The owner's own primary number cannot be demoted/removed (acceptance a guard).
const OWNER_MOBILE = '7543888698';

const upsertSchema = z.object({
  mobile: z.string().regex(MOBILE_RE),
  role: z.enum(['owner', 'staff']),
  permissions: z.array(z.string()).optional().default([]),
  name: z.string().max(120).optional(),
});

interface AdminPhoneRow {
  id: bigint | number;
  mobile: string;
  role: string;
  permissions: unknown;
  name: string | null;
  active: number | null;
  added_by: string | null;
  created_at: Date;
}

function cleanPerms(raw: string[]): string[] {
  return [...new Set(raw.map(String))].filter((p) => ALLOWED_PERMS.includes(p));
}

// GET /api/admin/pos/phones — list the allowlist.
router.get('/phones', requireAuth, requireOwner, async (_req: Request, res: Response) => {
  const rows = await prisma
    .$queryRawUnsafe<AdminPhoneRow[]>(
      `SELECT id, mobile, role, permissions, name, active, added_by, created_at
         FROM admin_phones ORDER BY created_at DESC`
    )
    .catch(() => [] as AdminPhoneRow[]);
  const phones = rows.map((r) => ({
    id: Number(r.id),
    mobile: r.mobile,
    role: r.role,
    permissions:
      typeof r.permissions === 'string'
        ? (() => {
            try {
              return JSON.parse(r.permissions as string);
            } catch {
              return [];
            }
          })()
        : r.permissions ?? [],
    name: r.name,
    active: !!r.active,
    added_by: r.added_by,
    created_at: r.created_at,
  }));
  return ok(res, { phones });
});

// POST /api/admin/pos/phones — add/update an authorised number.
router.post('/phones', requireAuth, requireOwner, async (req: Request, res: Response) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'Enter a valid 10-digit mobile and role (owner|staff).', 422);
  const { mobile, role } = parsed.data;
  const name = parsed.data.name ?? null;
  const permissions = role === 'owner' ? ['*'] : cleanPerms(parsed.data.permissions);
  if (role === 'staff' && permissions.length === 0) {
    return fail(res, 'Select at least one permission for a staff number.', 422);
  }

  const addedBy = req.user?.mobile ?? req.user?.username ?? null;
  await prisma.$executeRawUnsafe(
    `INSERT INTO admin_phones (mobile, role, permissions, name, active, added_by)
       VALUES (?, ?, ?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE role = VALUES(role), permissions = VALUES(permissions),
       name = VALUES(name), active = 1`,
    mobile,
    role,
    JSON.stringify(permissions),
    name,
    addedBy
  );

  // If a matching user already exists, update their role/permissions immediately
  // so access is granted/updated without waiting for a fresh login.
  const userRole = role === 'owner' ? 'owner' : 'admin';
  await prisma.user
    .update({ where: { mobile }, data: { role: userRole, permissions } })
    .catch(() => null); // no matching user yet — seeded on their first POS login

  return ok(res, { message: `Authorised ${mobile} as ${role}.`, mobile, role, permissions });
});

// DELETE /api/admin/pos/phones/:mobile — revoke a number.
router.delete('/phones/:mobile', requireAuth, requireOwner, async (req: Request, res: Response) => {
  const mobile = String(req.params.mobile || '');
  if (!MOBILE_RE.test(mobile)) return fail(res, 'Invalid mobile number.', 422);

  // Never allow the owner's primary number (or the caller's own number) to be
  // removed — that would lock the store out of admin access.
  if (mobile === OWNER_MOBILE || mobile === req.user?.mobile) {
    return fail(res, 'You cannot remove the owner’s own number.', 409);
  }

  await prisma.$executeRawUnsafe('UPDATE admin_phones SET active = 0 WHERE mobile = ?', mobile);

  // Demote any matching user to customer and revoke their refresh tokens so they
  // cannot refresh back into staff (acceptance a — server-side revocation).
  const user = await prisma.user.findUnique({ where: { mobile } }).catch(() => null);
  if (user) {
    await prisma.user.update({ where: { mobile }, data: { role: 'customer', permissions: [] } }).catch(() => null);
    await prisma.refreshToken
      .updateMany({ where: { user_id: user.id, revoked: false }, data: { revoked: true } })
      .catch(() => null);
  }

  return ok(res, { message: `Revoked ${mobile}.`, mobile });
});

// ==========================================================================
// POS dashboard + reports (design §9.3). Read-only raw-SQL aggregates over the
// runtime-created POS tables (pos_bills / pos_bill_items / stock_movements),
// mirroring the existing /api/admin/stats pattern. Every route is guarded
// server-side; sensitive profit/purchase-price data requires `pos_reports`.
// ==========================================================================

/**
 * GET /api/admin/pos/dashboard — the admin dashboard POS summary strip.
 * requireStaff('dashboard'): today's POS sales + #bills, low/out-of-stock
 * counts, and the most recent completed bills. No purchase-price / profit data
 * (that is gated behind pos_reports in /reports), so `dashboard` is sufficient.
 */
router.get('/dashboard', requireAuth, requireStaff('dashboard'), async (_req: Request, res: Response) => {
  // Today's completed-sale totals (cancelled/refunded excluded).
  const todayRows = await prisma
    .$queryRawUnsafe<Array<{ sales: unknown; bills: unknown }>>(
      `SELECT COALESCE(SUM(grand_total), 0) AS sales, COUNT(*) AS bills
         FROM pos_bills
        WHERE status = 'completed' AND DATE(created_at) = CURDATE()`
    )
    .catch(() => [] as Array<{ sales: unknown; bills: unknown }>);
  const today = todayRows[0] || {};

  // Low-stock (0 < stock <= threshold) and out-of-stock (<= 0) counts over the
  // tracked catalogue. A NULL/0 threshold means "no low-stock watch" for low.
  const stockRows = await prisma
    .$queryRawUnsafe<Array<{ low: unknown; out: unknown }>>(
      `SELECT
         SUM(CASE WHEN track_inventory = 1 AND low_stock_threshold IS NOT NULL
                   AND low_stock_threshold > 0 AND stock > 0 AND stock <= low_stock_threshold
                  THEN 1 ELSE 0 END) AS low,
         SUM(CASE WHEN track_inventory = 1 AND stock <= 0 THEN 1 ELSE 0 END) AS out
       FROM products`
    )
    .catch(() => [] as Array<{ low: unknown; out: unknown }>);
  const stock = stockRows[0] || {};

  // Five most recent completed/cancelled/refunded bills for the strip.
  const recent = await prisma
    .$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT bill_no, customer_name, grand_total, payment_method, status, created_at
         FROM pos_bills
        WHERE status IN ('completed', 'cancelled', 'refunded')
        ORDER BY id DESC LIMIT 5`
    )
    .catch(() => [] as Array<Record<string, unknown>>);

  return ok(res, {
    today: { sales: num(today.sales), bills: num(today.bills) },
    lowStock: num(stock.low),
    outOfStock: num(stock.out),
    recentBills: recent.map((b) => ({
      bill_no: b.bill_no ?? null,
      customer_name: b.customer_name ?? null,
      grand_total: num(b.grand_total),
      payment_method: b.payment_method ?? null,
      status: b.status ?? null,
      created_at: b.created_at ?? null,
    })),
  });
});

// --------------------------------------------------------------------------
// Reports — shared period/range resolution + aggregate builder.
// --------------------------------------------------------------------------
const reportQuerySchema = z.object({
  period: z.enum(['day', 'week', 'month']).optional().default('day'),
  from: z.string().optional(),
  to: z.string().optional(),
});

/** Resolve a {from,to} datetime window (inclusive from, exclusive to) from the
 *  period keyword, or from explicit YYYY-MM-DD `from`/`to` if both are valid. */
function resolveRange(period: 'day' | 'week' | 'month', from?: string, to?: string): { fromSql: string; toSql: string; label: string } {
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (from && to && DATE_RE.test(from) && DATE_RE.test(to)) {
    const toExclusive = new Date(`${to}T00:00:00`);
    toExclusive.setDate(toExclusive.getDate() + 1);
    const toStr = toExclusive.toISOString().slice(0, 10);
    return { fromSql: `${from} 00:00:00`, toSql: `${toStr} 00:00:00`, label: `${from} → ${to}` };
  }
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1); // tomorrow 00:00 (exclusive)
  const start = new Date(end);
  if (period === 'day') start.setDate(end.getDate() - 1);
  else if (period === 'week') start.setDate(end.getDate() - 7);
  else start.setMonth(end.getMonth() - 1);
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 00:00:00`;
  return { fromSql: fmt(start), toSql: fmt(end), label: period };
}

interface ReportData {
  range: { from: string; to: string; label: string };
  totals: { sales: number; bills: number; discounts: number; refunds: number; refundBills: number };
  paymentSummary: Array<{ method: string; bills: number; amount: number }>;
  bestSellers: Array<{ product_id: number | null; name: string; quantity: number; amount: number }>;
  lowStock: Array<{ id: number; name: string; stock: number; unit: string; low_stock_threshold: number | null }>;
  outOfStock: Array<{ id: number; name: string; stock: number; unit: string }>;
}

/** Build the full report aggregate for a resolved window. */
async function buildReport(range: { fromSql: string; toSql: string; label: string }): Promise<ReportData> {
  const { fromSql, toSql } = range;

  // Completed-sale totals + discounts in the window.
  const totalsRows = (await prisma.$queryRawUnsafe(
    `SELECT COALESCE(SUM(grand_total), 0) AS sales, COUNT(*) AS bills,
            COALESCE(SUM(discount), 0) AS discounts
       FROM pos_bills
      WHERE status = 'completed' AND created_at >= ? AND created_at < ?`,
    fromSql,
    toSql
  )) as Array<{ sales: unknown; bills: unknown; discounts: unknown }>;
  const t = totalsRows[0] || {};

  // Refunds (refunded/cancelled bills) in the window — reversed value + count.
  const refundRows = (await prisma.$queryRawUnsafe(
    `SELECT COALESCE(SUM(grand_total), 0) AS refunds, COUNT(*) AS c
       FROM pos_bills
      WHERE status IN ('refunded', 'cancelled') AND created_at >= ? AND created_at < ?`,
    fromSql,
    toSql
  )) as Array<{ refunds: unknown; c: unknown }>;
  const r = refundRows[0] || {};

  // Payment-method summary (completed only).
  const payRows = (await prisma.$queryRawUnsafe(
    `SELECT COALESCE(payment_method, 'cash') AS method, COUNT(*) AS bills,
            COALESCE(SUM(grand_total), 0) AS amount
       FROM pos_bills
      WHERE status = 'completed' AND created_at >= ? AND created_at < ?
      GROUP BY payment_method
      ORDER BY amount DESC`,
    fromSql,
    toSql
  )) as Array<{ method: string; bills: unknown; amount: unknown }>;

  // Best-sellers via a real pos_bill_items join (no JSON_TABLE trick).
  const bestRows = (await prisma.$queryRawUnsafe(
    `SELECT bi.product_id AS product_id, bi.name AS name,
            COALESCE(SUM(bi.quantity), 0) AS quantity,
            COALESCE(SUM(bi.line_total), 0) AS amount
       FROM pos_bill_items bi
       JOIN pos_bills b ON b.id = bi.bill_id
      WHERE b.status = 'completed' AND b.created_at >= ? AND b.created_at < ?
      GROUP BY bi.product_id, bi.name
      ORDER BY quantity DESC
      LIMIT 10`,
    fromSql,
    toSql
  )) as Array<{ product_id: bigint | number | null; name: string; quantity: unknown; amount: unknown }>;

  // Low-stock + out-of-stock lists (current inventory, not window-bound).
  const lowRows = (await prisma.$queryRawUnsafe(
    `SELECT id, name, stock, unit, low_stock_threshold
       FROM products
      WHERE track_inventory = 1 AND low_stock_threshold IS NOT NULL
        AND low_stock_threshold > 0 AND stock > 0 AND stock <= low_stock_threshold
      ORDER BY stock ASC LIMIT 50`
  )) as Array<Record<string, unknown>>;
  const outRows = (await prisma.$queryRawUnsafe(
    `SELECT id, name, stock, unit
       FROM products
      WHERE track_inventory = 1 AND stock <= 0
      ORDER BY name ASC LIMIT 50`
  )) as Array<Record<string, unknown>>;

  return {
    range: { from: fromSql, to: toSql, label: range.label },
    totals: {
      sales: num(t.sales),
      bills: num(t.bills),
      discounts: num(t.discounts),
      refunds: num(r.refunds),
      refundBills: num(r.c),
    },
    paymentSummary: payRows.map((p) => ({ method: p.method || 'cash', bills: num(p.bills), amount: num(p.amount) })),
    bestSellers: bestRows.map((b) => ({
      product_id: b.product_id == null ? null : Number(b.product_id),
      name: b.name,
      quantity: num(b.quantity),
      amount: num(b.amount),
    })),
    lowStock: lowRows.map((p) => ({
      id: Number(p.id),
      name: String(p.name ?? ''),
      stock: num(p.stock),
      unit: String(p.unit ?? 'pcs'),
      low_stock_threshold: p.low_stock_threshold == null ? null : num(p.low_stock_threshold),
    })),
    outOfStock: outRows.map((p) => ({
      id: Number(p.id),
      name: String(p.name ?? ''),
      stock: num(p.stock),
      unit: String(p.unit ?? 'pcs'),
    })),
  };
}

/**
 * GET /api/admin/pos/reports?period=day|week|month&from=&to= — sales reports.
 * requireStaff('pos_reports'): sensitive (revenue/discount/refund/best-seller)
 * aggregates. A staff member without `pos_reports` gets 403 from requireStaff.
 */
router.get('/reports', requireAuth, requireStaff('pos_reports'), async (req: Request, res: Response) => {
  const parsed = reportQuerySchema.safeParse(req.query);
  if (!parsed.success) return fail(res, 'Invalid report query.', 422);
  const { period, from, to } = parsed.data;
  const range = resolveRange(period, from, to);
  const report = await buildReport(range);
  return ok(res, { ...report });
});

/**
 * GET /api/admin/pos/reports/export.xlsx — the same report as a workbook,
 * reusing the FEAT-003 exceljs writer. requireStaff('pos_reports') (sensitive).
 */
router.get('/reports/export.xlsx', requireAuth, requireStaff('pos_reports'), async (req: Request, res: Response) => {
  const parsed = reportQuerySchema.safeParse(req.query);
  if (!parsed.success) return fail(res, 'Invalid report query.', 422);
  const { period, from, to } = parsed.data;
  const range = resolveRange(period, from, to);
  const report = await buildReport(range);

  const wb = new ExcelJS.Workbook();
  wb.creator = '4A Store POS';
  wb.created = new Date();

  const summary = wb.addWorksheet('Summary');
  summary.columns = [
    { header: 'Metric', key: 'metric', width: 28 },
    { header: 'Value', key: 'value', width: 20 },
  ];
  summary.getRow(1).font = { bold: true };
  summary.addRow({ metric: 'Period', value: report.range.label });
  summary.addRow({ metric: 'From', value: report.range.from });
  summary.addRow({ metric: 'To (exclusive)', value: report.range.to });
  summary.addRow({ metric: 'Total sales', value: report.totals.sales });
  summary.addRow({ metric: 'Number of bills', value: report.totals.bills });
  summary.addRow({ metric: 'Discounts', value: report.totals.discounts });
  summary.addRow({ metric: 'Refunds/cancellations', value: report.totals.refunds });
  summary.addRow({ metric: 'Refund/cancel bills', value: report.totals.refundBills });

  const pay = wb.addWorksheet('Payment Methods');
  pay.columns = [
    { header: 'Method', key: 'method', width: 16 },
    { header: 'Bills', key: 'bills', width: 12 },
    { header: 'Amount', key: 'amount', width: 16 },
  ];
  pay.getRow(1).font = { bold: true };
  for (const p of report.paymentSummary) pay.addRow(p);

  const best = wb.addWorksheet('Best Sellers');
  best.columns = [
    { header: 'Product ID', key: 'product_id', width: 12 },
    { header: 'Name', key: 'name', width: 32 },
    { header: 'Quantity', key: 'quantity', width: 14 },
    { header: 'Amount', key: 'amount', width: 16 },
  ];
  best.getRow(1).font = { bold: true };
  for (const b of report.bestSellers) best.addRow({ product_id: b.product_id ?? '', name: b.name, quantity: b.quantity, amount: b.amount });

  const low = wb.addWorksheet('Low & Out of Stock');
  low.columns = [
    { header: 'ID', key: 'id', width: 8 },
    { header: 'Name', key: 'name', width: 32 },
    { header: 'Stock', key: 'stock', width: 12 },
    { header: 'Unit', key: 'unit', width: 8 },
    { header: 'Low threshold', key: 'low', width: 14 },
    { header: 'State', key: 'state', width: 12 },
  ];
  low.getRow(1).font = { bold: true };
  for (const p of report.outOfStock) low.addRow({ id: p.id, name: p.name, stock: p.stock, unit: p.unit, low: '', state: 'OUT' });
  for (const p of report.lowStock) low.addRow({ id: p.id, name: p.name, stock: p.stock, unit: p.unit, low: p.low_stock_threshold ?? '', state: 'LOW' });

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="4astore-sales-report-${stamp}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

export default router;
