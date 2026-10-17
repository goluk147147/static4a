// Shared Open Graph share-HTML builders — the ONE source of truth for the
// per-product / per-page / per-category crawler preview HTML.
//
// Both of these consume this module (so the OG logic is never forked):
//   - routes/og.ts        → GET /api/og/product/:id , /api/og/page/:slug , /api/og/category/:slug
//   - middleware/ogCrawler.ts → crawler hits on the PUBLIC paths /product/:id , /page/:slug ,
//                                /category/:slug , /products?category=… (via the deploy-shipped
//                                Apache vhost include that proxies crawler requests to Node)
//
// All og: URLs are ABSOLUTE https. Humans are redirected on to the SPA; crawlers read the meta.

import { prisma } from '../db';
import { SITE_ORIGIN, API_ORIGIN } from '../seo/origin';
import {
  mergeSeoConfig,
  deriveProductSeo,
  buildProductJsonLd,
  buildBreadcrumbJsonLd,
  buildOrganizationJsonLd,
  buildLocalBusinessJsonLd,
  buildItemListJsonLd,
  type SeoConfig,
  type SettingsRow,
} from '../seo/localSeo';

// Category slug bound matches categorySchema.slug (max 120) in routes/admin.ts — a
// legitimately stored long category slug (81–120 chars) must not 404.
export const CATEGORY_SLUG_RE = /^[a-z0-9-]{1,120}$/;
export const PAGE_SLUG_RE = /^[a-z0-9-]{1,80}$/;

// Load the merged global SEO config (config.seo blob + settings-derived business
// defaults). Tolerant of the columns not existing yet.
export async function loadSeoConfig(): Promise<SeoConfig> {
  const parse = (v: unknown) => {
    if (typeof v !== 'string') return v ?? null;
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  };
  const [cfgRows, setRows] = await Promise.all([
    prisma
      .$queryRawUnsafe<Array<{ seo?: unknown }>>('SELECT seo FROM config WHERE id = 1')
      .catch(() => [] as Array<{ seo?: unknown }>),
    prisma
      .$queryRawUnsafe<SettingsRow[]>('SELECT * FROM settings WHERE id = 1')
      .catch(() => [] as SettingsRow[]),
  ]);
  return mergeSeoConfig(parse(cfgRows[0]?.seo), setRows[0] || null);
}

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Resolve a stored product/image path to an absolute URL the crawler can fetch.
export function absoluteImageUrl(image?: string | null): string | null {
  if (!image) return null;
  if (/^https?:\/\//i.test(image)) return image;
  const clean = image.replace(/^\/+/, '');
  return `${SITE_ORIGIN}/${clean}`;
}

export interface ShareMeta {
  title: string;
  description: string;
  image: string; // absolute https
  url: string; // absolute https — canonical SPA destination
  redirect: string; // where humans are sent
  keywords?: string; // comma-separated meta keywords
  robots?: string; // defaults to 'index,follow'
  jsonLd?: object[]; // schema.org blocks (one <script type=application/ld+json> each)
}

// JSON-LD is embedded in a <script> element, so </script> and HTML-active chars in
// string values must be neutralised to keep the document well-formed and XSS-safe.
function safeJsonLd(obj: object): string {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

export function shareHtml(m: ShareMeta): string {
  const t = escapeHtml(m.title);
  const d = escapeHtml(m.description);
  const img = escapeHtml(m.image);
  const url = escapeHtml(m.url);
  const redirect = escapeHtml(m.redirect);
  const robots = escapeHtml(m.robots || 'index,follow');
  const keywordsTag = m.keywords ? `\n<meta name="keywords" content="${escapeHtml(m.keywords)}">` : '';
  const jsonLdTags = (m.jsonLd || [])
    .map((o) => `\n<script type="application/ld+json">${safeJsonLd(o)}</script>`)
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t}</title>
<meta name="description" content="${d}">${keywordsTag}
<meta name="robots" content="${robots}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="4A Store">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:image" content="${img}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${img}">
<link rel="canonical" href="${url}">${jsonLdTags}
<meta http-equiv="refresh" content="0; url=${redirect}">
<script>location.replace(${JSON.stringify(m.redirect)});</script>
</head>
<body>
<p>Redirecting to <a href="${redirect}">4A Store</a>…</p>
</body>
</html>`;
}

// Result of a share-HTML build: either the HTML, or notFound so the caller can
// decide the status (404 JSON from the API route, or SPA fallthrough from the crawler
// middleware so a bad link never shows a broken crawler page).
export type OgResult = { html: string } | { notFound: true };

// -------------------- Per-entity builders (ONE source of truth) --------------------

export interface CustomShareArgs {
  code: string;
  /** Where humans are redirected (already absolute). */
  target: string;
  /** Admin-set OG image for the custom link (empty/null → 4A Store default card). */
  ogImage?: string | null;
  /** Admin-set OG title for the custom link (empty/null → brand default). */
  ogTitle?: string | null;
  cfg: SeoConfig;
}

/**
 * Build the crawler OG card for a CUSTOM (non-product/page/category) short link.
 * Pure + DB-free (takes the already-loaded `cfg`) so it is unit-testable in the
 * house style. The image rule guarantees a preview is NEVER blank:
 *   - `absoluteImageUrl(ogImage)` is null when the admin left the image empty,
 *     so it falls back to `cfg.defaultOgImage` (the 4A Store default logo card).
 * Title falls back to the store name, then the brand wordmark literal.
 */
export function buildCustomShareHtml(args: CustomShareArgs): string {
  const { code, target, ogImage, ogTitle, cfg } = args;
  const title = (ogTitle && ogTitle.trim()) || cfg.business.name || '4A Store — Grocery in Minutes';
  // Trim so a whitespace-only value is treated as empty (→ default card), not a
  // broken "SITE_ORIGIN/   " URL. The service validator already stores null for
  // empty, but keep the helper robust for any direct caller.
  const img = ogImage && ogImage.trim() ? ogImage.trim() : null;
  return shareHtml({
    title,
    description: cfg.defaultDescription,
    image: absoluteImageUrl(img) || cfg.defaultOgImage,
    url: `${SITE_ORIGIN}/link/${code}`,
    redirect: target,
    robots: 'noindex,nofollow',
  });
}

export async function buildProductShareHtml(id: string): Promise<OgResult> {
  if (!/^\d+$/.test(id)) return { notFound: true };
  const product = await prisma.product.findUnique({ where: { id: BigInt(id) } }).catch(() => null);
  if (!product) return { notFound: true };

  const cfg = await loadSeoConfig();
  const url = `${SITE_ORIGIN}/product/${id}`;
  const seo = deriveProductSeo(product);
  // Prefer a product-specific og_image when the admin set one, else the generated card.
  const ogImage = absoluteImageUrl(product.og_image) || `${API_ORIGIN}/og/image/product/${id}`;
  const jsonLd: object[] = [
    buildProductJsonLd(product, cfg, url, absoluteImageUrl(product.og_image || product.image) || ogImage),
    buildBreadcrumbJsonLd([
      { name: 'Home', url: `${SITE_ORIGIN}/` },
      { name: product.name, url },
    ]),
    buildOrganizationJsonLd(cfg),
    buildLocalBusinessJsonLd(cfg),
  ];

  return {
    html: shareHtml({
      title: seo.title,
      description: seo.description,
      keywords: seo.keywords,
      image: ogImage,
      url,
      redirect: url,
      jsonLd,
    }),
  };
}

export async function buildPageShareHtml(slugRaw: string): Promise<OgResult> {
  const slug = String(slugRaw || '').toLowerCase();
  if (!PAGE_SLUG_RE.test(slug)) return { notFound: true };
  // SELECT * so meta_keywords rides along when present and is simply absent before
  // prisma/seo.sql is applied (ADD-only safe — no hard dependency on the new column).
  const rows = await prisma
    .$queryRawUnsafe<Array<{ title: string; meta_description: string | null; meta_keywords?: string | null }>>(
      'SELECT * FROM pages WHERE slug = ? AND published = 1',
      slug,
    )
    .catch(() => [] as Array<{ title: string; meta_description: string | null; meta_keywords?: string | null }>);
  const page = rows[0];
  if (!page) return { notFound: true };

  const cfg = await loadSeoConfig();
  const url = `${SITE_ORIGIN}/page/${slug}`;
  const jsonLd: object[] = [
    buildBreadcrumbJsonLd([
      { name: 'Home', url: `${SITE_ORIGIN}/` },
      { name: page.title, url },
    ]),
    buildLocalBusinessJsonLd(cfg),
  ];

  return {
    html: shareHtml({
      title: `${page.title} — 4A Store`,
      description: page.meta_description || `${page.title} — 4A Store`,
      keywords: page.meta_keywords || cfg.defaultKeywords,
      image: `${API_ORIGIN}/og/image/page/${slug}`,
      url,
      redirect: url,
      jsonLd,
    }),
  };
}

interface CategoryShareRow {
  id: bigint | number;
  name: string;
  slug: string;
  og_image: string | null;
  image: string | null;
  seo_title: string | null;
  seo_description: string | null;
  seo_keywords: string | null;
}

export async function buildCategoryShareHtml(slugRaw: string): Promise<OgResult> {
  const slug = String(slugRaw || '').toLowerCase();
  if (!CATEGORY_SLUG_RE.test(slug)) return { notFound: true };
  const rows = await prisma
    .$queryRawUnsafe<CategoryShareRow[]>('SELECT * FROM categories WHERE slug = ? AND hidden = 0 LIMIT 1', slug)
    .catch(() => [] as CategoryShareRow[]);
  const category = rows[0];
  if (!category) return { notFound: true };

  const cfg = await loadSeoConfig();
  const url = `${SITE_ORIGIN}/category/${slug}`;
  const members = await prisma
    .$queryRawUnsafe<Array<{ id: bigint | number; name: string }>>(
      'SELECT id, name FROM products WHERE category = ? ORDER BY name ASC LIMIT 50',
      slug,
    )
    .catch(() => [] as Array<{ id: bigint | number; name: string }>);

  const title = category.seo_title || `${category.name} online — ${cfg.business.name}`;
  const description = category.seo_description || `${category.name} online ${cfg.business.name} par — fast home delivery.`;
  const jsonLd: object[] = [
    buildBreadcrumbJsonLd([
      { name: 'Home', url: `${SITE_ORIGIN}/` },
      { name: category.name, url },
    ]),
    buildItemListJsonLd(members.map((m) => ({ name: m.name, url: `${SITE_ORIGIN}/product/${Number(m.id)}` }))),
    buildLocalBusinessJsonLd(cfg),
  ];

  return {
    html: shareHtml({
      title,
      description,
      keywords: category.seo_keywords || cfg.defaultKeywords,
      image: `${API_ORIGIN}/og/image/category/${slug}`,
      url,
      redirect: url,
      jsonLd,
    }),
  };
}
