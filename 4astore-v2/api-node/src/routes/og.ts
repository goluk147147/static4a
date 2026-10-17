// Open Graph share routes.
//
// These are hit by social crawlers (WhatsApp, Facebook, Twitter, Slack, ...) and emit a
// rich preview, while a human visitor is bounced on to the SPA. All og: URLs are ABSOLUTE
// https. The share-HTML builders live in services/ogShare.ts (the ONE source of truth) so
// these routes and the crawler middleware (middleware/ogCrawler.ts) can never fork.
//
//   GET /api/og/image/product/:id  → compressed branded share image (<=100 KB)
//   GET /api/og/product/:id        → share HTML with OG/Twitter meta + redirect to SPA
//   GET /api/og/page/:slug         → share HTML for a CMS page
//   GET /api/og/category/:slug     → share HTML for a category

import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { getOrRenderOg } from '../services/og';
import { SITE_ORIGIN, API_ORIGIN } from '../seo/origin';
import {
  buildProductShareHtml,
  buildPageShareHtml,
  buildCategoryShareHtml,
  loadSeoConfig,
  absoluteImageUrl,
  CATEGORY_SLUG_RE,
  PAGE_SLUG_RE,
} from '../services/ogShare';

const router = Router();

// Re-export the shared origins so existing importers of this module keep working.
export { SITE_ORIGIN, API_ORIGIN };

// GET /api/og/image/default — branded 4A Store logo card used as the global default
// OG image (cfg.defaultOgImage). Mirrors /image/page/:slug via getOrRenderOg with a
// null imageUrl so custom short links never show a blank/404 preview. Public crawler
// endpoint — no auth.
router.get('/image/default', async (_req: Request, res: Response) => {
  const cfg = await loadSeoConfig();
  const img = await getOrRenderOg('default', {
    title: cfg.business.name || '4A Store',
    subtitle: '4A Store',
    imageUrl: null, // logo card
  });
  res.setHeader('Content-Type', img.contentType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Content-Length', String(img.buffer.length));
  return res.end(img.buffer);
});

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
    variant: 'product-hero', // clean single-photo hero (Option A) for products only
  });

  res.setHeader('Content-Type', img.contentType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Content-Length', String(img.buffer.length));
  return res.end(img.buffer);
});

// GET /api/og/product/:id — share HTML for a product link.
router.get('/product/:id', async (req: Request, res: Response) => {
  const result = await buildProductShareHtml(req.params.id);
  if ('notFound' in result) return res.status(404).json({ success: false, message: 'Product not found' });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Vary', 'User-Agent');
  return res.send(result.html);
});

// GET /api/og/page/:slug — share HTML for a CMS page (branded logo image).
router.get('/page/:slug', async (req: Request, res: Response) => {
  const result = await buildPageShareHtml(req.params.slug);
  if ('notFound' in result) return res.status(404).json({ success: false, message: 'Page not found' });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Vary', 'User-Agent');
  return res.send(result.html);
});

// GET /api/og/image/page/:slug — branded logo card for a CMS page.
router.get('/image/page/:slug', async (req: Request, res: Response) => {
  const slug = String(req.params.slug || '').toLowerCase();
  if (!PAGE_SLUG_RE.test(slug)) return res.status(404).json({ success: false, message: 'Page not found' });
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

// GET /api/og/category/:slug — share HTML for a category link (effective SEO columns +
// breadcrumb + ItemList of member products). og:image points at the paired image route.
router.get('/category/:slug', async (req: Request, res: Response) => {
  const result = await buildCategoryShareHtml(req.params.slug);
  if ('notFound' in result) return res.status(404).json({ success: false, message: 'Category not found' });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Vary', 'User-Agent');
  return res.send(result.html);
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
