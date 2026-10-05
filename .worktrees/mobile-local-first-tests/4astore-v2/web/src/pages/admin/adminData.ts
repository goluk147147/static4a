import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { normalizeOrder, MyOrder } from '../../lib/queries';

export interface AdminOrderFull extends MyOrder {
  id?: number;
  payment_reference?: string | null;
  delivery_address?: {
    label?: string; receiver_name?: string; phone?: string; full_address?: string; landmark?: string;
    latitude?: number | null; longitude?: number | null;
  } | null;
  rider_id?: string | null;
  rider_name?: string | null;
  rider_mobile?: string | null;
  assigned_at?: string | null;
}

export interface AdminUserRow {
  id: number;
  name: string;
  mobile: string;
  username: string;
  role: string;
  permissions?: string[] | null;
  custom_delivery?: number | null;
  registered_at?: string | null;
  last_login?: string | null;
}

export const ADMIN_ORDERS_KEY = ['admin-orders'];

/**
 * All orders for staff. One shared query: the notification bell polls it every
 * 7 s (like the original checkNewOrders), and every tab reads the same cache.
 */
export function useAdminOrders(enabled = true) {
  return useQuery({
    queryKey: ADMIN_ORDERS_KEY,
    enabled,
    refetchInterval: 7000,
    refetchIntervalInBackground: true,
    queryFn: async () => ((await api.get('/orders')).data.orders as AdminOrderFull[]).map(normalizeOrder),
  });
}

export function useAdminUsers(enabled = true) {
  return useQuery({
    queryKey: ['admin-users'],
    enabled,
    queryFn: async () => (await api.get('/admin/users')).data.users as AdminUserRow[],
  });
}

// Original admin.html helpers --------------------------------------------------

export const STATUS_COLOR: Record<string, string> = {
  'Order Placed': '#f59e0b',
  Confirmed: '#3b82f6',
  Packed: '#8b5cf6',
  'Out for Delivery': '#0ea5e9',
  Delivered: '#059669',
  Cancelled: '#dc2626',
};
export const statusColor = (s: string) => STATUS_COLOR[s] || '#6b7280';

export const formatDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function canAdmin(role: string | undefined, permissions: string[] | null | undefined, perm: string): boolean {
  if (role === 'owner' || role === 'superadmin') return true;
  if (role !== 'admin') return false;
  const p = permissions || [];
  return p.includes('*') || p.includes(perm);
}
