// POS / inventory data layer — react-query hooks over lib/api.ts, mirroring the
// pattern in pages/admin/adminData.ts. Every endpoint here is also guarded
// server-side (requireStaff('pos' | 'inventory') / requireOwner); the hooks are
// a thin typed client, never the access boundary.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

// --------------------------------------------------------------------------
// Types (match the JSON shapes returned by routes/pos.ts + routes/pos-import.ts).
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

export interface ImportPreviewRow {
  rowNum: number;
  action: 'insert' | 'update' | 'error';
  data: Record<string, unknown>;
  errors: string[];
  warnings?: string[];
  matchedProductId?: number | null;
}

export interface ImportPreview {
  batchPreviewId: number;
  rows: ImportPreviewRow[];
  summary: { total: number; insert: number; update: number; error: number };
  unknownHeaders: string[];
}

export interface ImportBatch {
  id: number;
  filename: string;
  status: string;
  total_rows: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  created_by: string | null;
  created_at: string;
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

// --------------------------------------------------------------------------
// Dashboard summary strip + sales reports (FEAT-006).
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

// --------------------------------------------------------------------------
// Product search (debounced caller supplies `q`).
// --------------------------------------------------------------------------
export function usePosProductSearch(q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: ['pos-search', term],
    enabled: term.length > 0,
    staleTime: 10_000,
    queryFn: async () => (await api.get('/pos/products/search', { params: { q: term } })).data.products as PosProduct[],
  });
}

/** One-shot exact lookup (barcode scan / Enter) — returns the single matching product or null. */
export async function posLookupExact(code: string): Promise<PosProduct | null> {
  const term = code.trim();
  if (!term) return null;
  const products = (await api.get('/pos/products/search', { params: { q: term } })).data.products as PosProduct[];
  // Prefer an exact SKU/barcode hit (a scan), else the first result.
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
      (await api.post('/pos/bills', payload)).data as { bill: PosBill; idempotent: boolean },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: POS_BILLS_KEY });
    },
  });
}

export function useHoldBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateBillPayload) =>
      (await api.post('/pos/bills/hold', payload)).data as { bill: PosBill },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: POS_BILLS_KEY });
    },
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
    queryFn: async () =>
      (await api.get('/pos/bills', { params: { limit, ...filters } })).data as { bills: PosBill[]; nextCursor: number | null },
  });
}

export function usePosBill(billNo: string | undefined) {
  return useQuery({
    queryKey: ['pos-bill', billNo],
    enabled: !!billNo,
    queryFn: async () => (await api.get(`/pos/bills/${encodeURIComponent(billNo!)}`)).data.bill as PosBill,
  });
}

/** Reopen a held bill by numeric id. */
export async function fetchPosBillById(id: number): Promise<PosBill> {
  return (await api.get(`/pos/bills/id/${id}`)).data.bill as PosBill;
}

export function useCancelBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ billNo, reason }: { billNo: string; reason?: string }) =>
      (await api.post(`/pos/bills/${encodeURIComponent(billNo)}/cancel`, { reason })).data.bill as PosBill,
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
      (await api.post(`/pos/bills/${encodeURIComponent(billNo)}/refund`, { reason })).data.bill as PosBill,
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: POS_BILLS_KEY });
      qc.invalidateQueries({ queryKey: ['pos-bill', v.billNo] });
    },
  });
}

// --------------------------------------------------------------------------
// Excel import / inventory (mounted at /api/admin/pos).
// --------------------------------------------------------------------------
export function useImportPreview() {
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return (await api.post('/admin/pos/import/preview', form, { headers: { 'Content-Type': 'multipart/form-data' } }))
        .data as ImportPreview;
    },
  });
}

export function useImportCommit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { batchPreviewId?: number; rows: { rowNum: number; data: Record<string, unknown> }[] }) =>
      (await api.post('/admin/pos/import/commit', payload)).data as {
        summary: { total: number; insert: number; update: number; error: number; committed: boolean };
        batchPreviewId: number | null;
      },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pos-import-history'] });
    },
  });
}

export function useBulkUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { field: 'price' | 'selling_price' | 'stock'; updates: { id?: number; sku?: string; value: number }[] }) =>
      (await api.post('/admin/pos/bulk-update', payload)).data as { message: string; changed: number; missing: number },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pos-change-log'] });
    },
  });
}

export function useImportHistory(limit = 20) {
  return useQuery({
    queryKey: ['pos-import-history', limit],
    queryFn: async () =>
      (await api.get('/admin/pos/import/history', { params: { limit } })).data as { batches: ImportBatch[]; nextCursor: number | null },
  });
}

export function useChangeLog(productId?: number, limit = 50) {
  return useQuery({
    queryKey: ['pos-change-log', productId, limit],
    queryFn: async () =>
      (await api.get('/admin/pos/change-log', { params: { productId, limit } })).data as {
        entries: ChangeLogEntry[];
        nextCursor: number | null;
      },
  });
}

/** Download the product/inventory workbook (streamed .xlsx). */
export async function exportProductsXlsx(): Promise<void> {
  const res = await api.get('/admin/pos/export/products.xlsx', { responseType: 'blob' });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `4astore-products-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// --------------------------------------------------------------------------
// POS access (phone allowlist — owner only).
// --------------------------------------------------------------------------
export const POS_PHONES_KEY = ['pos-phones'];

export function usePosPhones() {
  return useQuery({
    queryKey: POS_PHONES_KEY,
    queryFn: async () => (await api.get('/admin/pos/phones')).data.phones as AdminPhone[],
  });
}

export function useUpsertPhone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { mobile: string; role: 'owner' | 'staff'; permissions?: string[]; name?: string }) =>
      (await api.post('/admin/pos/phones', payload)).data as { message: string },
    onSuccess: () => qc.invalidateQueries({ queryKey: POS_PHONES_KEY }),
  });
}

export function useRemovePhone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mobile: string) => (await api.delete(`/admin/pos/phones/${encodeURIComponent(mobile)}`)).data as { message: string },
    onSuccess: () => qc.invalidateQueries({ queryKey: POS_PHONES_KEY }),
  });
}

// --------------------------------------------------------------------------
// Dashboard + reports hooks (FEAT-006). All guarded server-side
// (requireStaff('dashboard') / requireStaff('pos_reports')).
// --------------------------------------------------------------------------
export function usePosDashboard(enabled = true) {
  return useQuery({
    queryKey: ['pos-dashboard'],
    enabled,
    staleTime: 30_000,
    retry: false,
    // Never let a dashboard-widget error (e.g. a 403 for staff without the
    // 'dashboard' permission) bubble up and break the shared admin dashboard.
    throwOnError: false,
    queryFn: async () => {
      const { data } = await api.get('/admin/pos/dashboard');
      const { success, ...rest } = data as { success: boolean } & PosDashboard;
      void success;
      return rest as PosDashboard;
    },
  });
}

export function usePosReport(filters: ReportFilters = {}) {
  return useQuery({
    queryKey: ['pos-report', filters],
    staleTime: 15_000,
    queryFn: async () => {
      const { data } = await api.get('/admin/pos/reports', { params: filters });
      const { success, ...rest } = data as { success: boolean } & PosReport;
      void success;
      return rest as PosReport;
    },
  });
}

/** Download the sales report workbook (streamed .xlsx). */
export async function exportReportXlsx(filters: ReportFilters = {}): Promise<void> {
  const res = await api.get('/admin/pos/reports/export.xlsx', { params: filters, responseType: 'blob' });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `4astore-sales-report-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
