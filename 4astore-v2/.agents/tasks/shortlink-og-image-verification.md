# Verification — Short-link OG preview image (never blank)

## What was built

A WhatsApp/social OG preview for 4AStore short links (`/link/<code>`) now ALWAYS
renders an image — never blank — with a clear per-type rule.

### Schema (guarded ALTER, NO prisma migrate)
- Added two nullable columns to `short_links`:
  - `og_image VARCHAR(1000) NULL`
  - `og_title VARCHAR(255) NULL`
- Added via `ensureShortLinkOgColumns()` in `api-node/src/services/dataImport.ts`,
  mirroring `ensureWhatsappApiColumn` / `ensureProductMaxQtyColumn` /
  `ensureProductInventoryColumns`: `information_schema`-guarded ALTER that swallows
  only MySQL 1060 / "Duplicate column", idempotent and concurrency-safe.
- Wired at boot in `api-node/src/server.ts` beside `ensureShortLinkTables()`.
- Mirrored on the Prisma `ShortLink` model (`api-node/prisma/schema.prisma`) with a
  "runtime-created via ensureShortLinkOgColumns(); do NOT run prisma migrate / db push"
  comment, and documented in the manual `api-node/prisma/short-links.sql`.

## The image rule (guaranteed non-blank)

- **PRODUCT short link** → the product's image. If the product has NO image →
  the **4A Store logo / default card** (never blank).
- **CUSTOM short link** → the admin-provided custom image (`og_image`). If none was
  set → the **4A Store default OG card** (`cfg.defaultOgImage`, i.e.
  `${SITE_ORIGIN}/assets/og-default.png`). Never blank.

The admin can set a custom image/title ONLY for custom links (product previews come
from the product).

## Product no-image fallback — ALREADY CORRECT (not changed)

Evidence from `api-node/src/services/og.ts`:
- `renderProductHeroImage(opts)` (the product-hero variant used for product OG
  images) loads the product photo via `tryLoadImage(opts.imageUrl)` and, in the draw
  callback, does: `if (productImg) drawHeroPhoto(ctx, productImg, false); else if
  (logo) drawHeroPhoto(ctx, logo, true);`. When the product has no usable image it
  draws the **4A Store logo** (capped size). `drawHeroStrip(...)` always paints the
  "4A Store" branding, and `drawHeroBackground` fills a clean background even if the
  logo file is missing — so the output is **never a broken/blank image**.
- `buildProductShareHtml(id)` in `ogShare.ts` sets
  `image = absoluteImageUrl(product.og_image) || \`${API_ORIGIN}/og/image/product/${id}\``,
  so an image-less product falls through to that dynamic generator, which renders the
  logo card per above.

**Conclusion:** the PRODUCT path already satisfies "no product image → 4A Store logo
card." `buildProductShareHtml` / `og.ts` were NOT changed. A regression test
documents this (see tests below); products that DO have an image are untouched.

## Custom-link OG card (the real fix)

Previously, custom/unresolved links fell through the crawler branch with NO OG card →
blank WhatsApp preview. Now `api-node/src/routes/link.ts` crawler branch, after the
product/page/category chain, builds a custom OG card via the new pure helper
`buildCustomShareHtml({ code, target, ogImage, ogTitle, cfg })` in
`api-node/src/services/ogShare.ts`:
- `image = absoluteImageUrl(og_image) || cfg.defaultOgImage` (empty/whitespace →
  trimmed to null → default card; **never blank**).
- `title = og_title || cfg.business.name || "4A Store — Grocery in Minutes"`.
- `description = cfg.defaultDescription`.
- `url = ${SITE_ORIGIN}/link/<code>`, `redirect = resolved target`, `robots noindex,nofollow`.

The DB `select` in `link.ts` was widened to read `og_image` / `og_title`. The HUMAN
redirect logic (app / Play-Store / website) was **NOT** changed — only the crawler OG
branch gained the custom-link case.

### Service
`createCustomShortLink` (`api-node/src/services/shortLink.ts`) now accepts optional
`ogImage` + `ogTitle` and persists them on both create paths (custom-code and
auto-generate). Backward compatible (all new fields optional). Validation:
- `normaliseOgImage`: empty/undefined/whitespace → null; otherwise must be an http(s)
  URL ≤ 1000 chars, else throws "Custom image must be an http(s) URL".
- `normaliseOgTitle`: trimmed, empty → null, clamped to 255.

### Admin API
`api-node/src/routes/admin-links.ts` `createSchema` gained optional
`ogImage` (≤1000) and `ogTitle` (≤255); they are spread through to
`createCustomShortLink`. A bad image URL surfaces as 422 via the existing catch. The
`GET /` select also returns `og_image` / `og_title`.

## Admin UI

`web/src/pages/admin/AdminLinks.tsx` create form gained two optional inputs:
- "Custom image URL (optional) / कस्टम इमेज URL"
- "Preview title (optional) / प्रीव्यू टाइटल"

with the bilingual helper note:
"WhatsApp par share karne par yeh image/title dikhega. Khaali chhodne par 4A Store ka
logo aayega." Existing inline-style design + bilingual copy preserved. State resets on
success. `web/src/lib/admin.ts` `ShortLink` type gained `og_image` / `og_title`, and
`createShortLink` accepts `ogImage` / `ogTitle`.

## Tests

New `api-node/src/__tests__/shortlinkOg.test.ts` (node:test, DB-free, network-free):
- `buildCustomShareHtml` with an admin image → that absolute image appears in
  og:image / twitter:image.
- with empty/null/undefined/whitespace image → `cfg.defaultOgImage` appears and the
  image meta is NEVER blank.
- title falls back to the store name; a given title is used.
- short links are `noindex,nofollow`.
- `normaliseOgImage`: empty→null, valid https→unchanged, non-http/over-length→throws.
- `normaliseOgTitle`: trims, empty→null, clamps to 255.

The product no-image fallback is handled upstream in `og.ts` (canvas + DB), so it is
documented in the test file's header rather than re-rendered; the custom-link path is
the substantive new logic and is fully covered.

## Build / test results

- `api-node`: `npm run build` → PASS (0 errors). `npm test` → **74 passing, 0
  failing** (up from the 68 baseline; +6 new). Note: `npx prisma generate` was run
  OFFLINE against a local mirror of the already-installed engine because the corp
  network blocks `binaries.prisma.sh` (SSL intercept / 403). All mirror temp files
  were removed afterward; only the generated client (which now types `og_image` /
  `og_title`) remains.
- `web`: `npm run build` → PASS (tsc + vite, 0 TS errors).

## How to test manually (WhatsApp)

1. PRODUCT link, product WITH image → share `https://4astore.com/link/<code>` in
   WhatsApp → card shows the product photo.
2. PRODUCT link, product WITHOUT image → card shows the 4A Store logo card (never
   blank).
3. CUSTOM link with a "Custom image URL" set → card shows that image.
4. CUSTOM link with NO custom image → card shows the 4A Store default logo card
   (never blank).

## Deploy + cache notes

- Deploy with `bash deploy.sh`. On boot `ensureShortLinkOgColumns()` adds the two
  columns if missing (idempotent, no migrate).
- WhatsApp aggressively caches OG metadata per URL. To SEE the change, share a
  **fresh** short code (a new code has no cached preview). Existing codes may keep
  their old (possibly blank) cache until WhatsApp re-scrapes.
