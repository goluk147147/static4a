import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { fetchAdminProducts } from './admin';
import type { Product, Category, StoreConfig, Settings } from '../types';

// MySQL DECIMAL columns arrive as strings ("200.00"); convert once so price math
// and comparisons (mrp > price) are numeric everywhere in the UI.
function normalizeProduct(p: Product): Product {
  return {
    ...p,
    id: Number(p.id),
    price: Number(p.price) || 0,
    mrp: Number(p.mrp) || 0,
    discount: Number(p.discount) || 0,
    // DECIMAL "3.000" → 3; blank/0/NaN/null → null (no limit / unlimited).
    max_qty_per_order: p.max_qty_per_order == null ? null : (Number(p.max_qty_per_order) || null),
  };
}

// Catalog freshness: staleTime 0 + refetch on focus so admin product/category edits appear within
// seconds for shoppers (overriding the global staleTime 60s / refetchOnWindowFocus false). The
// server catalog_version ETag + `no-cache, must-revalidate` (catalog.ts) keeps these refetches
// cheap 304s until an edit actually changes the catalog.
export function useProducts() {
  return useQuery({
    queryKey: ['products'],
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: async () => ((await api.get('/products')).data.products as Product[]).map(normalizeProduct),
  });
}

// Admin product list (GET /api/admin/products): the ONLY source that includes DRAFTS, so the admin
// table can see and publish them. Separate cache key from the public ['products'] list. staleTime 0 +
// refetch on focus so freshly-saved status flips show immediately. normalizeProduct keeps price/mrp/
// max_qty numeric (status passes through the ...p spread).
export function useAdminProducts() {
  return useQuery({
    queryKey: ['admin-products'],
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: async () => (await fetchAdminProducts()).map(normalizeProduct),
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: async () => (await api.get('/categories')).data.categories as Category[],
  });
}

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: async () => (await api.get('/config')).data.config as StoreConfig,
  });
}

export interface MyOrder {
  order_id: string;
  order_status: string;
  order_date: string;
  delivered_at?: string | null;
  subtotal: number;
  discount: number;
  delivery_charge: number;
  total_amount: number;
  payment_method: string;
  customer: { name?: string; mobile?: string; address?: string; city?: string; pincode?: string };
  items: { id?: number; name: string; weight?: string; unit?: string; price: number; quantity: number }[];
}

/** DECIMAL money fields arrive as strings; JSON columns may be missing. */
export function normalizeOrder<T extends MyOrder>(o: T): T {
  return {
    ...o,
    subtotal: Number(o.subtotal) || 0,
    discount: Number(o.discount) || 0,
    delivery_charge: Number(o.delivery_charge) || 0,
    total_amount: Number(o.total_amount) || 0,
    customer: o.customer || {},
    items: (Array.isArray(o.items) ? o.items : []).map((i) => ({ ...i, price: Number(i.price) || 0, quantity: Number(i.quantity) || 0 })),
  };
}

/** Logged-in customer's own orders. */
export function useMyOrders(mobile: string | undefined) {
  return useQuery({
    queryKey: ['orders', mobile],
    enabled: !!mobile,
    queryFn: async () =>
      ((await api.get(`/orders?mobile=${encodeURIComponent(mobile!)}`)).data.orders as MyOrder[]).map(normalizeOrder),
  });
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data.settings as Settings,
  });
}
