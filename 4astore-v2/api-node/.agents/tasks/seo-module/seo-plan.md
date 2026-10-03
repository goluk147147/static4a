# SEO Module — Implementation Plan (approach A: admin-managed SEO + server-side meta/sitemap for crawlers; NO full SSR)

Grounded in the actual worktree code read during exploration (see `seo-reuse-notes.md`).
All paths absolute. API dir = `c:\xampp\htdocs\static4a\.worktrees\og-eye-bulkpush-flags-cms-polish\4astore-v2\api-node`.
Web dir = `c:\xampp\htdocs\static4a\.worktrees\og-eye-bulkpush-flags-cms-polish\4astore-v2\web`.

Design decisions (made here, grounded in code):
- SEO columns on `products` are added via a NEW guarded SQL file (not a Prisma migration) and surfaced ADD-only. Rationale: `charges-settings.sql`/`features-column.sql` already establish the information_schema guard pattern for MariaDB 10.4, and the user applies SQL manually. Product reads/writes DO go through Prisma (`prisma.product`), so the new columns are also added to `schema.prisma` so the typed client returns them; the SQL file is the source of truth the user runs, `schema.prisma` only mirrors it (consistent with the existing "Mirrors db/schema.sql" convention). To stay ADD-only and null-when-unset, columns are nullable with no default.
- Global SEO + LocalBusiness lives in a NEW guarded `config.seo LONGTEXT NULL` column, parsed with the same `parse()` helper and surfaced under `config.seo` in `GET /api/config`, written by a new `POST /api/admin/seo` under `requireStaff('settings')`. Rationale: mirrors `footer`/`banners` JSON-column pattern exactly.
- CMS page keywords: add a guarded `pages.meta_keywords VARCHAR(500) NULL` column (cheap, same pattern) and surface it through `toPage` + the admin pages save. Title/metaDescription already exist.
- Sitemap/robots/crawler-meta live in a NEW `seoRouter` mounted at `/api` so routes resolve as `/api/sitemap.xml` and `/api/robots.txt` (brief/verification require those exact paths; nginx maps bare `/sitemap.xml` + `/robots.txt` → API). Crawler product/page meta is produced by EXTENDING the existing `shareHtml()` in `src/routes/og.ts` to accept richer meta (keywords, robots, JSON-LD blocks) — not a second generator.
- A new feature flag `seoModule` is added in BOTH `features.ts` files (absent = ON) so the module can be toggled; it gates the SPA JSON-LD/extra tags and the admin sub-tab visibility but NEVER the sitemap/robots/crawler routes (those must always serve for crawlers).
- OG image reuse: sitemap/crawler meta point `og:image` at the existing `/api/og/image/product/:id` and `/api/og/image/page/:slug` routes. No new canvas pipeline.

Local-SEO constants (single shared module `src/seo/localSeo.ts`): store name "4A Store", areaServed ["Chandargarh","Nabinagar","Aurangabad","Bihar"], PIN "824301", keyword seeds ["grocery delivery","kirana","online grocery","home delivery","sabzi","daily essentials"]. Defaults derive from `settings` (store_address/lat/lng/phone) + `config.seo.business` overrides.

---

- [ ] 1. Create the guarded idempotent SQL file for all SEO columns.
      Create `c:\...\api-node\prisma\seo.sql` with the header comment block (run line `mysql -u <user> -p four_a_store < prisma/seo.sql`, "Run ONCE on the live DB (EC2). ADD COLUMN only — no destructive ops."), then one information_schema-guarded `PREPARE/EXECUTE/DEALLOCATE` block per column, exactly matching `charges-settings.sql` style:
      - `products.seo_title     VARCHAR(255) NULL`
      - `products.seo_description TEXT NULL`
      - `products.seo_keywords  VARCHAR(500) NULL`
      - `products.og_image      VARCHAR(500) NULL`
      - `pages.meta_keywords    VARCHAR(500) NULL`
      - `config.seo             LONGTEXT NULL`
      Each block: `SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '<t>' AND COLUMN_NAME = '<col>'); SET @sql := IF(@c = 0, 'ALTER TABLE <t> ADD COLUMN <col> <TYPE> NULL', 'SELECT ''<col> already exists'' AS note'); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;`
      Files: `c:\...\api-node\prisma\seo.sql`
      Verify: file parses as SQL; manually eyeball that every block is nullable/ADD-only and the guard matches `charges-settings.sql`. (DB apply is manual by user; re-run must print "already exists".)

- [ ] 2. Mirror the new product SEO columns in Prisma schema so the typed client returns them.
      In `schema.prisma` model `Product`, add nullable fields after `features`: `seo_title String? @db.VarChar(255)`, `seo_description String? @db.Text`, `seo_keywords String? @db.VarChar(500)`, `og_image String? @db.VarChar(500)`. Then run `npx prisma generate`.
      Files: `c:\...\api-node\prisma\schema.prisma`
      Verify: `npx prisma validate` clean; `npx prisma generate` succeeds; `npx tsc --noEmit` still clean.

- [ ] 3. Add the `seoModule` feature flag in BOTH flag files (absent = ON).
      API `src/utils/features.ts`: append `'seoModule'` to the `FeatureKey` union + `FEATURE_KEYS` array, and add `seoModule: true` to `DEFAULT_FEATURES`. Web `src/lib/features.ts`: append `'seoModule'` to `FeatureKey` + `FEATURE_KEYS`, add a bilingual entry to `FEATURE_LABELS` (e.g. `seoModule: 'SEO module / एसईओ मॉड्यूल'`).
      Files: `c:\...\api-node\src\utils\features.ts`, `c:\...\web\src\lib\features.ts`
      Verify: `npx tsc --noEmit` clean in both api-node and web (the config GET + /features POST iterate FEATURE_KEYS/mergeFeatures, so no other wiring needed).

- [ ] 4. Create the shared local-SEO + derivation helper module (API).
      Create `src/seo/localSeo.ts` exporting: `LOCAL` constants (storeName, areaServed[], pin, keywordSeeds[]); `interface SeoConfig` (titleTemplate, defaultDescription, defaultKeywords, defaultOgImage, social{whatsapp,instagram,facebook}, business{name,address,phone,geo{lat,lng},openingHours,priceRange,areaServed[]}); `defaultSeoConfig(settingsRow): SeoConfig` (sensible default object built from the `settings` row — store_address/phone/lat/lng — when `config.seo` is absent); `mergeSeoConfig(raw, settingsRow): SeoConfig`; `deriveProductSeo(product): {title,description,keywords}` (title `${name} - ₹${price} | 4A Store`, description = first ~160 chars of stripped `description` or a generated local line, keywords from name/brand/category + keywordSeeds + areaServed); `buildProductJsonLd(product, cfg, url)`, `buildLocalBusinessJsonLd(cfg)`, `buildOrganizationJsonLd(cfg)`, `buildBreadcrumbJsonLd(items)`.
      Files: `c:\...\api-node\src\seo\localSeo.ts`
      Verify: `npx tsc --noEmit` clean; functions are pure/exported with explicit types.

- [ ] 5. Surface product SEO fields ADD-only in catalog reads, null-when-unset.
      In `src/routes/catalog.ts`, `GET /products` and `GET /products/:id`: the Prisma client already returns the new nullable columns after step 2, so no shape change is needed to pass them through — but ADD a derived-defaults convenience so clients get usable values. Keep raw columns as-is (null when unset) AND add nothing that removes/renames existing keys. Decision: pass the Prisma product object straight through (new keys `seo_title`/`seo_description`/`seo_keywords`/`og_image` are null when unset — backward-compatible ADD). Derivation stays server-side in `og.ts`/`seoRouter` to avoid changing the public list payload semantics.
      Files: `c:\...\api-node\src\routes\catalog.ts` (verify only; no key removals)
      Verify: `GET /api/products` JSON includes `seo_title`,`seo_description`,`seo_keywords`,`og_image` as `null` when unset (after seo.sql applied) and omitting them before SQL applied still works; `npx tsc --noEmit` clean. (`null` keys appear only once the columns exist; the response never loses existing keys.)

- [ ] 6. Surface global SEO under `config.seo` in `GET /api/config` (ADD only).
      In `src/routes/catalog.ts` `GET /config`, inside the `cached('config', ...)` loader, add `seo: mergeSeoConfig(parse(row.seo), <settings row>)`. Fetch the settings row in the same loader (one extra `SELECT * FROM settings WHERE id = 1`) so business defaults derive from it; when `row.seo` is absent/null, `mergeSeoConfig` returns `defaultSeoConfig(settingsRow)`. Do not change any existing config key.
      Files: `c:\...\api-node\src\routes\catalog.ts`
      Verify: `GET /api/config` returns `config.seo` with a sensible default object when the column is absent; all existing config keys unchanged; `npx tsc --noEmit` clean.

- [ ] 7. Add per-product SEO + per-page keywords to the admin write paths (ADD only, `requireStaff`).
      In `src/routes/admin.ts`: extend `productSchema` with optional `seoTitle`/`seoDescription`/`seoKeywords`/`ogImage` (strings, optional) and map them into the `data` object (`seo_title: p.seoTitle || null`, etc.) in the add/update branch. Extend `pageSchema` with optional `metaKeywords` (string ≤500) and add it to the INSERT/UPDATE column list + `values` array; extend `PageRow`/`toPage` in `src/routes/pages.ts` to include `meta_keywords`→`metaKeywords`. Add the global-SEO writer: `router.post('/seo', requireAuth, requireStaff('settings'), ...)` validating a Zod `seoSchema` (mirrors `SeoConfig`) then `UPDATE config SET seo = ? WHERE id = 1` with `JSON.stringify`.
      Files: `c:\...\api-node\src\routes\admin.ts`, `c:\...\api-node\src\routes\pages.ts`
      Verify: `npx tsc --noEmit` clean; saving a product with SEO fields persists them; `POST /api/admin/seo` round-trips `config.seo` and is rejected without the `settings` permission.

- [ ] 8. Extend `shareHtml()` in `og.ts` to emit full crawler SEO meta + JSON-LD (do not duplicate).
      In `src/routes/og.ts`, widen `interface ShareMeta` with optional `keywords?: string`, `robots?: string`, `jsonLd?: object[]`, `breadcrumb?: object`. Update `shareHtml()` to render `<meta name="keywords">` (when present), `<meta name="robots">` (default `index,follow`), `<link rel="canonical">` (already present), and one `<script type="application/ld+json">` per `jsonLd` entry. In `GET /product/:id`, build `jsonLd` = `[buildProductJsonLd(...), buildBreadcrumbJsonLd(...), buildOrganizationJsonLd(cfg), buildLocalBusinessJsonLd(cfg)]` using `deriveProductSeo` for unset title/desc/keywords and `absoluteImageUrl(product.og_image || product.image)` for og:image. In `GET /page/:slug`, add keywords (page.meta_keywords) + BreadcrumbList + LocalBusiness JSON-LD. Load `config.seo` once per request via a small raw-SQL helper + `mergeSeoConfig`.
      Files: `c:\...\api-node\src\routes\og.ts`
      Verify: `npx tsc --noEmit` clean; `curl -A "Googlebot" http://localhost:4000/api/og/product/1` HTML contains `<title>`, `meta description`, `meta keywords`, `<link rel=canonical>`, `og:*`, `twitter:*`, and JSON-LD with `"@type":"Product"` and `"@type":"LocalBusiness"`.

- [ ] 9. Create the `seoRouter` (sitemap.xml + robots.txt) and mount it.
      Create `src/routes/seo.ts` default-exporting a `Router` with: `GET /sitemap.xml` — valid XML urlset with homepage (`SITE_ORIGIN/`), every product (`SITE_ORIGIN/product/:id` with `<lastmod>` from `updated_at`), category URLs (`SITE_ORIGIN/products?category=<slug>` or the real category route — confirm from web router; use `/products` + category slug), all published CMS pages (`SITE_ORIGIN/page/:slug`); short TTL in-memory cache (reuse the `cached()` idea or a module Map) invalidated on admin SEO save. `GET /robots.txt` — `User-agent: *`, `Allow: /`, `Sitemap: ${SITE_ORIGIN}/sitemap.xml`, plus admin-editable extra lines from `config.seo` (a `robotsExtra` string field; add it to `SeoConfig`/schema). Reuse `SITE_ORIGIN`/`API_ORIGIN` — lift them from `og.ts` into a tiny shared `src/seo/origin.ts` (or re-declare consistently). In `src/server.ts`, `import seoRouter` and `app.use('/api', seoRouter)` BEFORE the catalog mount is fine (distinct paths) — mount it near the other `/api` routers.
      Files: `c:\...\api-node\src\routes\seo.ts`, `c:\...\api-node\src\server.ts`, (optional) `c:\...\api-node\src\seo\origin.ts`
      Verify: `npx tsc --noEmit` clean; `curl http://localhost:4000/api/sitemap.xml` is well-formed XML (`<urlset xmlns=...>`), includes homepage + product + page URLs with `<lastmod>`; `curl http://localhost:4000/api/robots.txt` returns `User-agent`, `Allow`, `Sitemap:` lines + any extra rules.

- [ ] 10. Add the web Seo/JsonLd reusable helper.
      Create `web/src/lib/seo.ts` (or `web/src/components/Seo.tsx`): `interface SeoProps` (title, description, keywords?, canonical?, robots?, image?, jsonLd?); a `buildCanonical(path)` using `window.location.origin`; pure JSON-LD builders mirroring the API (`productJsonLd`, `localBusinessJsonLd`, `breadcrumbJsonLd`) seeded from `config.seo` (read via `useConfig()`); and a `<Seo>` component wrapping `<Helmet>` that emits title (via `config.seo.titleTemplate` → `%s | 4A Store`), description, keywords, canonical, robots, og:* and one `<script type="application/ld+json">` per jsonLd entry. Gate extra JSON-LD behind `isFeatureOn(features,'seoModule')` while always keeping title/description/canonical.
      Files: `c:\...\web\src\lib\seo.ts` (+ `c:\...\web\src\components\Seo.tsx` if a component form is used)
      Verify: `npx tsc --noEmit` clean (web).

- [ ] 11. Wire the Seo helper into ProductDetails, Page, and Home.
      `web/src/pages/ProductDetails.tsx`: replace the inline `<Helmet>` with the shared helper — title via titleTemplate, description = `product.seo_description || product.description || derived`, keywords, canonical `/product/:id`, and the SAME Product + BreadcrumbList + LocalBusiness JSON-LD. Add `seo_title`/`seo_description`/`seo_keywords`/`og_image` as optional fields on the web `Product` type (`web/src/types.ts`). `web/src/pages/Page.tsx`: extend to emit keywords (`page.metaKeywords`), canonical (already), BreadcrumbList + LocalBusiness JSON-LD; add `metaKeywords` to `CmsPage` (`web/src/lib/pages.ts`). `web/src/pages/Home.tsx`: title via titleTemplate, local description/keywords, canonical `/`, Organization + LocalBusiness JSON-LD.
      Files: `c:\...\web\src\pages\ProductDetails.tsx`, `c:\...\web\src\pages\Page.tsx`, `c:\...\web\src\pages\Home.tsx`, `c:\...\web\src\types.ts`, `c:\...\web\src\lib\pages.ts`
      Verify: `npx tsc --noEmit` clean; `npm run build` clean; rendered ProductDetails `<head>` has SEO title/description/canonical + Product JSON-LD.

- [ ] 12. Add the admin SEO sub-tab in AdminSettings.
      In `web/src/pages/admin/AdminSettings.tsx`: add `{ key: 'seo', label: '🔎 SEO' }` to `SUBS`; add a `function SeoSettings()` modeled on `FeaturesSettings()` reading `useConfig().data.seo` + `useProducts()` + `usePages()`, with: (a) global SEO defaults + LocalBusiness fields (titleTemplate, defaultDescription, defaultKeywords, social, business{address/phone/geo/openingHours/priceRange/areaServed}, robotsExtra); (b) per-product SEO via a searchable product list calling `saveProduct('update', {...})` with seoTitle/seoDescription/seoKeywords/ogImage; (c) per-CMS-page SEO via `savePage('update', {...})` with metaKeywords; (d) a Google-snippet preview (title/description/url) and a social-card preview `<img src="/api/og/image/product/:id">`; (e) a "view/regenerate sitemap" link (`/api/sitemap.xml`) and robotsExtra editor. Save global via new `saveSeo()` in `web/src/lib/admin.ts` (`api.post('/admin/seo', payload)`), toast + `qc.invalidateQueries({ queryKey: ['config'] })`. Add `{sub === 'seo' && <SeoSettings />}` to the render. Bilingual Hindi/English copy; reuse `lbl`/`inp`/`hint`/`albl` styles.
      Files: `c:\...\web\src\pages\admin\AdminSettings.tsx`, `c:\...\web\src\lib\admin.ts`
      Verify: `npx tsc --noEmit` clean; `npm run build` clean; the SEO sub-tab renders, loads global/per-product/per-page values, saves them, and previews render.

- [ ] 13. Update OG-SETUP.md and create SEO-SETUP.md.
      EXTEND (do not duplicate) `c:\...\api-node\OG-SETUP.md` with an nginx section mapping bare `/sitemap.xml` and `/robots.txt` → the API (`location = /sitemap.xml { proxy_pass http://127.0.0.1:4000/api/sitemap.xml; }` and same for robots). Create `c:\...\api-node\SEO-SETUP.md`: what the module delivers (crawlable/indexable pages, correct meta, structured data, sitemap/robots — a technical foundation), the realistic-expectation note (ranking depends on content/backlinks/time; no code guarantees #1), admin usage, and the OG ≤100KB reuse note.
      Files: `c:\...\api-node\OG-SETUP.md`, `c:\...\api-node\SEO-SETUP.md`
      Verify: both docs render as valid Markdown; nginx snippet mirrors the existing crawler-rewrite style.

- [ ] 14. Final verification + SUMMARY and EC2 deploy steps.
      Run full verification (see checklist). Append a SUMMARY section + exact EC2 deploy steps to `SEO-SETUP.md`: files to upload (api-node `src/**`, `prisma/seo.sql`, `prisma/schema.prisma`; web `dist/**`), apply SQL (`mysql -u <user> -p four_a_store < prisma/seo.sql`), `npx prisma generate`, nginx additions + `nginx -t && systemctl reload nginx`, `npm run build` (web + api-node), `pm2 restart 4astore-api --update-env`. Do NOT git commit/push.
      Files: `c:\...\api-node\SEO-SETUP.md`
      Verify: full checklist below passes.

---

## Verification checklist (project real commands)

api-node (`cd c:\...\api-node`):
- `npx tsc --noEmit` → clean.
- `npx prisma validate` → clean.
- `seo.sql` re-runnable (manual on MariaDB 10.4; second run prints "already exists").
- Start dev (`npm run dev`), then: `curl http://localhost:4000/api/sitemap.xml` → valid XML (homepage + products + pages + `<lastmod>`); `curl http://localhost:4000/api/robots.txt` → `User-agent`/`Allow`/`Sitemap:` + extra rules; `curl -A "Googlebot" http://localhost:4000/api/og/product/1` → HTML with title/description/keywords/canonical/OG + Product & LocalBusiness JSON-LD; `curl http://localhost:4000/api/products` → includes `seo_*`/`og_image` null-when-unset; `curl http://localhost:4000/api/config` → `config.seo` default object present.

web (`cd c:\...\web`):
- `npx tsc --noEmit` → clean; `npm run build` → clean.
- Admin SEO sub-tab saves+reads global/per-product/per-page.
- ProductDetails Helmet emits SEO title/description/canonical + JSON-LD; Google-snippet + social-card previews render.

Reuse/no-break confirmation:
- No second OG generator (`getOrRenderOg` reused for all images).
- `og.ts` routes extended, not forked; existing OG product/page HTML still redirects humans.
- `config.features` / `mergeFeatures` plumbing intact; new `seoModule` flows through unchanged.
- All API JSON responses are ADD-only (no removed/renamed keys).

## Gaps / assumptions
- Category storefront URL: the web router uses `/products` with category filtering (confirm the exact param during impl); sitemap uses `SITE_ORIGIN/products?category=<slug>` as a reasonable canonical for category pages.
- Node API port in curl examples assumed `4000` (matches OG-SETUP.md); use the actual `config.port` locally.
