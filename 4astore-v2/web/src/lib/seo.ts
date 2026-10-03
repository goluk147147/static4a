// Shared web SEO helpers — pure builders mirroring the API's localSeo.ts
// (api-node/src/seo/localSeo.ts) so humans + JS crawlers get the SAME JSON-LD the
// server emits for link crawlers. The <Seo> component (components/Seo.tsx) wraps
// react-helmet-async <Helmet> and consumes these builders.

import type { Product, SeoConfig } from '../types';

/** schema.org JSON-LD objects are loosely typed records. */
export type JsonLd = Record<string, unknown>;

/** Fallbacks used before the API config.seo (always complete in practice) arrives. */
const LOCAL = {
  storeName: '4A Store',
  areaServed: ['Chandargarh', 'Nabinagar', 'Aurangabad', 'Bihar'],
  pin: '824301',
  keywordSeeds: ['grocery delivery', 'kirana', 'online grocery', 'home delivery', 'sabzi', 'daily essentials'],
};

const titleTemplate = (cfg?: SeoConfig) => cfg?.titleTemplate || `%s | ${LOCAL.storeName}`;

/** Apply cfg.titleTemplate ('%s | 4A Store') to a page/product title. */
export function applyTitleTemplate(title: string, cfg?: SeoConfig): string {
  const tpl = titleTemplate(cfg);
  // If the title already ends with the store name, don't double it.
  if (/\|\s*4A Store\s*$/i.test(title)) return title;
  return tpl.includes('%s') ? tpl.replace('%s', title) : `${title} ${tpl}`.trim();
}

/** Absolute URL for a SPA path using the current origin (SSR-safe no-op fallback). */
export function buildCanonical(path: string): string {
  const origin = typeof window !== 'undefined' && window.location ? window.location.origin : '';
  if (/^https?:/i.test(path)) return path;
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
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

/** Mirror of the API deriveProductSeo(): override-first, else a generated local line. */
export function deriveProductSeo(product: Product): DerivedProductSeo {
  const name = product.name || LOCAL.storeName;
  const price = toNum(product.price);
  const title =
    (product.seo_title && product.seo_title.trim()) ||
    (price > 0 ? `${name} - ₹${price} | ${LOCAL.storeName}` : `${name} | ${LOCAL.storeName}`);

  let description = (product.seo_description && product.seo_description.trim()) || '';
  if (!description) {
    const base = product.description ? stripHtml(product.description) : '';
    description =
      base ||
      `${name}${product.weight ? ` (${product.weight})` : ''} ${LOCAL.storeName} se ${LOCAL.areaServed[0]}, ${LOCAL.areaServed[1]} me online order karein — fast home delivery.`;
  }
  if (description.length > 160) description = `${description.slice(0, 157).trimEnd()}…`;

  let keywords = (product.seo_keywords && product.seo_keywords.trim()) || '';
  if (!keywords) {
    const parts = [name, product.brand || '', product.category || '', ...LOCAL.keywordSeeds, ...LOCAL.areaServed]
      .map((p) => String(p).trim())
      .filter(Boolean);
    keywords = [...new Set(parts)].join(', ');
  }

  return { title, description, keywords };
}

// -------------------- JSON-LD builders (mirror localSeo.ts) --------------------
export function productJsonLd(product: Product, cfg: SeoConfig | undefined, url: string, imageUrl?: string | null): JsonLd {
  const price = toNum(product.price);
  const seo = deriveProductSeo(product);
  const jsonLd: JsonLd = {
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
      availability: product.in_stock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url,
      seller: { '@type': 'Organization', name: cfg?.business.name || LOCAL.storeName },
    };
  }
  return jsonLd;
}

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export function breadcrumbJsonLd(items: BreadcrumbItem[]): JsonLd {
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

export function organizationJsonLd(cfg?: SeoConfig): JsonLd {
  const name = cfg?.business.name || LOCAL.storeName;
  const sameAs = [cfg?.social.facebook, cfg?.social.instagram, cfg?.social.whatsapp].filter(Boolean) as string[];
  const org: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name,
    url: buildCanonical('/'),
    logo: cfg?.defaultOgImage || buildCanonical('/assets/og-default.png'),
  };
  if (sameAs.length) org.sameAs = sameAs;
  if (cfg?.business.phone) org.telephone = cfg.business.phone;
  return org;
}

export function localBusinessJsonLd(cfg?: SeoConfig): JsonLd {
  const b = cfg?.business;
  const biz: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'GroceryStore',
    name: b?.name || LOCAL.storeName,
    url: buildCanonical('/'),
    image: cfg?.defaultOgImage || buildCanonical('/assets/og-default.png'),
    priceRange: b?.priceRange || '₹',
    openingHours: b?.openingHours || 'Mo-Su 07:00-21:00',
    address: {
      '@type': 'PostalAddress',
      streetAddress: b?.address || `${LOCAL.areaServed[0]}, ${LOCAL.areaServed[2]}, Bihar ${LOCAL.pin}`,
      addressRegion: 'Bihar',
      postalCode: LOCAL.pin,
      addressCountry: 'IN',
    },
    areaServed: (b?.areaServed?.length ? b.areaServed : LOCAL.areaServed).map((name) => ({ '@type': 'Place', name })),
  };
  if (b?.phone) biz.telephone = b.phone;
  if (b && Number.isFinite(b.geo.lat) && Number.isFinite(b.geo.lng)) {
    biz.geo = { '@type': 'GeoCoordinates', latitude: b.geo.lat, longitude: b.geo.lng };
  }
  return biz;
}
