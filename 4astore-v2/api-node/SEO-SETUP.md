# SEO Module Setup (4A Store v2)

This document covers the SEO module added across the Node API (`api-node`) and the
React SPA (`web`): what it delivers, the new endpoints and data fields, how to use
the admin SEO sub-tab, and the exact EC2 deploy runbook.

## What this delivers (and realistic expectations)

The SEO module gives the store a solid **technical SEO foundation**:

- Admin-managed SEO: global defaults + LocalBusiness info, per-product SEO, and
  per-CMS-page keywords, all editable from Admin → Settings → 🔎 SEO.
- Server-side crawler meta: the `/api/og/*` share routes now emit full
  `<title>`, meta description, meta keywords, `<link rel="canonical">`,
  `robots`, and `og:*` / `twitter:*` tags, plus schema.org JSON-LD
  (Product, BreadcrumbList, Organization, LocalBusiness / GroceryStore).
- A sitemap and robots file served from the API (`/api/sitemap.xml`,
  `/api/robots.txt`) and mapped to the site root via nginx.
- The SPA pages (Home, ProductDetails, CMS Page) emit the **same** per-page
  title/description/keywords/canonical + JSON-LD via `react-helmet-async`, so
  JS-capable crawlers see them too.

**Realistic-expectation note.** This module makes the site fully crawlable and
indexable with correct meta and structured data. It does **not** guarantee a #1
ranking or any specific position. Actual search ranking depends on content
quality, backlinks, site performance, competition, and time for search engines to
crawl and index. There is **no SSR** (server-side rendering of the full SPA) here —
only the crawler meta/share routes are server-rendered. No code can promise a top
ranking; this is the technical foundation that lets good content rank.

## New endpoints

All on the Node API (pm2 app `4astore-api`), mounted under `/api`:

- `GET /api/sitemap.xml` — XML `urlset`: homepage, non-hidden categories
  (`/category/:slug`), every product (`/product/:id` with `<lastmod>` from
  `updated_at`), and published CMS pages (`/page/:slug`). ~5-minute in-memory
  cache. **Not** gated by the `seoModule` flag.
- `GET /api/robots.txt` — `User-agent: *` / `Allow: /` / `Disallow: /admin` /
  `Disallow: /api/`, plus admin-editable `config.seo.robotsExtra` lines, plus
  `Sitemap: https://4astore.com/sitemap.xml`. **Not** gated by the flag.
- `GET /api/og/product/:id` and `GET /api/og/page/:slug` — existing share routes,
  now **extended** with meta keywords, robots, canonical and JSON-LD (Product +
  BreadcrumbList + Organization + LocalBusiness for products; BreadcrumbList +
  LocalBusiness for pages). The OG card image pipeline is unchanged.

Map the bare `/sitemap.xml` and `/robots.txt` paths to the API in nginx — see the
"Sitemap & robots mapping (SEO module)" section in `OG-SETUP.md`.

## SEO data fields

### `config.seo` (GET `/api/config` → `config.seo`)

`mergeSeoConfig()` always returns a complete object (business defaults derived from
the `settings` row), so `config.seo` is never null/partial even before `seo.sql`
runs:

```jsonc
{
  "titleTemplate": "%s | 4A Store",   // %s = page/product title
  "defaultDescription": "...",
  "defaultKeywords": "grocery delivery, kirana, ...",   // comma-separated
  "defaultOgImage": "https://4astore.com/assets/og-default.png",
  "robotsExtra": "",                   // newline-separated extra robots.txt lines
  "social": { "whatsapp": "", "instagram": "", "facebook": "" },
  "business": {
    "name": "4A Store",
    "address": "...",
    "phone": "...",
    "geo": { "lat": 0, "lng": 0 },
    "openingHours": "Mo-Su 07:00-21:00",
    "priceRange": "₹",
    "areaServed": ["Chandargarh", "Nabinagar", "Aurangabad", "Bihar"]
  }
}
```

### Per-product SEO (GET `/api/products` & `/api/products/:id`, ADD-only)

`seo_title`, `seo_description`, `seo_keywords`, `og_image` — all `string | null`
(null when unset). `deriveProductSeo()` fills in a sensible local title/description/
keywords when a field is unset. Admin writes send camelCase `seoTitle`,
`seoDescription`, `seoKeywords`, `ogImage` on `POST /api/admin/products`
(action `add`/`update`).

### Per-CMS-page SEO

`pages.meta_keywords` (VARCHAR(500) NULL) surfaces as `metaKeywords` on
`GET /api/pages/:slug` and the admin pages list. Admin writes send `metaKeywords`
(max 500) on `POST /api/admin/pages`.

### Admin write contract

`POST /api/admin/seo` (requires `requireAuth` + `requireStaff('settings')`). Body is
either `{ seo: <SeoConfig partial> }` or the SeoConfig fields at the top level.
Partial payloads are merged onto the settings-derived defaults. It persists
`JSON.stringify(seo)` to `config.seo` and returns the full merged `SeoConfig`.

## Admin usage — Settings → 🔎 SEO

The SEO sub-tab lives inside **Admin → Settings** (SUBS entry `{ key: 'seo' }`,
between "features" and "cache"). All copy is bilingual Hindi/English. It has:

1. **Global defaults + LocalBusiness** — edit `titleTemplate`,
   `defaultDescription`, `defaultKeywords`, `defaultOgImage`, `social`
   (whatsapp/instagram/facebook), and `business` (address, phone, geo lat/lng,
   openingHours, priceRange, areaServed). Saves via `POST /admin/seo` and
   invalidates the `['config']` query.
2. **Per-product SEO** — a searchable panel; saves via `POST /admin/products`
   action `update` with `seoTitle`/`seoDescription`/`seoKeywords`/`ogImage`.
3. **Per-CMS-page SEO** — edit `metaKeywords`; saves via `POST /admin/pages`
   action `update`.
4. **Previews** — a Google-snippet preview (title/description/url) and a
   social-card preview (`<img src="/api/og/image/product/:id">`).
5. **Sitemap link + robots editor** — a "view sitemap" link to
   `/api/sitemap.xml` and a `robotsExtra` editor (extra `robots.txt` lines).

Note: the `seoModule` feature flag only gates the extra schema.org JSON-LD
scripts. Basic SEO (title/description/keywords/canonical/OG) always renders, so SEO
never fully turns off.

## OG image reuse (≤ 100 KB)

The social-card preview and all share images reuse the **existing** OG image
pipeline (`services/og.ts` `getOrRenderOg`/`renderOgImage`) served at
`GET /api/og/image/product/:id` and `GET /api/og/image/page/:slug`. These produce a
1200×630 branded JPEG/WEBP compressed to **≤ 100 KB**, cached on disk under
`uploads/og/` and in memory. The SEO module did **not** add a second image
pipeline — when a product has `og_image` set, the share route prefers it over the
generated card; otherwise the existing generator is used unchanged.

## SUMMARY — added / edited files

### api-node (API)

- **NEW** `prisma/seo.sql` — guarded, re-runnable `ADD COLUMN` blocks:
  `products.seo_title`, `products.seo_description`, `products.seo_keywords`,
  `products.og_image`, `pages.meta_keywords`, `config.seo` (information_schema
  guard, matching `charges-settings.sql`).
- **EDITED** `prisma/schema.prisma` — added `seo_title`/`seo_description`/
  `seo_keywords`/`og_image` to `model Product`.
- **NEW** `src/seo/origin.ts` — shared `SITE_ORIGIN` / `API_ORIGIN`.
- **NEW** `src/seo/localSeo.ts` — `LOCAL` constants, `SeoConfig`/`SeoBusiness`/
  `SeoSocial` types, `defaultSeoConfig`, `mergeSeoConfig`, `deriveProductSeo`,
  `buildProductJsonLd`, `buildBreadcrumbJsonLd`, `buildOrganizationJsonLd`,
  `buildLocalBusinessJsonLd`.
- **NEW** `src/routes/seo.ts` — `GET /sitemap.xml` + `GET /robots.txt` router.
- **EDITED** `src/routes/og.ts` — `ShareMeta` widened (keywords/robots/jsonLd);
  `shareHtml()` renders them; product/page routes build JSON-LD.
- **EDITED** `src/routes/catalog.ts` — `GET /config` returns `config.seo`.
- **EDITED** `src/routes/admin.ts` — `productSchema` + `pageSchema` extended;
  `POST /seo` added.
- **EDITED** `src/routes/pages.ts` — `meta_keywords` → `metaKeywords` in `toPage()`.
- **EDITED** `src/utils/features.ts` — `seoModule` flag (default ON).
- **EDITED** `src/server.ts` — mount `seoRouter` at `/api`.
- **EDITED** `OG-SETUP.md` — appended sitemap/robots nginx mapping.
- **NEW** `SEO-SETUP.md` — this document.

### web (SPA)

- **NEW** `src/lib/seo.ts` — `applyTitleTemplate`, `buildCanonical`,
  `deriveProductSeo`, `productJsonLd`, `breadcrumbJsonLd`, `organizationJsonLd`,
  `localBusinessJsonLd`.
- **NEW** `src/components/Seo.tsx` — `<Seo>` wrapping `react-helmet-async`.
- **EDITED** `src/lib/features.ts` — `seoModule` flag + bilingual label.
- **EDITED** `src/types.ts` — Product SEO fields; `SeoConfig`/`SeoBusiness`/
  `SeoSocial`; `StoreConfig.seo?`.
- **EDITED** `src/lib/pages.ts` — `CmsPage.metaKeywords`; `savePage` passes it.
- **EDITED** `src/lib/admin.ts` — `saveSeo()` → `POST /admin/seo`.
- **EDITED** `src/pages/ProductDetails.tsx` — inline Helmet replaced by `<Seo>`.
- **EDITED** `src/pages/Page.tsx` — meta keywords + Breadcrumb/LocalBusiness JSON-LD.
- **EDITED** `src/pages/Home.tsx` — titleTemplate + Organization/LocalBusiness JSON-LD.
- **EDITED** `src/pages/admin/AdminSettings.tsx` — 🔎 SEO sub-tab + `SeoSettings`.
- **EDITED** `src/pages/admin/AdminPages.tsx` — `blank()` form seeds `metaKeywords`.

## EC2 deploy runbook (manual)

> **Do NOT `git commit` or `git push` as part of this deploy.** Deploy by uploading
> the built artifacts and running the steps below on the EC2 host. (The doc changes
> in this repo are committed locally only — never pushed.)

Live layout: Node API at `/var/www/html/api-node` (pm2 app `4astore-api`), SPA
served by nginx, MariaDB 10.4 database `four_a_store`.

1. **Upload the API source + migration + schema** to `/var/www/html/api-node`:
   - `src/**` (all new/edited files, incl. `src/seo/origin.ts`,
     `src/seo/localSeo.ts`, `src/routes/seo.ts`, and the edited routes/utils/server)
   - `prisma/seo.sql`
   - `prisma/schema.prisma`

2. **Upload the built SPA** `web/dist/**` to the nginx web root (the directory the
   `4astore.com` server block serves).

3. **Apply the guarded SQL** on the live DB (idempotent — ADD-only, re-runnable; a
   2nd run prints `already exists`):

   ```bash
   mysql -u <user> -p four_a_store < prisma/seo.sql
   ```

4. **Regenerate the Prisma client** so the typed client exposes the new product
   columns:

   ```bash
   cd /var/www/html/api-node
   npx prisma generate
   ```

5. **Add the nginx location blocks** for `/sitemap.xml` and `/robots.txt` (see
   `OG-SETUP.md` → "Sitemap & robots mapping"), then test + reload:

   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```

6. **Build** — the web SPA (`tsc -b && vite build`) is built before upload (step 2);
   build/type-check the API on the host:

   ```bash
   # web (if building on the host): cd .../web && npm run build
   cd /var/www/html/api-node && npx tsc --noEmit   # type-check the API build
   ```

7. **Restart the API** with a fresh env:

   ```bash
   pm2 restart 4astore-api --update-env
   ```

8. **Verify** after restart:

   ```bash
   curl -s https://4astore.com/sitemap.xml | head -n 5
   curl -s https://4astore.com/robots.txt
   curl -s -A "Googlebot" https://4astore.com/api/og/product/1 | grep -i -E 'canonical|application/ld\+json'
   ```
