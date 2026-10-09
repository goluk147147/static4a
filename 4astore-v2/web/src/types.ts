export interface Product {
  id: number;
  name: string;
  brand?: string;
  category: string;
  weight?: string;
  mrp: number;
  price: number;
  discount: number;
  image?: string;
  description?: string;
  features?: string[];
  in_stock: boolean;
  featured?: boolean; // daily "Aaj ka Special" video picks these first
  // Per-product SEO (ADD-only; API returns null when unset — see FEAT-001).
  seo_title?: string | null;
  seo_description?: string | null;
  seo_keywords?: string | null;
  og_image?: string | null;
  // Automatic SEO engine metadata (ADD-only; FEAT-002/003).
  seo_slug?: string | null;
  seo_score?: number | null;
  seo_problems?: string[] | null;
  seo_overrides?: Record<string, boolean> | null;
}

/** Mirrors the API SeoConfig (api-node/src/seo/localSeo.ts). config.seo is always complete. */
export interface SeoBusiness {
  name: string;
  address: string;
  phone: string;
  geo: { lat: number; lng: number };
  openingHours: string;
  priceRange: string;
  areaServed: string[];
}

export interface SeoSocial {
  whatsapp: string;
  instagram: string;
  facebook: string;
}

export interface SeoConfig {
  titleTemplate: string;
  defaultDescription: string;
  defaultKeywords: string;
  defaultOgImage: string;
  robotsExtra: string;
  social: SeoSocial;
  business: SeoBusiness;
  /** Default language for auto-generated descriptions (automatic SEO engine). */
  defaultLang?: 'hi' | 'en';
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  icon?: string;
  image?: string;
  hidden?: boolean;
  age_restricted?: boolean;
  warning?: string;
  // Automatic SEO engine metadata (ADD-only; FEAT-002/003).
  seo_title?: string | null;
  seo_description?: string | null;
  seo_keywords?: string | null;
  seo_intro?: string | null;
  og_image?: string | null;
  seo_score?: number | null;
  seo_problems?: string[] | null;
  seo_overrides?: Record<string, boolean> | null;
}

// ---- Automatic SEO engine dashboard types (FEAT-003; mirror /api/admin/seo-auto/*) ----

/** Explicit unavailable states for PHASE-2 metrics — never a fabricated number. */
export type SeoUnavailable = 'unavailable' | 'not_connected';

export interface SeoDashboardCounters {
  products: {
    total: number;
    optimized: number;
    needingAttention: number;
    withProblems: number;
    missingMetadata: number;
  };
  categories: {
    total: number;
    optimized: number;
    needingAttention: number;
  };
  duplicates: {
    titles: number;
    descriptions: number;
    slugs: number;
  };
  // PHASE-2 metrics surface as an explicit unavailable/not-connected string.
  brokenLinks: SeoUnavailable;
  coreWebVitals: SeoUnavailable;
  organicPerformance: SeoUnavailable;
}

export type SeoJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface SeoJobLogEntry {
  entityType?: string;
  id?: number;
  action?: string;
  problem?: string;
}

export interface SeoJobView {
  id: number;
  type: 'optimize_all' | 'optimize_selected' | 'optimize_category' | 'audit';
  status: SeoJobStatus;
  scope: { productIds?: number[]; category?: string } | null;
  total: number;
  processed: number;
  updated: number;
  skipped: number;
  failed: number;
  progress: number;
  backupId: number | null;
  log: SeoJobLogEntry[];
  error: string | null;
  createdBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface SeoIntegrationStatus {
  provider: 'gsc' | 'ga4' | 'gbp';
  status: 'connected' | 'disconnected' | 'error';
  accountRef: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  credsPresent: boolean;
  message: string;
}

export interface SeoRecentChange {
  entityType: string;
  entityId: string;
  action: string;
  field: string | null;
  reason: string | null;
  actor: string | null;
  at: string;
}

export interface SeoDashboard {
  counters: SeoDashboardCounters;
  attentionThreshold: number;
  jobs: SeoJobView[];
  integrations: SeoIntegrationStatus[];
  recentChanges: SeoRecentChange[];
}

export type SeoProductsFilter = 'all' | 'needs-attention' | 'duplicate';
export type SeoOptimizeMode = 'all' | 'selected' | 'category';

export interface SeoProductRow {
  id: number;
  name: string;
  title: string | null;
  slug: string | null;
  score: number | null;
  problems: string[];
  needsAttention: boolean;
  generatedAt: string | null;
}

export interface SeoProductsPage {
  products: SeoProductRow[];
  nextCursor: number | null;
}

export interface Banner {
  title: string;
  subtitle?: string;
  btnText?: string;
  btnLink?: string;
  gradient?: [string, string];
  image?: string;
  festival?: string;
  active?: boolean;
}

export interface Ad {
  id: number;
  title: string;
  description: string;
  bgColor?: string;
  borderColor?: string;
  icon?: string;
  link?: string;
  active?: boolean;
}

export interface StoreConfig {
  banners: Banner[];
  ads: Ad[];
  festivalAds: Record<string, unknown>;
  festivalCategories: Record<string, string[]>;
  socialProofMessages: string[];
  socialProofNames: string[];
  currentFestival: string;
  footer?: Partial<import('./lib/footer').FooterConfig> | null;
  /** Boolean feature flags from the API (config.features). Absent = all ON. */
  features?: Record<string, boolean>;
  /** Global SEO defaults + LocalBusiness info (config.seo). Always complete from the API. */
  seo?: SeoConfig;
}

export interface Settings {
  deliveryCharge: number;
  freeDeliveryAbove: number;
  upiId: string;
  upiName: string;
  hideMrp: boolean;
  storePhone: string;
  storeAddress: string;
  storeLatitude: number;
  storeLongitude: number;
  serviceableVillages: string;
}

export interface User {
  id: number;
  name: string;
  mobile: string;
  username: string;
  role: string;
  permissions?: string[];
  email?: string | null;
  recovery_email?: string | null;
  registered_at?: string | null;
  /** Per-user fixed delivery fee set by admin; overrides the global rule when not null. */
  custom_delivery?: number | null;
}

export interface CartItem {
  id: number;
  name: string;
  weight?: string;
  price: number;
  mrp?: number;
  category?: string;
  image?: string;
  quantity: number;
}

export interface SavedAddress {
  id: number;
  label: 'Home' | 'Work' | 'Other';
  receiver_name: string;
  phone: string;
  house_no: string;
  landmark?: string | null;
  full_address?: string | null;
  city: string;
  district?: string | null;
  state?: string | null;
  pincode: string;
  latitude?: number | null;
  longitude?: number | null;
  is_default?: number | boolean;
}
