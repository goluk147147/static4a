import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { ok, fail } from '../utils/http';

// Public CMS pages (Privacy Policy, Terms, Help & Support, Delete Account, ...).
// Content is edited in Admin → Pages and rendered by the web app (sanitised with DOMPurify).
const router = Router();

// CMS content changes rarely (admin edits), so a short Cache-Control lets repeat
// app opens and React-Query refetches return 304 (Express computes a weak ETag on
// the JSON body) and skip the DB over the slow EC2 link. Mirrors catalog.ts; only
// HTTP headers are added — the JSON body stays byte-identical.
const PAGES_CACHE = 'public, max-age=300';

export interface PageRow {
  id: number; slug: string; title: string; meta_description: string | null; meta_keywords?: string | null; content: string;
  show_in_footer: number | boolean; published: number | boolean; sort_order: number; updated_at: Date;
}

export const toPage = (r: PageRow) => ({
  id: Number(r.id),
  slug: r.slug,
  title: r.title,
  metaDescription: r.meta_description || '',
  metaKeywords: r.meta_keywords || '',
  content: r.content || '',
  showInFooter: !!r.show_in_footer,
  published: !!r.published,
  sortOrder: Number(r.sort_order) || 0,
  updatedAt: new Date(r.updated_at).toISOString(),
});

// GET /api/pages — published pages for the footer (no content, keeps the payload small)
router.get('/', async (_req: Request, res: Response) => {
  const rows = await prisma.$queryRawUnsafe<PageRow[]>(
    // meta_keywords is intentionally NOT selected here: the footer list consumer does
    // not need it and the column may be absent before prisma/seo.sql is applied. The
    // per-page reads (GET /:slug, admin GET /pages) use SELECT * so they ride along.
    `SELECT id, slug, title, meta_description, '' AS content, show_in_footer, published, sort_order, updated_at
       FROM pages WHERE published = 1 ORDER BY sort_order ASC, id ASC`
  );
  res.setHeader('Cache-Control', PAGES_CACHE);
  return ok(res, { pages: rows.map(toPage) });
});

// GET /api/pages/:slug — one published page
router.get('/:slug', async (req: Request, res: Response) => {
  const slug = String(req.params.slug || '').toLowerCase();
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return fail(res, 'Page not found', 404);
  const rows = await prisma.$queryRawUnsafe<PageRow[]>('SELECT * FROM pages WHERE slug = ? AND published = 1', slug);
  if (!rows[0]) return fail(res, 'Page not found', 404);
  res.setHeader('Cache-Control', PAGES_CACHE);
  return ok(res, { page: toPage(rows[0]) });
});

export default router;
