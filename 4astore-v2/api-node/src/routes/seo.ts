// Crawler infrastructure routes: sitemap.xml + robots.txt.
//
//   GET /api/sitemap.xml  → XML urlset (home + products + categories + published CMS pages)
//   GET /api/robots.txt   → allow-all + Sitemap: line + admin-editable extra lines
//
// These are hit directly by search-engine crawlers (an nginx map rewrites /sitemap.xml
// and /robots.txt to these — see OG-SETUP.md), so they must NEVER be gated by the
// seoModule feature flag. All URLs are absolute https via the shared SITE_ORIGIN.

import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { SITE_ORIGIN } from '../seo/origin';
import { mergeSeoConfig, type SettingsRow } from '../seo/localSeo';

const router = Router();

// Short in-memory TTL cache — crawlers can hammer these and the content changes slowly.
const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { body: string; at: number }>();
async function cached(key: string, load: () => Promise<string>): Promise<string> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.body;
  const body = await load();
  cache.set(key, { body, at: now });
  return body;
}

function xmlEscape(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function urlEntry(loc: string, lastmod?: Date | null): string {
  const lm = lastmod ? `\n    <lastmod>${new Date(lastmod).toISOString()}</lastmod>` : '';
  return `  <url>\n    <loc>${xmlEscape(loc)}</loc>${lm}\n  </url>`;
}

// GET /api/sitemap.xml
router.get('/sitemap.xml', async (_req: Request, res: Response) => {
  const xml = await cached('sitemap', async () => {
    const [products, categories, pages] = await Promise.all([
      prisma.product.findMany({ select: { id: true, updated_at: true }, orderBy: { id: 'asc' } }).catch(() => []),
      prisma.category.findMany({ where: { hidden: false }, select: { slug: true }, orderBy: { sort_order: 'asc' } }).catch(() => []),
      prisma
        .$queryRawUnsafe<Array<{ slug: string; updated_at: Date }>>(
          'SELECT slug, updated_at FROM pages WHERE published = 1 ORDER BY sort_order ASC, id ASC'
        )
        .catch(() => [] as Array<{ slug: string; updated_at: Date }>),
    ]);

    const entries: string[] = [urlEntry(`${SITE_ORIGIN}/`)];
    for (const c of categories) entries.push(urlEntry(`${SITE_ORIGIN}/category/${c.slug}`));
    for (const p of products) entries.push(urlEntry(`${SITE_ORIGIN}/product/${Number(p.id)}`, p.updated_at));
    for (const pg of pages) entries.push(urlEntry(`${SITE_ORIGIN}/page/${pg.slug}`, pg.updated_at));

    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;
  });
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.send(xml);
});

// GET /api/robots.txt
router.get('/robots.txt', async (_req: Request, res: Response) => {
  const body = await cached('robots', async () => {
    const parse = (v: unknown) => {
      if (typeof v !== 'string') return v ?? null;
      try {
        return JSON.parse(v);
      } catch {
        return null;
      }
    };
    const [cfgRows, setRows] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ seo?: unknown }>>('SELECT seo FROM config WHERE id = 1').catch(() => []),
      prisma.$queryRawUnsafe<SettingsRow[]>('SELECT * FROM settings WHERE id = 1').catch(() => [] as SettingsRow[]),
    ]);
    const cfg = mergeSeoConfig(parse(cfgRows[0]?.seo), setRows[0] || null);
    const lines = ['User-agent: *', 'Allow: /', 'Disallow: /admin', 'Disallow: /api/'];
    const extra = (cfg.robotsExtra || '').split('\n').map((l) => l.trim()).filter(Boolean);
    lines.push(...extra);
    lines.push(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
    return `${lines.join('\n')}\n`;
  });
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.send(body);
});

export default router;
