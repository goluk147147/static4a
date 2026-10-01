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

export interface FestAd {
  title: string;
  text: string;
  bgGradient: [string, string];
  link: string;
  emoji: string;
}

export interface StoreConfig {
  banners: Banner[];
  ads: Ad[];
  festivalAds: Record<string, { leftAd?: FestAd; rightAd?: FestAd; midBanner?: FestAd }>;
  festivalCategories: Record<string, string[]>;
  socialProofMessages: string[];
  socialProofNames: string[];
  currentFestival: string;
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
  permissions?: string[] | null;
  email?: string | null;
  recovery_email?: string | null;
  registered_at?: string | null;
  backend_rider?: boolean;
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

export interface OrderItem {
  id?: number;
  name: string;
  weight?: string;
  price: number;
  quantity: number;
}

export interface Order {
  order_id: string;
  order_status: string;
  order_date: string;
  delivered_at?: string | null;
  subtotal: number;
  discount: number;
  delivery_charge: number;
  total_amount: number;
  payment_method: string;
  payment_reference?: string | null;
  customer: {
    name?: string;
    mobile?: string;
    email?: string;
    address?: string;
    landmark?: string;
    city?: string;
    pincode?: string;
    deliveryLat?: number | null;
    deliveryLng?: number | null;
  };
  items: OrderItem[];
  delivery_address?: {
    label?: string;
    receiver_name?: string;
    phone?: string;
    full_address?: string;
    landmark?: string;
    city?: string;
    latitude?: number | null;
    longitude?: number | null;
  } | null;
  rider_id?: string | null;
  rider_name?: string | null;
  rider_mobile?: string | null;
  assigned_at?: string | null;
}

export interface Announcement {
  id: number;
  text: string;
  image: string;
  target: string;
  ctaText: string;
  ctaLink: string;
  enabled: boolean;
}

export interface CmsPage {
  id: number;
  slug: string;
  title: string;
  metaDescription: string;
  content: string;
  showInFooter: boolean;
}

export interface Tracking {
  order_id: string;
  status: string;
  rider: {
    id: string | null;
    name: string;
    phone: string;
    location: { latitude: number; longitude: number } | null;
  };
  customer: { latitude: number | null; longitude: number | null };
  store: { latitude: number; longitude: number; name: string; address: string };
  route: { distance: number; eta: number; polyline?: { coordinates: number[][] } } | null;
}
