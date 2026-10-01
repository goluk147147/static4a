import { api } from './api';

// ---- Orders ----
export async function fetchAllOrders() {
  return (await api.get('/orders')).data.orders as AdminOrder[];
}
export async function updateOrderStatus(orderId: string, status: string) {
  return (await api.post('/admin/orders/status', { orderId, status })).data;
}
export async function deleteOrder(orderId: string) {
  return (await api.post('/admin/orders/delete', { orderId })).data;
}

// ---- Products ----
export async function saveProduct(action: 'add' | 'update', product: Record<string, unknown>) {
  return (await api.post('/admin/products', { action, product })).data;
}
export async function deleteProduct(id: number) {
  return (await api.post('/admin/products', { action: 'delete', id })).data;
}

// ---- Users ----
export async function fetchUsers() {
  return (await api.get('/admin/users')).data.users as AdminUser[];
}
export async function assignRole(mobile: string, role: string, permissions: string[]) {
  return (await api.post('/admin/assignRole', { mobile, role, permissions })).data;
}
/** Original api/users.php actions: setDelivery, updateUser, createRider, delete, deleteInactive. */
export async function usersAction(action: string, body: Record<string, unknown>) {
  return (await api.post('/admin/users', { action, ...body })).data;
}
export async function adminCreateOrder(customer: { name: string; mobile: string }, items: { id: number; quantity: number }[]) {
  return (await api.post('/admin/orders/create', { customer, items })).data;
}

// ---- Team Access ----
export async function fetchTeam() {
  return (await api.get('/admin/team')).data.admins as AdminUser[];
}
export async function teamAction(action: 'create' | 'update' | 'delete', body: Record<string, unknown>) {
  return (await api.post('/admin/team', { action, ...body })).data;
}

// ---- Settings ----
export interface AdminSettings {
  storeEmail: string; deliveryCharge: number; freeDeliveryAbove: number; upiId: string; upiName: string;
  hideMrp: boolean; storePhone: string; storeAddress: string; storeLatitude: number | null; storeLongitude: number | null;
  serviceableVillages: string;
}
export async function fetchAdminSettings() {
  return (await api.get('/admin/settings')).data.settings as AdminSettings;
}
export async function saveAdminSettings(s: Partial<AdminSettings>) {
  return (await api.post('/admin/settings', s)).data;
}
export interface Announcement {
  id: number; text: string; image: string; target: string; ctaText: string; ctaLink: string; enabled: boolean;
}
export async function fetchAnnouncement() {
  return (await api.get('/announcement', { params: { t: Date.now() } })).data.announcement as Announcement;
}
export async function saveAnnouncement(a: Omit<Announcement, 'id'>) {
  return (await api.post('/admin/announcement', a)).data as { announcement: Announcement };
}
export async function saveFestival(festival: string) {
  return (await api.post('/admin/festival', { festival })).data;
}
export async function bumpCache() {
  return (await api.post('/admin/cache/bump', {})).data as { assetVersion: number };
}

// ---- Banners ----
export async function saveBanners(banners: unknown[]) {
  return (await api.post('/admin/banners', { banners })).data;
}
export async function uploadBannerImage(dataUri: string): Promise<string> {
  return (await api.post('/admin/banners/upload', { image: dataUri })).data.url as string;
}

// ---- Categories ----
export interface CategoryPayload {
  id?: number;
  name: string;
  slug?: string;
  icon?: string;
  image?: string;
  hidden?: boolean;
  ageRestricted?: boolean;
  warning?: string;
}
export async function saveCategory(action: 'add' | 'update', category: CategoryPayload) {
  return (await api.post('/admin/categories', { action, category })).data;
}
export async function deleteCategory(id: number) {
  return (await api.post('/admin/categories', { action: 'delete', id })).data;
}

// ---- Push ----
export async function sendBroadcast(target: string, title: string, body: string, link?: string) {
  return (await api.post('/push/send', { target, title, body, link })).data;
}

export interface AdminOrder {
  order_id: string;
  order_status: string;
  total_amount: number;
  order_date: string;
  customer: { name?: string; mobile?: string; city?: string };
  items: { name: string; quantity: number }[];
  rider_name?: string;
}

export interface AdminUser {
  id: number;
  name: string;
  mobile: string;
  username: string;
  role: string;
  permissions?: string[];
}

export const PERMISSIONS = [
  'dashboard', 'orders', 'riderTracking', 'products', 'categories',
  'banners', 'ads', 'users', 'earnings', 'settings', 'team',
];

/** Original ADMIN_PERMISSION_OPTIONS (order + labels). */
export const PERMISSION_OPTIONS: [string, string][] = [
  ['dashboard', 'Dashboard'], ['orders', 'Orders'], ['products', 'Products'],
  ['categories', 'Categories'], ['banners', 'Banners'], ['ads', 'Ads & Social'], ['riderTracking', 'Rider Tracking'],
  ['users', 'Users'], ['earnings', 'Earnings'], ['settings', 'Settings'], ['team', 'Team Access'],
];

/** Trigger a browser download of text content (CSV / JSON exports). */
export function downloadText(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
