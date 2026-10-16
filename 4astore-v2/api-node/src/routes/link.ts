// Universal short-link redirect route — GET /api/link/:code .
//
// Reached two ways, BOTH land here (see deploy/4astore-og.conf /link rule):
//   - 4astore.com/link/<code>  → Apache reverse-proxies ALL user-agents to this
//     Node route (crawlers AND humans), so the one endpoint serves both.
//   - /api/link/<code>         → direct hit on the Node API.
//
// Branching:
//   - Social crawler UA → return the per-product OG HTML from the ONE source of
//     truth (services/ogShare.ts) so WhatsApp/Facebook/etc. render the product
//     image + title. OG logic is NEVER forked here.
//   - Human UA → a smart-redirect HTML page: on Android, attempt the installed
//     app via the autoVerify App Link / custom scheme and fall back to the Play
//     Store after ~1.2s; everywhere else go straight to the website target.
//
// A missing code returns a friendly 404 page (not JSON) because a human may be
// following a broken/expired link in a browser.

import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { SITE_ORIGIN } from '../seo/origin';
import { isCrawler } from '../middleware/ogCrawler';
import {
  buildProductShareHtml,
  buildPageShareHtml,
  buildCategoryShareHtml,
  escapeHtml,
  type OgResult,
} from '../services/ogShare';
// Smart-redirect HTML + Android constants live in a dependency-free module so a unit
// test can import the builder without pulling in prisma/Express. Behaviour unchanged.
import { smartRedirectHtml } from '../services/smartRedirect';

const router = Router();

/** Resolve the stored target into an absolute website URL (`/path` → origin+path). */
function absoluteTarget(targetUrl: string): string {
  const t = String(targetUrl || '/').trim();
  if (/^https?:\/\//i.test(t)) return t;
  return `${SITE_ORIGIN}${t.startsWith('/') ? t : `/${t}`}`;
}

/** Friendly 404 page for an unknown/expired code (human in a browser). */
function notFoundHtml(): string {
  const home = escapeHtml(`${SITE_ORIGIN}/`);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Link not found — 4A Store</title>
<meta name="robots" content="noindex,nofollow">
</head>
<body style="font-family:system-ui,Arial,sans-serif;text-align:center;padding:48px 16px;color:#222">
<h1 style="font-size:20px;margin:0 0 8px">This link isn't available</h1>
<p style="color:#666;margin:0 0 20px">It may have expired or never existed.</p>
<p><a href="${home}" style="color:#2563eb">Go to 4A Store →</a></p>
</body>
</html>`;
}

// GET /api/link/:code — resolve a short code and serve the right response.
router.get('/:code', async (req: Request, res: Response) => {
  const code = String(req.params.code || '');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // The response depends on the User-Agent (crawler OG vs human redirect), so a
  // cached crawler copy must never be served to a human and vice-versa.
  res.setHeader('Vary', 'User-Agent');

  if (!/^[A-Za-z0-9]{1,16}$/.test(code)) {
    return res.status(404).send(notFoundHtml());
  }

  const row = await prisma.shortLink
    .findUnique({
      where: { code },
      select: { target_url: true, type: true, product_id: true },
    })
    .catch(() => null);

  if (!row) {
    return res.status(404).send(notFoundHtml());
  }

  // Best-effort click counter — never block or fail the redirect on it.
  void prisma
    .$executeRawUnsafe('UPDATE short_links SET clicks = clicks + 1 WHERE code = ?', code)
    .catch(() => undefined);

  const target = absoluteTarget(row.target_url);
  const appPath =
    row.type === 'product' && row.product_id != null ? `/product/${Number(row.product_id)}` : null;

  // Crawler → OG HTML from the ONE source of truth (never fork OG logic).
  if (isCrawler(req.get('user-agent'))) {
    let og: OgResult | null = null;
    if (row.type === 'product' && row.product_id != null) {
      og = await buildProductShareHtml(String(Number(row.product_id)));
    } else if (row.type === 'page') {
      og = await buildPageShareHtml(row.target_url.replace(/^\/?page\//i, ''));
    } else if (row.type === 'category') {
      og = await buildCategoryShareHtml(row.target_url.replace(/^\/?category\//i, ''));
    }
    if (og && 'html' in og) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).send(og.html);
    }
    // No OG card available (custom link, or product/page/category not found) →
    // fall through to the smart-redirect page below.
  }

  return res.status(200).send(smartRedirectHtml(target, appPath));
});

export default router;
