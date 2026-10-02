import { QueryClient, useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { Announcement, Category, CmsPage, Order, Product, Settings, StoreConfig } from './types';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false } },
});

// MySQL DECIMAL columns arrive as strings; convert once so price math is numeric everywhere.
function normalizeProduct(p: Product): Product {
  return {
    ...p,
    id: Number(p.id),
    price: Number(p.price) || 0,
    mrp: Number(p.mrp) || 0,
    discount: Number(p.discount) || 0,
    in_stock: !!p.in_stock,
  };
}

export function normalizeOrder(o: Order): Order {
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

export const useProducts = () =>
  useQuery({
    queryKey: ['products'],
    staleTime: 5 * 60_000,
    queryFn: async () => ((await api.get('/products')).products as Product[]).map(normalizeProduct),
  });

export const useCategories = () =>
  useQuery({
    queryKey: ['categories'],
    staleTime: 10 * 60_000,
    queryFn: async () => ((await api.get('/categories')).categories as Category[]).map((c) => ({ ...c, id: Number(c.id) })),
  });

export const useConfig = () =>
  useQuery({ queryKey: ['config'], staleTime: 10 * 60_000, queryFn: async () => (await api.get('/config')).config as StoreConfig });

export const useSettings = () =>
  useQuery({
    queryKey: ['settings'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const s = (await api.get('/settings')).settings as Settings;
      return {
        ...s,
        deliveryCharge: Number(s.deliveryCharge ?? 10),
        freeDeliveryAbove: Number(s.freeDeliveryAbove ?? 500),
        storeLatitude: Number(s.storeLatitude ?? 24.580164),
        storeLongitude: Number(s.storeLongitude ?? 84.114194),
      } as Settings;
    },
  });

export const useMyOrders = (mobile?: string) =>
  useQuery({
    queryKey: ['orders', mobile],
    enabled: !!mobile,
    queryFn: async () => ((await api.get('/orders', { mobile })).orders as Order[]).map(normalizeOrder),
  });

/** Staff / rider: every order (polled). */
export const useAllOrders = (enabled: boolean, refetchInterval = 7000) =>
  useQuery({
    queryKey: ['all-orders'],
    enabled,
    refetchInterval,
    queryFn: async () => ((await api.get('/orders')).orders as Order[]).map(normalizeOrder),
  });

export const useOrder = (orderId?: string) =>
  useQuery({
    queryKey: ['order', orderId],
    enabled: !!orderId,
    queryFn: async () => normalizeOrder((await api.get(`/orders/${encodeURIComponent(orderId!)}`)).order as Order),
  });

export const usePages = () =>
  useQuery({ queryKey: ['pages'], staleTime: 5 * 60_000, queryFn: async () => (await api.get('/pages')).pages as CmsPage[] });

export const usePage = (slug?: string) =>
  useQuery({
    queryKey: ['page', slug],
    enabled: !!slug,
    retry: false,
    queryFn: async () => (await api.get(`/pages/${encodeURIComponent(slug!)}`)).page as CmsPage,
  });

export const fetchAnnouncement = async () =>
  (await api.get('/announcement', { t: Date.now() })).announcement as Announcement;
