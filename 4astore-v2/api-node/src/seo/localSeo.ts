// Shared local-SEO helpers: defaults, config shape, per-product SEO derivation and
// schema.org JSON-LD builders. Pure + typed so both the crawler share HTML (routes/og.ts)
// and the admin/config surface (routes/catalog.ts, routes/admin.ts) reuse one source of truth.
//
// 4A Store is a single local kirana/grocery shop serving a handful of villages in Bihar,
// so the defaults are deliberately hyper-local (areaServed, pincode, keyword seeds).

import { SITE_ORIGIN } from './origin';

// -------------------- Local constants --------------------
export const LOCAL = {
  storeName: '4A Store',
  areaServed: ['Chandargarh', 'Nabinagar', 'Aurangabad', 'Bihar'],
  pin: '824301',
  keywordSeeds: [
    'grocery delivery',
    'kirana',
    'online grocery',
    'home delivery',
    'sabzi',
    'daily essentials',
  ],
} as const;

// -------------------- Config shape --------------------
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
  defaultLang: 'hi' | 'en';
  social: SeoSocial;
  business: SeoBusiness;
}

// A loose view of the `settings` row (raw table) we read business defaults from.
export interface SettingsRow {
  store_address?: unknown;
  store_phone?: unknown;
  store_latitude?: unknown;
  store_longitude?: unknown;
  [key: string]: unknown;
}

const num = (v: unknown, dflt: number): number => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : dflt;
};
const str = (v: unknown, dflt = ''): string => (v == null ? dflt : String(v));

/**
 * Build a complete SeoConfig from local defaults + the store settings row.
 * Business fields are derived from settings (store_address/phone/latitude/longitude).
 */
export function defaultSeoConfig(settingsRow?: SettingsRow | null): SeoConfig {
  const s = settingsRow || {};
  const defaultDescription = `${LOCAL.storeName} — grocery, kirana aur daily essentials ki online home delivery ${LOCAL.areaServed[0]}, ${LOCAL.areaServed[1]} aur aas-paas ke gaon me.`;
  return {
    titleTemplate: `%s | ${LOCAL.storeName}`,
    defaultDescription,
    defaultKeywords: [...LOCAL.keywordSeeds, ...LOCAL.areaServed, LOCAL.storeName].join(', '),
    defaultOgImage: `${SITE_ORIGIN}/assets/og-default.png`,
    robotsExtra: '',
    defaultLang: 'hi',
    social: { whatsapp: '', instagram: '', facebook: '' },
    business: {
      name: LOCAL.storeName,
      address: str(s.store_address, `${LOCAL.areaServed[0]}, ${LOCAL.areaServed[2]}, Bihar ${LOCAL.pin}`),
      phone: str(s.store_phone, ''),
      geo: { lat: num(s.store_latitude, 24.580164), lng: num(s.store_longitude, 84.114194) },
      openingHours: 'Mo-Su 07:00-21:00',
      priceRange: '₹',
      areaServed: [...LOCAL.areaServed],
    },
  };
}

/**
 * Merge an admin-saved raw SEO blob (parsed JSON, possibly null/partial) onto the
 * settings-derived defaults. Missing keys fall back to the default — ADD-only, never
 * throws on garbage input.
 */
export function mergeSeoConfig(raw: unknown, settingsRow?: SettingsRow | null): SeoConfig {
  const base = defaultSeoConfig(settingsRow);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const social = (r.social && typeof r.social === 'object' ? r.social : {}) as Record<string, unknown>;
  const business = (r.business && typeof r.business === 'object' ? r.business : {}) as Record<string, unknown>;
  const geo = (business.geo && typeof business.geo === 'object' ? business.geo : {}) as Record<string, unknown>;
  const areaServed = Array.isArray(business.areaServed)
    ? business.areaServed.map((x) => String(x)).filter(Boolean)
    : base.business.areaServed;
  return {
    titleTemplate: str(r.titleTemplate, base.titleTemplate) || base.titleTemplate,
    defaultDescription: str(r.defaultDescription, base.defaultDescription) || base.defaultDescription,
    defaultKeywords: str(r.defaultKeywords, base.defaultKeywords) || base.defaultKeywords,
    defaultOgImage: str(r.defaultOgImage, base.defaultOgImage) || base.defaultOgImage,
    robotsExtra: str(r.robotsExtra, base.robotsExtra),
    defaultLang: r.defaultLang === 'en' ? 'en' : 'hi',
    social: {
      whatsapp: str(social.whatsapp, base.social.whatsapp),
      instagram: str(social.instagram, base.social.instagram),
      facebook: str(social.facebook, base.social.facebook),
    },
    business: {
      name: str(business.name, base.business.name) || base.business.name,
      address: str(business.address, base.business.address) || base.business.address,
      phone: str(business.phone, base.business.phone),
      geo: { lat: num(geo.lat, base.business.geo.lat), lng: num(geo.lng, base.business.geo.lng) },
      openingHours: str(business.openingHours, base.business.openingHours) || base.business.openingHours,
      priceRange: str(business.priceRange, base.business.priceRange) || base.business.priceRange,
      areaServed: areaServed.length ? areaServed : base.business.areaServed,
    },
  };
}

// -------------------- Per-product SEO --------------------
// A loose product view so this helper is not tied to the Prisma type directly.
export interface ProductLike {
  id?: number | bigint;
  name: string;
  brand?: string | null;
  category?: string | null;
  weight?: string | null;
  price?: number | string | { toString(): string } | null;
  mrp?: number | string | { toString(): string } | null;
  image?: string | null;
  description?: string | null;
  in_stock?: boolean | null;
  seo_title?: string | null;
  seo_description?: string | null;
  seo_keywords?: string | null;
  og_image?: string | null;
}

const toNum = (v: unknown): number => {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};
const stripHtml = (html: string): string => String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

export interface DerivedProductSeo {
  title: string;
  description: string;
  keywords: string;
}

/**
 * Resolve the effective SEO title/description/keywords for a product, preferring the
 * admin-set override and otherwise generating a sensible local line.
 */
export function deriveProductSeo(product: ProductLike): DerivedProductSeo {
  const name = product.name || LOCAL.storeName;
  const price = toNum(product.price);
  const title =
    (product.seo_title && String(product.seo_title).trim()) ||
    (price > 0 ? `${name} - ₹${price} | ${LOCAL.storeName}` : `${name} | ${LOCAL.storeName}`);

  let description = (product.seo_description && String(product.seo_description).trim()) || '';
  if (!description) {
    const base = product.description ? stripHtml(String(product.description)) : '';
    description =
      base ||
      `${name}${product.weight ? ` (${product.weight})` : ''} ${LOCAL.storeName} se ${LOCAL.areaServed[0]}, ${LOCAL.areaServed[1]} me online order karein — fast home delivery.`;
  }
  if (description.length > 160) description = `${description.slice(0, 157).trimEnd()}…`;

  let keywords = (product.seo_keywords && String(product.seo_keywords).trim()) || '';
  if (!keywords) {
    const parts = [name, product.brand || '', product.category || '', ...LOCAL.keywordSeeds, ...LOCAL.areaServed]
      .map((p) => String(p).trim())
      .filter(Boolean);
    keywords = [...new Set(parts)].join(', ');
  }

  return { title, description, keywords };
}

// -------------------- JSON-LD builders --------------------
export function buildProductJsonLd(product: ProductLike, cfg: SeoConfig, url: string, imageUrl?: string | null) {
  const price = toNum(product.price);
  const seo = deriveProductSeo(product);
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: seo.description,
    url,
    sku: product.id != null ? String(product.id) : undefined,
    brand: product.brand ? { '@type': 'Brand', name: product.brand } : undefined,
    category: product.category || undefined,
  };
  if (imageUrl) jsonLd.image = imageUrl;
  if (price > 0) {
    jsonLd.offers = {
      '@type': 'Offer',
      price: price.toFixed(2),
      priceCurrency: 'INR',
      availability:
        product.in_stock === false
          ? 'https://schema.org/OutOfStock'
          : 'https://schema.org/InStock',
      url,
      seller: { '@type': 'Organization', name: cfg.business.name },
    };
  }
  return jsonLd;
}

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export function buildBreadcrumbJsonLd(items: BreadcrumbItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}

export interface ItemListEntry {
  name: string;
  url: string;
}

/**
 * Ordered ItemList of entries (used by the category share route in FEAT-002 to
 * describe the member products of a category page). Mirrors buildBreadcrumbJsonLd.
 */
export function buildItemListJsonLd(items: ItemListEntry[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    numberOfItems: items.length,
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      url: it.url,
    })),
  };
}

export function buildOrganizationJsonLd(cfg: SeoConfig) {
  const sameAs = [cfg.social.facebook, cfg.social.instagram, cfg.social.whatsapp].filter(Boolean);
  const org: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: cfg.business.name,
    url: SITE_ORIGIN,
    logo: cfg.defaultOgImage,
  };
  if (sameAs.length) org.sameAs = sameAs;
  if (cfg.business.phone) org.telephone = cfg.business.phone;
  return org;
}

export function buildLocalBusinessJsonLd(cfg: SeoConfig) {
  const b = cfg.business;
  const biz: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'GroceryStore',
    name: b.name,
    url: SITE_ORIGIN,
    image: cfg.defaultOgImage,
    priceRange: b.priceRange,
    openingHours: b.openingHours,
    address: {
      '@type': 'PostalAddress',
      streetAddress: b.address,
      addressRegion: 'Bihar',
      postalCode: LOCAL.pin,
      addressCountry: 'IN',
    },
    areaServed: b.areaServed.map((name) => ({ '@type': 'Place', name })),
  };
  if (b.phone) biz.telephone = b.phone;
  if (Number.isFinite(b.geo.lat) && Number.isFinite(b.geo.lng)) {
    biz.geo = { '@type': 'GeoCoordinates', latitude: b.geo.lat, longitude: b.geo.lng };
  }
  return biz;
}
