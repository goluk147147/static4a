// POS / inventory data layer for the mobile app — react-query over src/api.ts,
// mirroring src/queries.ts. Every endpoint is guarded server-side
// (requireStaff('pos' | 'inventory') / requireOwner); these hooks are a typed
// client, not the access boundary. Per design §9.2 the Excel file picker /
// import is WEB-ONLY (no new native module); mobile offers single/bulk edits
// through the same /api/admin/pos endpoints instead.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

// --------------------------------------------------------------------------
// Types (match routes/pos.ts + routes/pos-import.ts JSON shapes).
// --------------------------------------------------------------------------
export interface PosProduct {
  id: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  unit: string;
  price: number;
  tax_rate: number;
  stock: number;
  in_stock: boolean;
}

export interface PosBillItem {
  id?: number;
  product_id: number | null;
  name: string;
  sku: string | null;
  unit: string;
  quantity: number;
  rate: number;
  tax_rate: number;
  line_total: number;
  is_manual: boolean;
}

export interface PosBill {
  id: number;
  bill_no: string | null;
  idempotency_key: string | null;
  status: 'held' | 'completed' | 'cancelled' | 'refunded';
  customer_name: string | null;
  customer_mobile: string | null;
  subtotal: number;
  discount: number;
  tax_total: number;
  grand_total: number;
  amount_paid: number;
  balance_due: number;
  payment_method: string | null;
  payment_status: string | null;
  payments_json: Record<string, number> | null;
  note: string | null;
  created_by: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
  items: PosBillItem[];
}

export interface CreateBillLine {
  productId?: number | null;
  name: string;
  unit?: string;
  quantity: number;
  rate?: number;
  taxRate?: number;
  isManual?: boolean;
}

export interface CreateBillPayload {
  idempotencyKey?: string;
  status?: 'completed' | 'held';
  customer?: { name?: string; mobile?: string };
  items: CreateBillLine[];
  discount?: number;
  payment?: { method?: 'cash' | 'upi' | 'other' | 'split'; amountPaid?: number; breakdown?: Record<string, number> };
  note?: string;
}

export interface ChangeLogEntry {
  id: number;
  product_id: number | null;
  field: string;
  old_val: string | null;
  new_val: string | null;
  source: string;
  batch_id: number | null;
  actor: string | null;
  created_at: string;
}

export interface AdminPhone {
  id: number;
  mobile: string;
  role: string;
  permissions: string[];
  name: string | null;
  active: boolean;
  added_by: string | null;
  created_at: string;
}

function normalizeProduct(p: PosProduct): PosProduct {
  return {
    ...p,
    id: Number(p.id),
    price: Number(p.price) || 0,
    tax_rate: Number(p.tax_rate) || 0,
    stock: Number(p.stock) || 0,
    in_stock: !!p.in_stock,
  };
}

// --------------------------------------------------------------------------
// Product search.
// --------------------------------------------------------------------------
export function usePosProductSearch(q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: ['pos-search', term],
    enabled: term.length > 0,
    staleTime: 10_000,
    queryFn: async () => ((await api.get('/pos/products/search', { q: term })).products as PosProduct[]).map(normalizeProduct),
  });
}

/** One-shot exact lookup (barcode scan) — the single matching product or null. */
export async function posLookupExact(code: string): Promise<PosProduct | null> {
  const term = code.trim();
  if (!term) return null;
  const products = ((await api.get('/pos/products/search', { q: term })).products as PosProduct[]).map(normalizeProduct);
  const exact = products.find((p) => p.sku === term || p.barcode === term);
  return exact || products[0] || null;
}

// --------------------------------------------------------------------------
// Bills.
// --------------------------------------------------------------------------
export const POS_BILLS_KEY = ['pos-bills'];

export function useCreateBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateBillPayload) =>
      (await api.post('/pos/bills', payload, { timeoutMs: 30000 })) as { bill: PosBill; idempotent: boolean },
    onSuccess: () => qc.invalidateQueries({ queryKey: POS_BILLS_KEY }),
  });
}

export function useHoldBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateBillPayload) => (await api.post('/pos/bills/hold', payload)) as { bill: PosBill },
    onSuccess: () => qc.invalidateQueries({ queryKey: POS_BILLS_KEY }),
  });
}

export interface BillHistoryFilters {
  status?: string;
  mobile?: string;
  billNo?: string;
}

export function usePosBills(filters: BillHistoryFilters = {}, limit = 20) {
  return useQuery({
    queryKey: [...POS_BILLS_KEY, filters, limit],
    queryFn: async () => (await api.get('/pos/bills', { limit, ...filters })) as { bills: PosBill[]; nextCursor: number | null },
  });
}

export function usePosBill(billNo: string | undefined) {
  return useQuery({
    queryKey: ['pos-bill', billNo],
    enabled: !!billNo,
    queryFn: async () => (await api.get(`/pos/bills/${encodeURIComponent(billNo!)}`)).bill as PosBill,
  });
}

export async function fetchPosBillById(id: number): Promise<PosBill> {
  return (await api.get(`/pos/bills/id/${id}`)).bill as PosBill;
}

export function useCancelBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ billNo, reason }: { billNo: string; reason?: string }) =>
      (await api.post(`/pos/bills/${encodeURIComponent(billNo)}/cancel`, { reason })).bill as PosBill,
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: POS_BILLS_KEY });
      qc.invalidateQueries({ queryKey: ['pos-bill', v.billNo] });
    },
  });
}

export function useRefundBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ billNo, reason }: { billNo: string; reason?: string }) =>
      (await api.post(`/pos/bills/${encodeURIComponent(billNo)}/refund`, { reason })).bill as PosBill,
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: POS_BILLS_KEY });
      qc.invalidateQueries({ queryKey: ['pos-bill', v.billNo] });
    },
  });
}

// --------------------------------------------------------------------------
// Inventory — single/bulk price + stock edits through the same server endpoint
// used by the web Excel module (no file picker on mobile per design §9.2).
// --------------------------------------------------------------------------
export function useBulkUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { field: 'price' | 'selling_price' | 'stock'; updates: { id?: number; sku?: string; value: number }[] }) =>
      (await api.post('/admin/pos/bulk-update', payload)) as { message: string; changed: number; missing: number },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-change-log'] }),
  });
}

export function useChangeLog(productId?: number, limit = 50) {
  return useQuery({
    queryKey: ['pos-change-log', productId, limit],
    queryFn: async () =>
      (await api.get('/admin/pos/change-log', { productId, limit })) as { entries: ChangeLogEntry[]; nextCursor: number | null },
  });
}

// --------------------------------------------------------------------------
// POS access (phone allowlist — owner only).
// --------------------------------------------------------------------------
export const POS_PHONES_KEY = ['pos-phones'];

export function usePosPhones() {
  return useQuery({
    queryKey: POS_PHONES_KEY,
    queryFn: async () => (await api.get('/admin/pos/phones')).phones as AdminPhone[],
  });
}

export function useUpsertPhone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { mobile: string; role: 'owner' | 'staff'; permissions?: string[]; name?: string }) =>
      (await api.post('/admin/pos/phones', payload)) as { message: string },
    onSuccess: () => qc.invalidateQueries({ queryKey: POS_PHONES_KEY }),
  });
}

export function useRemovePhone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mobile: string) =>
      (await api(`/admin/pos/phones/${encodeURIComponent(mobile)}`, { method: 'DELETE' })) as { message: string },
    onSuccess: () => qc.invalidateQueries({ queryKey: POS_PHONES_KEY }),
  });
}

// --------------------------------------------------------------------------
// Dashboard + sales reports (FEAT-006). Guarded server-side
// (requireStaff('dashboard') / requireStaff('pos_reports')).
// --------------------------------------------------------------------------
export interface PosDashboard {
  today: { sales: number; bills: number };
  lowStock: number;
  outOfStock: number;
  recentBills: Array<{
    bill_no: string | null;
    customer_name: string | null;
    grand_total: number;
    payment_method: string | null;
    status: string | null;
    created_at: string | null;
  }>;
}

export type ReportPeriod = 'day' | 'week' | 'month';

export interface PosReport {
  range: { from: string; to: string; label: string };
  totals: { sales: number; bills: number; discounts: number; refunds: number; refundBills: number };
  paymentSummary: Array<{ method: string; bills: number; amount: number }>;
  bestSellers: Array<{ product_id: number | null; name: string; quantity: number; amount: number }>;
  lowStock: Array<{ id: number; name: string; stock: number; unit: string; low_stock_threshold: number | null }>;
  outOfStock: Array<{ id: number; name: string; stock: number; unit: string }>;
}

export interface ReportFilters {
  period?: ReportPeriod;
  from?: string;
  to?: string;
}

export function usePosReport(filters: ReportFilters = {}) {
  return useQuery({
    queryKey: ['pos-report', filters],
    staleTime: 15_000,
    queryFn: async () => (await api.get('/admin/pos/reports', { ...filters })) as PosReport,
  });
}

// --------------------------------------------------------------------------
// Shared money helpers (client-side bill preview). The server recomputes
// authoritative totals from product price/tax_rate on checkout.
// --------------------------------------------------------------------------
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

export const DECIMAL_UNITS = new Set(['g', 'kg', 'mg', 'ml', 'l']);
export const isDecimalUnit = (u: string) => DECIMAL_UNITS.has((u || '').toLowerCase());
