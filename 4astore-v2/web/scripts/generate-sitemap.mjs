// Build-time sitemap generator for the 4A Store web SPA.
//
// Writes public/sitemap.xml with the static core URLs PLUS one URL per live product
// (/product/:id) and per CMS page (/page/:slug), fetched from the public API. The API base
// defaults to the production origin and can be overridden with SITEMAP_API_BASE. If the API is
// unreachable at build time, the static core URLs are still written (never fail the build).
//
// Usage:  node scripts/generate-sitemap.mjs
// Wired into `npm run build` so every deploy ships a fresh sitemap.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tls from 'node:tls';

// Corporate TLS inspection (e.g. Zscaler) re-signs HTTPS with a root Windows trusts but Node's
// bundled CA list doesn't, so fetch() fails UNABLE_TO_GET_ISSUER_CERT_LOCALLY on such machines.
// Add the OS trust store (keeps verification ON). No-op on Node < 22.15. Mirrors api-node/systemCa.
try {
  if (typeof tls.getCACertificates === 'function' && typeof tls.setDefaultCACertificates === 'function') {
    tls.setDefaultCACertificates([...new Set([...tls.getCACertificates('default'), ...tls.getCACertificates('system')])]);
  }
} catch {
  /* ignore — build servers have a normal CA chain */
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE = (process.env.SITEMAP_SITE_URL || 'https://4astore.com').replace(/\/$/, '');
const API = (process.env.SITEMAP_API_BASE || 'https://4astore.com/api').replace(/\/$/, '');
const OUT = resolve(__dirname, '..', 'public', 'sitemap.xml');

const STATIC = [
  { loc: '/', changefreq: 'daily', priority: '1.0' },
  { loc: '/products', changefreq: 'daily', priority: '0.9' },
  { loc: '/page/privacy-policy', changefreq: 'yearly', priority: '0.3' },
  { loc: '/page/terms', changefreq: 'yearly', priority: '0.3' },
  { loc: '/page/help-support', changefreq: 'monthly', priority: '0.5' },
  { loc: '/page/account-deletion', changefreq: 'yearly', priority: '0.3' },
];

async function getJson(path) {
  try {
    const ctrl = AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined;
    const res = await fetch(`${API}${path}`, { signal: ctrl });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function xmlEscape(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

function urlTag({ loc, changefreq, priority, lastmod }) {
  const abs = loc.startsWith('http') ? loc : `${SITE}${loc}`;
  return `  <url><loc>${xmlEscape(abs)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}<changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
}

async function main() {
  const urls = [...STATIC];

  const products = await getJson('/products');
  const list = Array.isArray(products?.products) ? products.products : [];
  for (const p of list) {
    if (p?.id == null) continue;
    urls.push({ loc: `/product/${p.id}`, changefreq: 'weekly', priority: '0.7' });
  }

  const pages = await getJson('/pages');
  const pageList = Array.isArray(pages?.pages) ? pages.pages : [];
  for (const pg of pageList) {
    const slug = pg?.slug;
    if (!slug) continue;
    if (STATIC.some((s) => s.loc === `/page/${slug}`)) continue;
    urls.push({ loc: `/page/${slug}`, changefreq: 'monthly', priority: '0.4' });
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(urlTag).join('\n')}\n</urlset>\n`;
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, xml, 'utf8');
  console.log(`[sitemap] wrote ${urls.length} URLs to public/sitemap.xml (products=${list.length}, pages=${pageList.length})`);
}

main().catch((e) => {
  console.warn('[sitemap] generation failed, keeping existing sitemap.xml:', e?.message || e);
});
