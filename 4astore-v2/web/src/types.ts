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
