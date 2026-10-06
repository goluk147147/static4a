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
  handlingCharge: number; deliveryChargeEnabled: boolean; handlingChargeEnabled: boolean; staffOrderAlertsEnabled: boolean;
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

// ---- Owner-only Data tools (import dummy data / factory reset) ----
export interface DataStatus {
  counts: { users: number; products: number; categories: number; orders: number };
  ownerExists: boolean;
}
export interface ImportSummary {
  categories: number; products: number; banners: number; ads: number; settings: true; announcement: true;
}
export async function dataStatus() {
  return (await api.get('/admin/data/status')).data as DataStatus & { success: boolean };
}
export async function importDummyData() {
  return (await api.post('/admin/data/import', {})).data as { summary: ImportSummary };
}
export async function factoryReset(confirm: string) {
  return (await api.post('/admin/data/reset', { confirm })).data as { reset: boolean; ownerSeeded: boolean };
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
export async function sendBroadcast(target: string, title: string, body: string, link?: string, image?: string, productId?: string) {
  return (await api.post('/push/send', { target, title, body, link, image, productId })).data;
}

// ---- Notification history (GET /api/admin/notifications) ----
export interface AdminNotification {
  id: number;
  type: string;
  title: string;
  body: string;
  image: string | null;
  link: string | null;
  target: string;
  productId: number | null;
  orderId: string | null;
  sentBy: string | null;
  successCount: number;
  failureCount: number;
  createdAt: string;
}
export interface NotificationPage {
  notifications: AdminNotification[];
  nextCursor: string | null;
}
export async function fetchNotifications(params: { userId?: string; productId?: string; limit?: number; cursor?: string } = {}): Promise<NotificationPage> {
  const res = (await api.get('/admin/notifications', { params })).data;
  return { notifications: (res.notifications as AdminNotification[]) || [], nextCursor: (res.nextCursor as string | null) ?? null };
}

// ---- Dashboard stats (GET /api/admin/stats) ----
export interface AdminStats {
  revenue: { today: number; month: number; allTime: number };
  deliveredOrders: number;
  totalOrders: number;
  statusCounts: Record<string, number>;
  topProducts: { productId: number | null; name: string; quantity: number }[];
  outOfStock: number;
}
export async function fetchAdminStats(): Promise<AdminStats> {
  const d = (await api.get('/admin/stats')).data;
  return {
    revenue: d.revenue || { today: 0, month: 0, allTime: 0 },
    deliveredOrders: Number(d.deliveredOrders) || 0,
    totalOrders: Number(d.totalOrders) || 0,
    statusCounts: d.statusCounts || {},
    topProducts: (d.topProducts as AdminStats['topProducts']) || [],
    outOfStock: Number(d.outOfStock) || 0,
  };
}

// ---- App version / force-update (GET /api/version, POST /api/admin/version) ----
export interface AppVersion {
  versionCode: number;
  versionName: string;
  url: string;
  message: string;
  forceUpdate: boolean;
  assetVersion: number;
}
export async function fetchAppVersion(): Promise<AppVersion> {
  const d = (await api.get('/version', { params: { t: Date.now() } })).data;
  return {
    versionCode: Number(d.versionCode) || 1,
    versionName: String(d.versionName ?? '1.0.0'),
    url: String(d.url ?? ''),
    message: String(d.message ?? ''),
    forceUpdate: !!d.forceUpdate,
    assetVersion: Number(d.assetVersion) || 1,
  };
}
export async function saveAppVersion(payload: {
  version_code: number;
  version_name: string;
  url: string;
  message: string;
  force_update: boolean;
}): Promise<AppVersion> {
  const d = (await api.post('/admin/version', payload)).data;
  return {
    versionCode: Number(d.versionCode) || payload.version_code,
    versionName: String(d.versionName ?? payload.version_name),
    url: String(d.url ?? ''),
    message: String(d.message ?? ''),
    forceUpdate: !!d.forceUpdate,
    assetVersion: Number(d.assetVersion) || 1,
  };
}

// ---- Feature flags ----
export async function saveFeatures(features: Record<string, boolean>) {
  return (await api.post('/admin/features', { features })).data as { features: Record<string, boolean> };
}

// ---- SEO ----
/** Save global SEO defaults + LocalBusiness info (POST /admin/seo). Partial payloads merge server-side. */
export async function saveSeo(payload: Record<string, unknown>) {
  return (await api.post('/admin/seo', payload)).data as { success?: boolean; seo: import('../types').SeoConfig };
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
