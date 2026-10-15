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

// ---- Marketing (customer reach, read-only) ----
export interface ReachCustomer {
  name: string;
  mobile: string;
  orders: number;
  spent: number;
  lastOrderAt: string | null;
  source: 'account' | 'guest' | 'both';
}
/** GET /api/admin/marketing/reach — deduped, WhatsApp-reachable customers. */
export async function fetchReach(params: { days?: number; q?: string } = {}): Promise<ReachCustomer[]> {
  const query: Record<string, string> = {};
  if (params.days) query.days = String(params.days);
  if (params.q) query.q = params.q;
  return (await api.get('/admin/marketing/reach', { params: query })).data.reach as ReachCustomer[];
}

// ---- Marketing Center: Festivals / Templates / Campaigns / Dashboard / Reports ----
// All endpoints live under /api/admin/marketing/* (requireAuth + requireStaff('ads')).
// Prisma BigInt ids serialize to numbers; DateTime columns serialize to ISO strings.

/** Mirrors MarketingFestival (api-node/prisma/schema.prisma → marketing_festivals). */
export interface MarketingFestival {
  id: number;
  name: string;
  slug: string;
  /** ISO date string (YYYY-MM-DD…) or null when the date still needs checking. */
  festival_date: string | null;
  greeting_hi: string | null;
  emoji: string | null;
  is_active: boolean;
  needs_date_check: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
export type FestivalInput = {
  name: string;
  slug: string;
  festival_date?: string | null;
  greeting_hi?: string | null;
  emoji?: string | null;
  is_active?: boolean;
  needs_date_check?: boolean;
  sort_order?: number;
};

/** Mirrors MarketingTemplate (marketing_templates). */
export interface MarketingTemplate {
  id: number;
  title: string;
  category: string;
  festival_slug: string | null;
  lang: string;
  body: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
export type TemplateInput = {
  title: string;
  category?: string;
  festival_slug?: string | null;
  lang?: string;
  body: string;
  is_active?: boolean;
  sort_order?: number;
};

/** Mirrors MarketingCampaign (marketing_campaigns). */
export interface MarketingCampaign {
  id: number;
  name: string;
  category: string | null;
  product_ids: number[] | null;
  template_id: number | null;
  customer_mobiles: string[] | null;
  message: string | null;
  status: string;
  notes: string | null;
  share_opened: number;
  copied_count: number;
  banners_downloaded: number;
  batches_prepared: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export type CampaignInput = {
  name: string;
  category?: string | null;
  product_ids?: number[];
  template_id?: number | null;
  customer_mobiles?: string[];
  message?: string | null;
  notes?: string | null;
  status?: string;
};
/** Atomic action-counter increments applied server-side via Prisma `{ increment }`. */
export type CampaignIncrements = {
  share_opened?: number;
  copied_count?: number;
  banners_downloaded?: number;
  batches_prepared?: number;
};

export interface MarketingDashboard {
  recommended: {
    festivalsSoon: MarketingFestival[];
    discountedProducts: import('../types').Product[];
    lowStock: import('../types').Product[];
  };
  upcomingFestivals: MarketingFestival[];
  selectedCount: number;
  recentCampaigns: MarketingCampaign[];
  expiringOffers: unknown[];
}

export interface MarketingReports {
  campaignsCreated: number;
  bannersDownloaded: number;
  /** Number of messages copied from the admin UI. */
  messagesCopied: number;
  /** WhatsApp links OPENED from the admin UI — NOT messages sent or delivered. */
  waLinksOpened: number;
  productsPromoted: number;
  batchesPrepared: number;
}

// -- Dashboard --
export async function fetchMarketingDashboard(): Promise<MarketingDashboard> {
  const d = (await api.get('/admin/marketing/dashboard')).data;
  return {
    recommended: {
      festivalsSoon: (d.recommended?.festivalsSoon as MarketingFestival[]) || [],
      discountedProducts: (d.recommended?.discountedProducts as MarketingDashboard['recommended']['discountedProducts']) || [],
      lowStock: (d.recommended?.lowStock as MarketingDashboard['recommended']['lowStock']) || [],
    },
    upcomingFestivals: (d.upcomingFestivals as MarketingFestival[]) || [],
    selectedCount: Number(d.selectedCount) || 0,
    recentCampaigns: (d.recentCampaigns as MarketingCampaign[]) || [],
    expiringOffers: (d.expiringOffers as unknown[]) || [],
  };
}

// -- Reports --
export async function fetchMarketingReports(): Promise<MarketingReports> {
  const r = (await api.get('/admin/marketing/reports')).data.reports || {};
  return {
    campaignsCreated: Number(r.campaignsCreated) || 0,
    bannersDownloaded: Number(r.bannersDownloaded) || 0,
    messagesCopied: Number(r.messagesCopied) || 0,
    waLinksOpened: Number(r.waLinksOpened) || 0,
    productsPromoted: Number(r.productsPromoted) || 0,
    batchesPrepared: Number(r.batchesPrepared) || 0,
  };
}

// -- Festivals CRUD --
export async function fetchFestivals(): Promise<MarketingFestival[]> {
  return (await api.get('/admin/marketing/festivals')).data.festivals as MarketingFestival[];
}
export async function createFestival(input: FestivalInput): Promise<MarketingFestival> {
  return (await api.post('/admin/marketing/festivals', input)).data.festival as MarketingFestival;
}
export async function updateFestival(id: number, input: Partial<FestivalInput>): Promise<MarketingFestival> {
  return (await api.put(`/admin/marketing/festivals/${id}`, input)).data.festival as MarketingFestival;
}
export async function deleteFestival(id: number): Promise<void> {
  await api.delete(`/admin/marketing/festivals/${id}`);
}

// -- Templates CRUD --
export async function fetchTemplates(params: { category?: string; festival_slug?: string } = {}): Promise<MarketingTemplate[]> {
  const query: Record<string, string> = {};
  if (params.category) query.category = params.category;
  if (params.festival_slug) query.festival_slug = params.festival_slug;
  return (await api.get('/admin/marketing/templates', { params: query })).data.templates as MarketingTemplate[];
}
export async function createTemplate(input: TemplateInput): Promise<MarketingTemplate> {
  return (await api.post('/admin/marketing/templates', input)).data.template as MarketingTemplate;
}
export async function updateTemplate(id: number, input: Partial<TemplateInput>): Promise<MarketingTemplate> {
  return (await api.put(`/admin/marketing/templates/${id}`, input)).data.template as MarketingTemplate;
}
export async function deleteTemplate(id: number): Promise<void> {
  await api.delete(`/admin/marketing/templates/${id}`);
}

// -- Campaigns --
export async function fetchCampaigns(params: { limit?: number } = {}): Promise<MarketingCampaign[]> {
  const query: Record<string, string> = {};
  if (params.limit) query.limit = String(params.limit);
  return (await api.get('/admin/marketing/campaigns', { params: query })).data.campaigns as MarketingCampaign[];
}
export async function createCampaign(input: CampaignInput): Promise<MarketingCampaign> {
  return (await api.post('/admin/marketing/campaigns', input)).data.campaign as MarketingCampaign;
}
/** Update status/notes and/or atomically increment action counters. */
export async function updateCampaign(
  id: number,
  input: { status?: string; notes?: string | null; increments?: CampaignIncrements },
): Promise<MarketingCampaign> {
  return (await api.put(`/admin/marketing/campaigns/${id}`, input)).data.campaign as MarketingCampaign;
}

// -- Consent opt-out --
/** Set users.marketing_opt_out for a WhatsApp-reachable account mobile. */
export async function setOptOut(mobile: string, optOut: boolean): Promise<void> {
  await api.post('/admin/marketing/opt-out', { mobile, optOut });
}

// ---- Short Links (universal /link/<code> short-link subsystem) ----
// Backend: GET/POST /api/admin/links (requireAuth + requireStaff('ads')) and the
// public resolver GET /api/products/:id/short-link. Prisma BigInt ids serialize
// to numbers; DateTime columns serialize to ISO strings.

/** Mirrors ShortLink (api-node/prisma/schema.prisma → short_links). */
export interface ShortLink {
  code: string;
  target_url: string;
  /** 'product' for auto-created product links, 'custom' for admin-created links. */
  type: string;
  clicks: number;
  created_at: string;
}

/** GET /api/admin/links — newest-first short links. */
export async function fetchShortLinks(): Promise<ShortLink[]> {
  return (await api.get('/admin/links')).data.links as ShortLink[];
}
/** POST /api/admin/links — create a short link for ANY url; 409 on duplicate custom code. */
export async function createShortLink(input: { targetUrl: string; type?: string; code?: string }) {
  return (await api.post('/admin/links', input)).data;
}
/** GET /api/products/:id/short-link — resolve (minting on demand) a product's short code. */
export async function fetchProductShortLink(id: number): Promise<string | null> {
  return (await api.get(`/products/${id}/short-link`)).data.code as string | null;
}

// ---- Team Access ----
export async function fetchTeam() {
  return (await api.get('/admin/team')).data.admins as AdminUser[];
}
export async function teamAction(action: 'create' | 'update' | 'delete', body: Record<string, unknown>) {
  return (await api.post('/admin/team', { action, ...body })).data;
}

// ---- Settings ----
/**
 * Provider-agnostic WhatsApp API config — PREP ONLY (not live).
 * Carried through the authenticated admin settings endpoint only; it is never
 * part of the public settings payload. The free wa.me flow (lib/whatsapp.ts)
 * stays the only active send path until lib/waSender.ts is wired.
 */
export interface WhatsappApiConfig {
  provider: 'none' | 'cloud_api' | 'custom';
  baseUrl: string;
  token: string;
  phoneNumberId: string;
  enabled: boolean;
}
export interface AdminSettings {
  storeEmail: string; deliveryCharge: number; freeDeliveryAbove: number; upiId: string; upiName: string;
  hideMrp: boolean; storePhone: string; storeAddress: string; storeLatitude: number | null; storeLongitude: number | null;
  serviceableVillages: string;
  handlingCharge: number; deliveryChargeEnabled: boolean; handlingChargeEnabled: boolean; staffOrderAlertsEnabled: boolean;
  /** Whether an owner master password is configured. The hash itself is never returned. */
  masterPasswordSet?: boolean;
  /** WhatsApp API config (PREP ONLY) — admin-only, never on the public settings. */
  whatsappApi?: WhatsappApiConfig;
}
export async function fetchAdminSettings() {
  return (await api.get('/admin/settings')).data.settings as AdminSettings;
}
export async function saveAdminSettings(s: Partial<AdminSettings>) {
  return (await api.post('/admin/settings', s)).data;
}

// ---- Owner master password (OWNER/superadmin only) ----
// Set/change with a non-empty password, or clear/disable with an empty string.
// The hash is never returned; only `masterPasswordSet` reflects the new state.
export async function saveMasterPassword(password: string) {
  return (await api.post('/admin/master-password', { password })).data as {
    message: string;
    masterPasswordSet: boolean;
  };
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
