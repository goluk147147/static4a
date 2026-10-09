// Pure (DB-free) SEO generators for the automatic SEO engine.
//
// Every function here takes plain input and returns a payload — no Prisma, no I/O —
// so they are unit-testable in isolation and reused by persist.ts / seoQueue.ts
// (FEAT-002). All generated text is built ONLY from verified attributes: nothing
// here fabricates prices, stock, ratings, reviews, or marketing claims. The
// validation layer (validate.ts) is the enforcement point; this layer simply never
// emits anything it was not given.

import crypto from 'crypto';
import { LOCAL, type SeoConfig, type ProductLike } from './localSeo';
import { SITE_ORIGIN } from './origin';
import { slugify } from '../utils/slug';

// -------------------- Indexing policy (design §6.7) --------------------
// Single source of truth for per-page-type indexing. `index` pages must never be
// emitted as noindex (BLOCKED_PUBLIC gate); the rest are hard noindex.
export type IndexingDirective = 'index,follow' | 'noindex,nofollow';

export const INDEXING_POLICY: Record<string, IndexingDirective> = {
  home: 'index,follow',
  about: 'index,follow',
  contact: 'index,follow',
  delivery: 'index,follow',
  policies: 'index,follow',
  offers: 'index,follow',
  blog: 'index,follow',
  product: 'index,follow',
  category: 'index,follow',
  cart: 'noindex,nofollow',
  checkout: 'noindex,nofollow',
  account: 'noindex,nofollow',
  profile: 'noindex,nofollow',
  admin: 'noindex,nofollow',
  search: 'noindex,nofollow',
  order: 'noindex,nofollow',
  track: 'noindex,nofollow',
};

// -------------------- Generated payload shapes --------------------
export interface GeneratedProductSeo {
  title: string;
  description: string;
  descHi: string;
  descEn: string;
  keywords: string;
  slug: string;
  imageAlt: string;
  canonical: string;
  indexing: IndexingDirective;
}

export interface GeneratedCategorySeo {
  title: string;
  description: string;
  intro: string;
  keywords: string;
  slug: string;
  imageAlt: string;
  canonical: string;
  indexing: IndexingDirective;
}

// A loose category view (DB-free).
export interface CategoryLike {
  id?: number | bigint;
  name: string;
  slug?: string | null;
  image?: string | null;
  og_image?: string | null;
}

// -------------------- Small helpers --------------------
const toNum = (v: unknown): number => {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};
const clean = (v: unknown): string => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

/**
 * Clamp a string to `max` characters on a WORD boundary (never mid-word). If the
 * whole first word is longer than max, hard-slice it as a last resort.
 */
export function clampWords(text: string, max: number): string {
  const t = clean(text);
  if (t.length <= max) return t;
  const slice = t.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace > 0) return slice.slice(0, lastSpace).trimEnd();
  return slice.trimEnd();
}

/**
 * De-duplicate comma tokens (case-insensitive, order-preserving) THEN cap the joined
 * string to `max` characters on a comma boundary — whole trailing tokens are dropped,
 * never sliced mid-token.
 */
export function dedupeAndCapKeywords(tokens: string[], max = 500): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of tokens) {
    const tok = clean(raw);
    if (!tok) continue;
    const key = tok.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(tok);
  }
  let out = '';
  for (const tok of kept) {
    const next = out ? `${out}, ${tok}` : tok;
    if (next.length > max) break;
    out = next;
  }
  return out;
}

// -------------------- source hash (change detection) --------------------
/**
 * SHA-1 of the ordered source fields used for generation. A changed hash means the
 * entity must be regenerated. Null/undefined fields contribute an empty segment so
 * the ordering stays stable.
 */
export function sourceHash(entity: Record<string, unknown>): string {
  const ordered = Object.keys(entity)
    .sort()
    .map((k) => `${k}=${entity[k] == null ? '' : String(entity[k])}`)
    .join('\u0001');
  return crypto.createHash('sha1').update(ordered).digest('hex');
}

export function productSourceHash(product: ProductLike): string {
  return sourceHash({
    name: product.name,
    brand: product.brand ?? '',
    category: product.category ?? '',
    weight: product.weight ?? '',
    price: toNum(product.price),
    mrp: toNum(product.mrp),
    in_stock: product.in_stock === false ? 'false' : 'true',
    description: product.description ?? '',
    image: product.image ?? '',
  });
}

// -------------------- Product generator --------------------
export function generateProductSeo(
  product: ProductLike,
  cfg: SeoConfig,
  categoryName?: string,
): GeneratedProductSeo {
  const storeName = cfg.business.name || LOCAL.storeName;
  const name = clean(product.name) || storeName;
  const brand = clean(product.brand);
  const category = clean(categoryName || product.category);
  const weight = clean(product.weight);
  const price = toNum(product.price);
  const area0 = cfg.business.areaServed[0] || LOCAL.areaServed[0];
  const area1 = cfg.business.areaServed[1] || LOCAL.areaServed[1];

  // Title: name + weight + price + store, clamped to 60 on a word boundary.
  const titleRaw =
    `${name}${weight ? ` ${weight}` : ''}${price > 0 ? ` - ₹${price}` : ''} | ${storeName}`;
  const title = clampWords(titleRaw, 60) || clampWords(`${name} | ${storeName}`, 60);

  // Descriptions from verified attributes only, ≤ 160 chars.
  const descEn = clampWords(
    `Buy ${name}${weight ? ` (${weight})` : ''}${brand ? ` by ${brand}` : ''}${
      category ? ` in ${category}` : ''
    } online from ${storeName}${
      price > 0 ? ` at ₹${price}` : ''
    }. Fast home delivery in ${area0}, ${area1}.`,
    160,
  );
  const descHi = clampWords(
    `${name}${weight ? ` (${weight})` : ''}${brand ? ` ${brand}` : ''} ${storeName} se ${area0}, ${area1} me online order karein${
      price > 0 ? ` — sirf ₹${price}` : ''
    }. Fast home delivery.`,
    160,
  );
  const description = cfg.defaultLang === 'en' ? descEn : descHi;

  // Keywords: primary (name/brand/category) + Hinglish seeds + areaServed, de-duped
  // first then capped to 500 on a comma boundary.
  const keywords = dedupeAndCapKeywords(
    [
      name,
      brand,
      category,
      ...LOCAL.keywordSeeds,
      ...cfg.business.areaServed,
      storeName,
    ],
    500,
  );

  const slug = slugify(name);

  // Alt text from real attributes only; empty when there is no image.
  const imageAlt = product.image
    ? clean(`${name}${brand ? ` ${brand}` : ''}${weight ? ` ${weight}` : ''} — ${storeName}`)
    : '';

  const canonical = `${SITE_ORIGIN}/product/${product.id != null ? String(product.id) : ''}`;

  return {
    title,
    description,
    descHi,
    descEn,
    keywords,
    slug,
    imageAlt,
    canonical,
    indexing: INDEXING_POLICY.product,
  };
}

// -------------------- Category generator --------------------
export function categorySourceHash(category: CategoryLike, memberProducts: ProductLike[]): string {
  const names = memberProducts
    .map((p) => clean(p.name))
    .filter(Boolean)
    .sort();
  return sourceHash({
    name: category.name,
    slug: category.slug ?? '',
    count: names.length,
    members: names.join('|'),
  });
}

export function generateCategorySeo(
  category: CategoryLike,
  memberProducts: ProductLike[],
  cfg: SeoConfig,
): GeneratedCategorySeo {
  const storeName = cfg.business.name || LOCAL.storeName;
  const name = clean(category.name) || storeName;
  const area0 = cfg.business.areaServed[0] || LOCAL.areaServed[0];
  const slug = slugify(category.slug || category.name);
  const members = memberProducts.map((p) => clean(p.name)).filter(Boolean);
  const count = members.length;

  const title = clampWords(`${name} online — ${storeName}`, 60);

  const descBase =
    cfg.defaultLang === 'en'
      ? `Shop ${name} online at ${storeName} in ${area0}. ${count} products with fast home delivery.`
      : `${name} online ${storeName} par ${area0} me — ${count} products, fast home delivery.`;
  const description = clampWords(descBase, 160);

  // Doorway/empty guard: no fabricated intro for an empty category.
  let intro = '';
  if (count > 0) {
    const sample = members.slice(0, 5).join(', ');
    intro =
      cfg.defaultLang === 'en'
        ? `${area0} me ${storeName} par ${count} ${name} products available${
            sample ? `, including ${sample}` : ''
          }.`
        : `${area0} me ${storeName} par ${count} ${name} products${
            sample ? ` jaise ${sample}` : ''
          } available hain.`;
  }

  const keywords = dedupeAndCapKeywords(
    [name, ...LOCAL.keywordSeeds, ...cfg.business.areaServed, storeName],
    500,
  );

  const imageAlt = category.image || category.og_image ? clean(`${name} — ${storeName}`) : '';
  const canonical = `${SITE_ORIGIN}/category/${slug}`;

  return {
    title,
    description,
    intro,
    keywords,
    slug,
    imageAlt,
    canonical,
    indexing: INDEXING_POLICY.category,
  };
}
