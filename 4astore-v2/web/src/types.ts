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
