// Open Graph share routes.
//
// These are hit by social crawlers (WhatsApp, Facebook, Twitter, Slack, ...) via an
// nginx user-agent rewrite (see OG-SETUP.md) so a shared link shows a rich preview,
// while a human visitor is bounced on to the SPA. All og: URLs are ABSOLUTE https.
//
//   GET /api/og/image/product/:id  → compressed branded share image (<=100 KB)
//   GET /api/og/product/:id        → share HTML with OG/Twitter meta + redirect to SPA
//   GET /api/og/page/:slug         → share HTML for a CMS page

import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { getOrRenderOg } from '../services/og';
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

const router = Router();

// Re-export the shared origins so existing importers of this module keep working.
export { SITE_ORIGIN, API_ORIGIN };

// Load the merged global SEO config once per crawler request (config.seo blob +
// settings-derived business defaults). Tolerant of the columns not existing yet.
async function loadSeoConfig(): Promise<SeoConfig> {
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

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Resolve a stored product/image path to an absolute URL the crawler can fetch.
function absoluteImageUrl(image?: string | null): string | null {
  if (!image) return null;
  if (/^https?:\/\//i.test(image)) return image;
  const clean = image.replace(/^\/+/, '');
  if (clean.startsWith('api/')) return `${SITE_ORIGIN}/${clean}`;
  return `${SITE_ORIGIN}/${clean}`;
}

interface ShareMeta {
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

function shareHtml(m: ShareMeta): string {
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

// GET /api/og/image/product/:id — generate/serve the compressed share image.
router.get('/image/product/:id', async (req: Request, res: Response) => {
  const product = await prisma.product
    .findUnique({ where: { id: BigInt(req.params.id) } })
    .catch(() => null);
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

  const price = Number(product.price) || 0;
  const cacheKey = `product-${product.id}-${new Date(product.updated_at).getTime()}`;
  const img = await getOrRenderOg(cacheKey, {
    title: product.name,
    subtitle: product.weight || '',
    imageUrl: absoluteImageUrl(product.image),
    price: price > 0 ? `₹${price}` : undefined,
  });

  res.setHeader('Content-Type', img.contentType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Content-Length', String(img.buffer.length));
  return res.end(img.buffer);
});

// GET /api/og/product/:id — share HTML for a product link.
router.get('/product/:id', async (req: Request, res: Response) => {
  const id = req.params.id;
  const product = await prisma.product.findUnique({ where: { id: BigInt(id) } }).catch(() => null);
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

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

  const html = shareHtml({
    title: seo.title,
    description: seo.description,
    keywords: seo.keywords,
    image: ogImage,
    url,
    redirect: url,
    jsonLd,
  });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.send(html);
});

// GET /api/og/page/:slug — share HTML for a CMS page (branded logo image).
router.get('/page/:slug', async (req: Request, res: Response) => {
  const slug = String(req.params.slug || '').toLowerCase();
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return res.status(404).json({ success: false, message: 'Page not found' });
  // SELECT * so meta_keywords rides along when present and is simply absent before
  // prisma/seo.sql is applied (ADD-only safe — no hard dependency on the new column).
  const rows = await prisma.$queryRawUnsafe<Array<{ title: string; meta_description: string | null; meta_keywords?: string | null }>>(
    'SELECT * FROM pages WHERE slug = ? AND published = 1',
    slug
  );
  const page = rows[0];
  if (!page) return res.status(404).json({ success: false, message: 'Page not found' });

  const cfg = await loadSeoConfig();
  const url = `${SITE_ORIGIN}/page/${slug}`;
  const jsonLd: object[] = [
    buildBreadcrumbJsonLd([
      { name: 'Home', url: `${SITE_ORIGIN}/` },
      { name: page.title, url },
    ]),
    buildLocalBusinessJsonLd(cfg),
  ];

  const html = shareHtml({
    title: `${page.title} — 4A Store`,
    description: page.meta_description || `${page.title} — 4A Store`,
    keywords: page.meta_keywords || cfg.defaultKeywords,
    image: `${API_ORIGIN}/og/image/page/${slug}`,
    url,
    redirect: url,
    jsonLd,
  });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.send(html);
});

// GET /api/og/image/page/:slug — branded logo card for a CMS page.
router.get('/image/page/:slug', async (req: Request, res: Response) => {
  const slug = String(req.params.slug || '').toLowerCase();
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return res.status(404).json({ success: false, message: 'Page not found' });
  const rows = await prisma.$queryRawUnsafe<Array<{ title: string }>>(
    'SELECT title FROM pages WHERE slug = ? AND published = 1',
    slug
  );
  const page = rows[0];
  if (!page) return res.status(404).json({ success: false, message: 'Page not found' });

  const img = await getOrRenderOg(`page-${slug}`, {
    title: page.title,
    subtitle: '4A Store',
    imageUrl: null, // logo card
  });
  res.setHeader('Content-Type', img.contentType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Content-Length', String(img.buffer.length));
  return res.end(img.buffer);
});

// Category slug bound matches categorySchema.slug (max 120) in routes/admin.ts — a
// legitimately stored long category slug (81–120 chars) must not 404.
const CATEGORY_SLUG_RE = /^[a-z0-9-]{1,120}$/;

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

// GET /api/og/category/:slug — share HTML for a category link (effective SEO columns +
// breadcrumb + ItemList of member products). og:image points at the paired image route.
router.get('/category/:slug', async (req: Request, res: Response) => {
  const slug = String(req.params.slug || '').toLowerCase();
  if (!CATEGORY_SLUG_RE.test(slug)) return res.status(404).json({ success: false, message: 'Category not found' });
  const rows = await prisma
    .$queryRawUnsafe<CategoryShareRow[]>('SELECT * FROM categories WHERE slug = ? AND hidden = 0 LIMIT 1', slug)
    .catch(() => [] as CategoryShareRow[]);
  const category = rows[0];
  if (!category) return res.status(404).json({ success: false, message: 'Category not found' });

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

  const html = shareHtml({
    title,
    description,
    keywords: category.seo_keywords || cfg.defaultKeywords,
    image: `${API_ORIGIN}/og/image/category/${slug}`,
    url,
    redirect: url,
    jsonLd,
  });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.send(html);
});

// GET /api/og/image/category/:slug — share card: the category og_image override if set,
// else a logo-or-sample-product card (mirrors /image/page/:slug via getOrRenderOg).
router.get('/image/category/:slug', async (req: Request, res: Response) => {
  const slug = String(req.params.slug || '').toLowerCase();
  if (!CATEGORY_SLUG_RE.test(slug)) return res.status(404).json({ success: false, message: 'Category not found' });
  const rows = await prisma
    .$queryRawUnsafe<Array<{ name: string; og_image: string | null; image: string | null }>>(
      'SELECT name, og_image, image FROM categories WHERE slug = ? AND hidden = 0 LIMIT 1',
      slug,
    )
    .catch(() => [] as Array<{ name: string; og_image: string | null; image: string | null }>);
  const category = rows[0];
  if (!category) return res.status(404).json({ success: false, message: 'Category not found' });

  // Prefer the admin override image, else a category image, else the logo card.
  const cardImage = absoluteImageUrl(category.og_image || category.image);
  const img = await getOrRenderOg(`category-${slug}`, {
    title: category.name,
    subtitle: '4A Store',
    imageUrl: cardImage,
  });
  res.setHeader('Content-Type', img.contentType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Content-Length', String(img.buffer.length));
  return res.end(img.buffer);
});

export default router;
