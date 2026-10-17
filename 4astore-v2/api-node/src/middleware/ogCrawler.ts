// Social-crawler OG routing — the UNIVERSAL, deploy-safe replacement for the fragile
// web/public/.htaccess crawler rewrite (which deploy.sh excludes and was reverted on the box).
//
// WHY A ROUTE UNDER /api:
//   The PUBLIC paths /product/:id , /page/:slug , /category/:slug , /products?category=… are
//   served by Apache (the SPA), not Node — Node only owns /api/*. The one place a crawler hit
//   on a public path can reach Node is the already-proxied, already-shipped /api namespace.
//   So the deploy-shipped Apache vhost include (deploy/4astore-og.conf) proxies ONLY known
//   crawler user-agents on those public paths to  /api/og-crawl?path=<original-uri> , and this
//   handler rebuilds the exact same OG HTML from services/ogShare.ts (the ONE source of truth).
//   Humans never match the crawler UA, so Apache leaves them on the SPA untouched.
//
// It also matches the bare public path directly (req.path), so if a future proxy forwards the
// original URI as-is it still works. Anything it can't resolve → the SPA origin (302), so a
// crawler following a stale/unknown link never sees a broken page.

import { Request, Response, NextFunction } from 'express';
import { SITE_ORIGIN } from '../seo/origin';
import {
  buildProductShareHtml,
  buildPageShareHtml,
  buildCategoryShareHtml,
  type OgResult,
} from '../services/ogShare';

// Known social / link-preview crawlers (case-insensitive). Kept in sync with the
// Apache vhort include so the two layers agree on "who is a crawler".
const CRAWLER_UA_RE =
  /(facebookexternalhit|facebot|whatsapp|twitterbot|slackbot|slack-imgproxy|linkedinbot|discordbot|telegrambot|pinterest|redditbot|googlebot|bingbot|embedly|quora link preview|vkshare|w3c_validator|skypeuripreview|whatsapp)/i;

export function isCrawler(userAgent: string | undefined): boolean {
  return !!userAgent && CRAWLER_UA_RE.test(userAgent);
}

// Normalise the public URL the crawler asked for into { kind, key } we can resolve.
// Accepts a full pathname (+ optional query string).
function parsePublicPath(rawPath: string, query: Record<string, unknown>): OgTarget | null {
  // Strip origin/host if a full URL was passed, then drop any trailing query for matching.
  let pathname = rawPath;
  let search = '';
  try {
    if (/^https?:\/\//i.test(rawPath)) {
      const u = new URL(rawPath);
      pathname = u.pathname;
      search = u.search;
    } else {
      const qIdx = rawPath.indexOf('?');
      if (qIdx !== -1) {
        pathname = rawPath.slice(0, qIdx);
        search = rawPath.slice(qIdx);
      }
    }
  } catch {
    /* fall through with raw */
  }
  pathname = pathname.replace(/\/+$/, '') || '/';

  // /product/:id
  const product = pathname.match(/^\/product\/([A-Za-z0-9]+)$/);
  if (product) return { kind: 'product', key: product[1] };

  // /page/:slug
  const page = pathname.match(/^\/page\/([a-z0-9-]+)$/i);
  if (page) return { kind: 'page', key: page[1] };

  // /category/:slug
  const category = pathname.match(/^\/category\/([a-z0-9-]+)$/i);
  if (category) return { kind: 'category', key: category[1] };

  // /products?category=slug  (category listing — share the category OG card)
  if (pathname === '/products') {
    const sp = new URLSearchParams(search);
    const cat = sp.get('category') || (typeof query.category === 'string' ? query.category : '');
    if (cat) return { kind: 'category', key: cat };
  }

  return null;
}

interface OgTarget {
  kind: 'product' | 'page' | 'category';
  key: string;
}

async function buildFor(target: OgTarget): Promise<OgResult> {
  switch (target.kind) {
    case 'product':
      return buildProductShareHtml(target.key);
    case 'page':
      return buildPageShareHtml(target.key);
    case 'category':
      return buildCategoryShareHtml(target.key);
  }
}

// Where humans/unknown links are sent (and where a crawler is bounced if we can't resolve).
function spaDestination(rawPath: string): string {
  const clean = rawPath && rawPath.startsWith('/') ? rawPath : '/';
  return `${SITE_ORIGIN}${clean}`;
}

// Express handler for GET /api/og-crawl — the Apache crawler-proxy target.
// The original public URI arrives as ?path=…; we also accept the X-Original-URI header.
export async function ogCrawlHandler(req: Request, res: Response): Promise<void> {
  const rawPath =
    (typeof req.query.path === 'string' && req.query.path) ||
    (req.get('X-Original-URI') as string) ||
    '/';

  const target = parsePublicPath(rawPath, req.query as Record<string, unknown>);
  if (!target) {
    res.redirect(302, spaDestination(rawPath));
    return;
  }

  const result = await buildFor(target);
  if ('notFound' in result) {
    // Unknown/stale id or slug → send the crawler on to the SPA rather than a 404 preview.
    res.redirect(302, spaDestination(rawPath));
    return;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Short cache + Vary so Cloudflare never serves this crawler copy to a human (and vice-versa).
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Vary', 'User-Agent');
  res.status(200).send(result.html);
}

// Clean path-segment crawler endpoints. These are the RELIABLE Apache proxy targets:
// the vhost include proxies  /product/:id → /api/og-crawl/product/:id  with a plain [P,L]
// (NO query string, NO env var, NO header trick) — exactly like the proven-working /link
// rule. A RewriteRule [P] whose target carries an embedded ?query= with slashes, OR an
// E=…/RequestHeader env-var dance, both produced an Apache 500; a clean path never does.
// The entity key arrives as a normal route param, so there is nothing for Apache to mangle.
function sendOgResult(res: Response, result: OgResult, spaPath: string): void {
  if ('notFound' in result) {
    res.redirect(302, spaDestination(spaPath));
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Vary', 'User-Agent');
  res.status(200).send(result.html);
}

export async function ogCrawlProductHandler(req: Request, res: Response): Promise<void> {
  const id = req.params.id;
  sendOgResult(res, await buildProductShareHtml(id), `/product/${id}`);
}

export async function ogCrawlPageHandler(req: Request, res: Response): Promise<void> {
  const slug = req.params.slug;
  sendOgResult(res, await buildPageShareHtml(slug), `/page/${slug}`);
}

export async function ogCrawlCategoryHandler(req: Request, res: Response): Promise<void> {
  const slug = req.params.slug;
  sendOgResult(res, await buildCategoryShareHtml(slug), `/category/${slug}`);
}

// Optional in-process guard: if a bare public path ever reaches Node directly AND the UA is a
// crawler, serve the OG HTML here too. Mounted before the SPA/API routes. For normal /api
// traffic and humans it is a transparent no-op (calls next()).
export async function ogCrawlerMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.method !== 'GET' || !isCrawler(req.get('user-agent'))) return next();

  const target = parsePublicPath(req.path, req.query as Record<string, unknown>);
  if (!target) return next();

  const result = await buildFor(target);
  if ('notFound' in result) return next();

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Vary', 'User-Agent');
  res.status(200).send(result.html);
}
