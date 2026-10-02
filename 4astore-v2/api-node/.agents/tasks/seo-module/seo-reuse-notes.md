# SEO module — reuse / reconnaissance notes

Reconnaissance only. NO code was edited in this step. All later SEO work must
REUSE and EXTEND the symbols documented here — never duplicate the OG generator,
the feature-flag plumbing, the guarded-SQL pattern, the config-JSON parse/write
helpers, the Helmet usage, or the AdminSettings sub-tab wiring.

Worktree: `c:\xampp\htdocs\static4a\.worktrees\og-eye-bulkpush-flags-cms-polish`
Branch:   `feature/og-eye-bulkpush-flags-cms-polish` (confirmed via `git branch --show-current`)
Paths below are relative to `4astore-v2/api-node/` or `4astore-v2/web/` as noted.

---

## 1. All FOUR OG files present? YES

| file | present | note |
|---|---|---|
| `api-node/src/services/og.ts` | ✅ | OG image generator (1200x630, ≤100 KB, @napi-rs/canvas, logo fallback) |
| `api-node/src/routes/og.ts` | ✅ | share routes under `/api/og` (product + CMS page HTML + images) |
| `api-node/src/utils/features.ts` | ✅ | feature flags; served through `GET /api/config` → `config.features` |
| `api-node/OG-SETUP.md` | ✅ | nginx crawler-UA rewrite doc |

No OG file is missing. No mobile-stage edit is mid-write in these files, so the
later SEO stage can proceed with the API + web SEO files normally (mobile stage
does not touch any of the files above).

Deps confirmed already-installed (NO new heavy deps needed):
- `api-node/package.json` → `@napi-rs/canvas` `0.1.65` (pinned).
- `web/package.json` → `react-helmet-async` `^2.0.5`. (`dompurify` 2.5.9 also present for sanitising CMS HTML.)

---

## 2. OG image service — `api-node/src/services/og.ts` (EXTEND, don't re-create)

Exported symbols / signatures (actual):

- `const OG_DIR: string` — `path.join(process.cwd(), 'uploads', 'og')` (disk cache dir).
- `interface OgImage { buffer: Buffer; contentType: 'image/webp' | 'image/jpeg'; ext: 'webp' | 'jpeg'; }`
- `interface RenderOgOptions { title: string; subtitle?: string; imageUrl?: string | null; price?: string; }`
  - `imageUrl` null → draws the branded 4A **logo card** (fallback). Non-null → draws product image in the right panel.
  - `price` is a PRE-FORMATTED string, e.g. `"₹49"` (caller formats it).
- `async function renderOgImage(opts: RenderOgOptions): Promise<OgImage>` — render + compress once (no cache).
- `async function getOrRenderOg(cacheKey: string, opts: RenderOgOptions): Promise<OgImage>` — **use this**. Checks in-memory LRU (bounded 100), then disk (`OG_DIR/<safeKey>.webp|jpeg`), else renders and persists best-effort. `cacheKey` MUST change when the source changes (routes use `product-<id>-<updated_at_ms>` and `page-<slug>`).

Internal (not exported, do not reimplement): `WIDTH=1200`, `HEIGHT=630`,
`MAX_BYTES=100*1024`, gradient `drawBackground`, `drawBrandCard`,
`drawCardText` (uses `wrapLines`), `drawRightPanel`, `compress()` (tries
WEBP then JPEG across scales `[1,0.85,0.7]` × qualities `[85,70,55,40]`, hard
≤100 KB cap). Logo raster read from `process.cwd()/assets/og-logo.png` via
`getLogo()`; missing logo falls back to a drawn grocery illustration.

Any new SEO image endpoint (e.g. category/sitemap thumbnail) should call
`getOrRenderOg(key, opts)` with a new `RenderOgOptions` shape rather than adding
a second canvas pipeline.

---

## 3. OG routes — `api-node/src/routes/og.ts` (EXTEND, don't re-create)

Default export: an Express `Router` (mounted — see server.ts note below).
Routes already defined (all return absolute `https` meta via `SITE_ORIGIN`):

- `GET /image/product/:id` → `getOrRenderOg('product-<id>-<updated_at_ms>', {...})`; `Cache-Control: public, max-age=86400`.
- `GET /product/:id`       → `shareHtml()` doc with og/twitter meta + `<link rel=canonical>` + instant redirect to SPA `/product/:id`; `Cache-Control: public, max-age=3600`.
- `GET /page/:slug`        → same for CMS page; validates `slug` with `/^[a-z0-9-]{1,80}$/`; reads `pages` via raw SQL `SELECT title, meta_description FROM pages WHERE slug = ? AND published = 1`.
- `GET /image/page/:slug`  → branded logo card (`getOrRenderOg('page-<slug>', { imageUrl: null })`).

Reusable module-local helpers (NOT exported — copy the style, or lift them to a
shared util if a new route needs them):
- `SITE_ORIGIN` = `process.env.PUBLIC_SITE_URL || 'https://4astore.com'` (trailing slashes stripped).
- `API_ORIGIN`  = `process.env.PUBLIC_API_URL || \`${SITE_ORIGIN}/api\``.
- `escapeHtml(s)`, `absoluteImageUrl(image)`, `interface ShareMeta`, `shareHtml(m: ShareMeta): string`.

Mount point: `og.ts` default export is wired in `src/server.ts`. `catalog.ts`
(the `/api` router) is mounted with `app.use('/api', catalogRouter)`; the OG
router is mounted so these routes resolve under `/api/og/...` (confirm exact
`app.use('/api/og', ogRouter)` line in server.ts before adding sibling SEO
routes — e.g. `/api/seo/sitemap.xml`, `/api/robots.txt`).

---

## 4. Feature flags — `api-node/src/utils/features.ts` + `web/src/lib/features.ts`

These two files are kept in lockstep (same keys, same "absent = ON" default).
A new SEO flag (e.g. `seoModule`) must be added in BOTH and in the two label
places, then it flows through unchanged.

API `src/utils/features.ts`:
- `type FeatureKey` = union of: `socialProof | productZoom | productRotate | animatedBanners | bulkPushEnabled | ogShareImages | webLocalCache`.
- `const FEATURE_KEYS: FeatureKey[]` — array of the same keys (order preserved; drives admin UI order).
- `type Features = Record<FeatureKey, boolean>`.
- `const DEFAULT_FEATURES: Features` — every key `true`.
- `function mergeFeatures(raw: unknown): Features` — starts from defaults; only sets a key OFF when stored exactly `false`, ON when exactly `true`; ignores missing/null/non-boolean. **This is the single source of truth for flag resolution; reuse it, don't branch.**

Web `src/lib/features.ts` (mirror):
- `type FeatureKey`, `const FEATURE_KEYS: FeatureKey[]` (same keys/order).
- `const FEATURE_LABELS: Record<FeatureKey, string>` — bilingual Hindi/English labels for the admin toggles UI.
- `function isFeatureOn(features: Record<string,boolean>|undefined, key: FeatureKey, def = true): boolean` — OFF only when explicitly `false`, else `def` (ON).

To ADD a flag: append the key to `FeatureKey` + `FEATURE_KEYS` in BOTH files,
add a `DEFAULT_FEATURES` entry (API) and a `FEATURE_LABELS` entry (web). The
admin `/features` POST validator and the config GET already iterate
`FEATURE_KEYS` / call `mergeFeatures`, so no other wiring is needed.

---

## 5. Guarded-SQL guard pattern (MariaDB 10.4) — COPY THIS EXACTLY

Source of truth: `api-node/prisma/charges-settings.sql` (multi-column) and
`api-node/prisma/features-column.sql` (single-column). Both use the same
information_schema guard; MariaDB 10.4 lacks reliable `ADD COLUMN IF NOT EXISTS`.
ADD-only, idempotent (re-run prints "already exists"). Pattern per column:

```sql
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '<table>' AND COLUMN_NAME = '<col>');
SET @sql := IF(@c = 0,
  'ALTER TABLE <table> ADD COLUMN <col> <TYPE> ... DEFAULT ...',
  'SELECT ''<col> already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
```

Conventions to match: header comment block with the `mysql -u <user> -p four_a_store < prisma/<file>.sql` run line; "Run ONCE on the live DB (EC2). ADD COLUMN only — no destructive ops."; booleans as `TINYINT(1) NOT NULL DEFAULT <0|1>`; JSON-ish blobs as `LONGTEXT NULL`. Any SEO SQL (e.g. a `seo` row/columns, sitemap meta) goes in a NEW guarded `prisma/*.sql` file using this exact style — never an unguarded `ALTER`.

Other existing SQL: `prisma/perf-indexes.sql` (index adds). `schema.prisma`
models are User, RefreshToken, EmailOtp, Category, Product, Address, Order,
DeviceToken (and more below). **`pages`, `config`, `settings`, `announcements`,
`app_version` are NOT Prisma models** — they are read/written via
`prisma.$queryRawUnsafe` / `$executeRawUnsafe`, so SEO columns on those tables
need a guarded SQL file + raw-SQL access (not a Prisma migration).

---

## 6. Config-JSON parse / write helpers — `api-node/src/routes/catalog.ts` + `admin.ts`

The `config` table is a single row (`WHERE id = 1`) with JSON-string columns.

Parse (read side) — identical inline helper used in both `catalog.ts` GET
`/api/config` and `admin.ts` POST `/features`:
```ts
const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v ?? null);
```
`GET /api/config` (catalog.ts) shapes: `banners`, `festivalAds`,
`festivalCategories`, `ads`, `socialProofMessages`, `socialProofNames`,
`currentFestival`, `footer` (null → web default), and
`features: mergeFeatures(parse(row.features))`. Wrapped in a 10s TTL
`cached('config', …)` memo + `Cache-Control: public, max-age=30` (STATIC_CACHE).
`/products` uses `max-age=15` (PRODUCTS_CACHE). **A new SEO config read should be
added to this same `/api/config` payload (and its `cached()` memo) rather than a
new uncached endpoint, unless it needs its own cache policy.**

Write (admin side) — raw UPDATE of a single JSON column, e.g.:
```ts
await prisma.$executeRawUnsafe('UPDATE config SET banners = ? WHERE id = 1', JSON.stringify(parsed.data));
await prisma.$executeRawUnsafe('UPDATE config SET footer  = ? WHERE id = 1', JSON.stringify(parsed.data));
await prisma.$executeRawUnsafe('UPDATE config SET features = ? WHERE id = 1', JSON.stringify(features));
```
`/features` write merges onto current stored flags before writing:
`const merged = { ...mergeFeatures(parse(cur.features)), ...incoming }; const features = mergeFeatures(merged);`
All admin writes are Zod-validated first and guarded by
`requireAuth, requireStaff('settings')`. A new SEO settings blob should follow
the same shape: Zod schema → `UPDATE config SET <col> = ? WHERE id = 1`,
JSON.stringify, under `requireStaff('settings')`.

---

## 7. Helmet usage — `react-helmet-async` (web; REUSE this exact pattern)

Lib: `react-helmet-async` `^2.0.5`. Import: `import { Helmet } from 'react-helmet-async';`
(a `HelmetProvider` is already set up app-wide since both pages render `<Helmet>` directly).

`web/src/pages/ProductDetails.tsx`:
```tsx
<Helmet>
  <title>{`${product.name} | 4A Store`}</title>
  <meta name="description" content={product.description || product.name} />
  <script type="application/ld+json">{JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Product', name, image, description, brand,
    offers: { '@type': 'Offer', price, priceCurrency: 'INR', availability: in_stock ? 'InStock' : 'OutOfStock' },
  })}</script>
</Helmet>
```
→ Product already emits JSON-LD + title + description. Extend here for canonical /
og:* client tags if needed; do not add a second meta mechanism.

`web/src/pages/Page.tsx` (CMS page `/page/:slug`):
```tsx
<Helmet>
  <title>{`${page.title} - 4A Store`}</title>
  {page.metaDescription && <meta name="description" content={page.metaDescription} />}
  <meta property="og:title" content={`${page.title} - 4A Store`} />
  {page.metaDescription && <meta property="og:description" content={page.metaDescription} />}
  <link rel="canonical" href={`${window.location.origin}/page/${page.slug}`} />
</Helmet>
```
Also note the not-found branch sets `<meta name="robots" content="noindex" />` —
reuse that convention for any noindex SEO states. CMS data comes from
`usePage(slug)` / `usePages()` and HTML is sanitised via `sanitizePageHtml`
(`web/src/lib/pages.ts`, DOMPurify).

---

## 8. AdminSettings sub-tab wiring — `web/src/pages/admin/AdminSettings.tsx`

To add an "SEO" sub-tab, mirror the existing `features` sub-tab end-to-end:

1. `const SUBS = [...] as const` (top of file): add `{ key: 'seo', label: '🔎 SEO' }`.
   `type SubKey = (typeof SUBS)[number]['key'];` picks it up automatically.
2. Add a `function SeoSettings() { ... }` component modeled on `FeaturesSettings()`:
   - read via a React-Query hook (`useConfig()` for config-backed data, or a new query);
   - local `useState` draft seeded in a `useEffect` from the query data;
   - a `save()` that calls a new `lib/admin.ts` helper, shows `showToast(...)`, and `qc.invalidateQueries({ queryKey: ['config'] })`.
3. In the default `AdminSettings()` render, add `{sub === 'seo' && <SeoSettings />}`
   alongside the existing `{sub === 'features' && <FeaturesSettings />}` lines.
   The `SUBS.map(...)` pill buttons + `open(k)` (persists `lastSub` across mounts)
   already handle the tab switching — no extra wiring.
4. Add the API call to `web/src/lib/admin.ts` next to `saveFeatures`:
   ```ts
   export async function saveSeo(payload: ...) {
     return (await api.post('/admin/seo', payload)).data;
   }
   ```
   (`api` = axios instance from `./api`; all admin writes go through `/admin/*`.)

Shared inline style consts available in the file: `lbl`, `inp`, `hint`, `albl`.
Permission: Settings tab actions use `requireStaff('settings')` server-side.

---

## 9. Server mount / routing reminder for later steps

- `src/server.ts`: `app.use('/api', catalogRouter)` provides `/api/products`,
  `/api/categories`, `/api/settings`, `/api/config`, `/api/announcement`,
  `/api/version`. The OG router is mounted under `/api/og`. **Before adding new
  SEO routes, open `src/server.ts` and reuse the existing mount convention**
  (e.g. a `seoRouter` mounted at `/api/seo`, or sitemap/robots at `/api`),
  rather than inventing a new mounting style.
- Admin routes live under `/api/admin/*` via the admin router
  (`requireAuth` + `requireStaff('<perm>')`).

---

## Summary for the implementation steps

- Reuse `getOrRenderOg` / `renderOgImage` + `RenderOgOptions` for any SEO image.
- Reuse `og.ts` route helpers (`shareHtml`, `escapeHtml`, `absoluteImageUrl`, `SITE_ORIGIN`/`API_ORIGIN`); add sibling SEO routes, don't fork the file.
- Add any new feature flag in BOTH `features.ts` files via `FEATURE_KEYS` + `mergeFeatures` / `isFeatureOn`.
- New DB columns → NEW guarded `prisma/*.sql` using the information_schema pattern; access via `$queryRawUnsafe` / `$executeRawUnsafe` (pages/config/settings are raw, not Prisma models).
- Config reads extend the `/api/config` `cached()` payload; config writes do `UPDATE config SET <col> = ? WHERE id = 1` with `JSON.stringify`, Zod-validated, under `requireStaff('settings')`.
- Web meta uses `react-helmet-async` `<Helmet>` exactly as ProductDetails/Page do (title, description, og:*, canonical, JSON-LD, robots noindex for not-found).
- Admin SEO UI = a new sub-tab in AdminSettings following the `FeaturesSettings` pattern (`SUBS` entry, component, render guard, `lib/admin.ts` saver, `invalidateQueries(['config'])`).
