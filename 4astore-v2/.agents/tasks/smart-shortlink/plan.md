# Implementation Plan — Universal Smart Short-Link + Product Share button (4A Store v2)

Scope: `4astore-v2` only (api-node + web). NO mobile app rebuild — the app already handles
Android App Links (autoVerify https host `4astore.com`, pathPrefixes include `/product`) and the
`fourastore://` scheme. IGNORE legacy `4AStoreApp/PHP`.

ALL paths below are under the worktree root:
`c:\xampp\htdocs\static4a\.worktrees\smart-shortlink\4astore-v2\`
Relative paths in a coder shell land in the PARENT workspace — always use the absolute worktree path.

## Key design decisions (grounded in the code read during exploration)

- **Reuse the a0380ad2 OG mechanism, do not fork it.** The ONE source of truth for crawler preview
  HTML is `api-node/src/services/ogShare.ts` (`buildProductShareHtml` / `buildPageShareHtml` /
  `buildCategoryShareHtml`) and the crawler detector `isCrawler()` in
  `api-node/src/middleware/ogCrawler.ts`. The `/link/:code` crawler branch calls those directly.
- **`/link/:code` must reach Node for BOTH crawlers and humans.** Apache only reverse-proxies
  `/api/*` to Node (`127.0.0.1:4000`); the SPA serves every other path. The a0380ad2 crawler rule
  lives in the repo-tracked Apache include `deploy/4astore-og.conf`, installed into Apache
  `conf.d` by `deploy.sh` (step 5b). Mirror that: mount the handler at **`/api/link/:code`** in
  Node, and add ONE rewrite to `deploy/4astore-og.conf` that proxies the public path
  `/link/<code>` to `http://127.0.0.1:4000/api/link/<code>` **for ALL user-agents** (unlike the OG
  rules, which are crawler-UA-gated — humans also need the smart-redirect page). This keeps `/link`
  working through one deploy-safe include edit, with no per-path `.htaccess`.
- **No-migrate DB pattern.** Follow the repo convention exactly: add
  `ensureShortLinkTables()` in `api-node/src/services/dataImport.ts` using idempotent
  `CREATE TABLE IF NOT EXISTS` via `prisma.$executeRawUnsafe` (InnoDB utf8mb4), wire it at startup
  in `server.ts` beside `ensureMarketingTables()`. ALSO add a `ShortLink` Prisma model
  (`@@map("short_links")`) and a manual-run `prisma/short-links.sql` (catalog-version.sql style).
  After merge the MAIN checkout runs `npx prisma generate` because a model was added.
- **Smart redirect to an App-Link path.** On Android, redirect humans to
  `https://4astore.com/product/<id>` (an autoVerify App Link → opens the installed app) AND attempt
  `intent://` / `fourastore://`; if the app does not take over within ~1.2s, fall back to Play
  Store `https://play.google.com/store/apps/details?id=com.store4a.app`. On desktop/other, redirect
  straight to `https://4astore.com<target>`. Always include `<noscript>` + `<meta http-equiv=refresh>`
  to the website target so it works with JS disabled. App id confirmed: `com.store4a.app`;
  scheme `fourastore`; host `4astore.com`.
- **base62 code**, 6–8 chars, uniqueness enforced by a DB UNIQUE index + retry-on-collision.
- **Admin gating** reuses `requireAuth, requireStaff('ads')` like `routes/marketing.ts`.

## Prerequisite (verification environment)

- [ ] 0. Install deps and ensure the Prisma client exists in the worktree so build/validate run.
      Run `npm install` in `api-node` and `web`. Then `npx prisma generate` in `api-node`; if the
      engine download is BLOCKED, copy the generated client + engines from the main checkout
      (identical schema): copy `c:\xampp\htdocs\static4a\4astore-v2\api-node\node_modules\.prisma`
      and `...\node_modules\@prisma\client` into the worktree's `api-node\node_modules\`. Note in
      FEAT findings that the TLS-copy fallback was used.
      Files: none (environment only).
      Verify: `npx prisma validate` in `api-node` succeeds; `npm run build` in `api-node` runs.

## FEATURE 1 — backend: short_links table, redirect route, auto-create, admin API, Apache include

- [ ] 1. Add the `short_links` DB table three ways (no-migrate pattern).
      (a) `ensureShortLinkTables()` in `services/dataImport.ts` — idempotent
      `CREATE TABLE IF NOT EXISTS short_links (...)` with columns: `id BIGINT UNSIGNED AI PK`,
      `code VARCHAR(16) NOT NULL` UNIQUE, `target_url VARCHAR(1000) NOT NULL`,
      `type VARCHAR(16) NOT NULL` (`product|category|page|custom`), `product_id BIGINT UNSIGNED NULL`,
      `created_by VARCHAR(64) NULL`, `clicks INT NOT NULL DEFAULT 0`,
      `created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`,
      `UNIQUE KEY uq_short_links_code (code)`, `INDEX idx_short_links_product (product_id)`.
      (b) `ShortLink` model in `prisma/schema.prisma` with `@@map("short_links")` + `@@index`/`@unique`
      mirroring the SQL. (c) `prisma/short-links.sql` manual-run equivalent in catalog-version.sql style.
      Files: `api-node/src/services/dataImport.ts`, `api-node/prisma/schema.prisma`,
      `api-node/prisma/short-links.sql`.
      Verify: `npx prisma validate` passes; `npm run build` (api-node) compiles.

- [ ] 2. Wire `ensureShortLinkTables()` at startup in `server.ts` beside `ensureMarketingTables()`
      (same fire-and-forget `.catch` logging pattern).
      Files: `api-node/src/server.ts`.
      Verify: `npm run build` (api-node) compiles; grep is NOT verification — confirm the call is in
      the `app.listen` startup block alongside the other `ensure*` calls by reading the file.

- [ ] 3. Create a short-link service `services/shortLink.ts` with: `generateCode()` (base62, 6–8
      chars via `crypto`), `createShortLinkForProduct(productId)` (idempotent — returns existing row
      if one already points at that product, else inserts with retry on UNIQUE collision; best-effort,
      never throws to the caller), and `createCustomShortLink({ targetUrl, type, code?, createdBy })`
      (validates/normalises target, accepts optional custom code with uniqueness check). Use the
      `prisma.shortLink` delegate.
      Files: `api-node/src/services/shortLink.ts`.
      Verify: `npm run build` (api-node) compiles.

- [ ] 4. Auto-create a product short link on SINGLE product create. In `routes/admin.ts`
      `POST /products` `action === 'add'`, after `prisma.product.create(...)` and
      `bumpCatalogVersion()`, call `void createShortLinkForProduct(Number(product.id)).catch(()=>…)`
      — fire-and-forget, must not block or slow the save (mirror the existing `runProductSeo`
      fire-and-forget pattern).
      Files: `api-node/src/routes/admin.ts`.
      Verify: `npm run build` (api-node) compiles.

- [ ] 5. Auto-create on BULK upload. In `services/dataImport.ts` `importProducts()`, after each
      `prisma.product.upsert(...)`, best-effort `createShortLinkForProduct(Number(p.id))` (idempotent,
      swallow errors) so bulk import also gets links. Keep it from slowing the loop materially
      (await is fine; it is a one-time import path).
      Files: `api-node/src/services/dataImport.ts`.
      Verify: `npm run build` (api-node) compiles.

- [ ] 6. Add the redirect handler mounted at `/api/link/:code`. New `routes/link.ts` exporting a
      router: look up `code` → row; friendly 404 HTML if missing; best-effort `clicks+1`
      (`UPDATE ... SET clicks = clicks + 1`); if `isCrawler(req.get('user-agent'))` and the row is a
      product (`product_id`), return `buildProductShareHtml(product_id)` HTML (fallback to the
      target's page/category builder by `type`); else return the SMART-REDIRECT HTML page. Mount in
      `server.ts` as `app.use('/api/link', linkRouter)` BEFORE the 404 handler. Set
      `Content-Type: text/html`, `Vary: User-Agent`.
      Files: `api-node/src/routes/link.ts`, `api-node/src/server.ts`.
      Verify: `npm run build` (api-node) compiles.

- [ ] 7. Build the smart-redirect HTML (a helper in `routes/link.ts` or `services/shortLink.ts`).
      Resolve the canonical target `https://4astore.com<target>` (SITE_ORIGIN from `seo/origin.ts`).
      For a product target, the Android path is `/product/<id>` (an autoVerify App Link). The page:
      on Android attempts the app (`location.href = 'fourastore://…'` or
      `intent://…#Intent;scheme=https;package=com.store4a.app;end`) and after ~1200ms falls back to
      `https://play.google.com/store/apps/details?id=com.store4a.app`; on desktop/other immediately
      `location.replace(target)`. Include `<noscript>` + `<meta http-equiv="refresh" content="0;url=TARGET">`
      to the website target. Escape all interpolated values (reuse `escapeHtml` from `ogShare.ts`).
      Files: `api-node/src/routes/link.ts` (+ reuse `ogShare.ts` escape helper).
      Verify: `npm run build` (api-node) compiles.

- [ ] 8. Add admin short-link API routes. New `routes/admin-links.ts` router gated
      `requireAuth, requireStaff('ads')`: `GET /` (list — code, target_url, type, clicks, created_at,
      newest first, limit), `POST /` (create for ANY url via `createCustomShortLink`; auto-generate
      or accept custom code; 409 on duplicate code). Mount in `server.ts` as
      `app.use('/api/admin/links', adminLinksRouter)` placed with the other specific
      `/api/admin/...` mounts BEFORE the generic `app.use('/api/admin', adminRouter)`.
      Files: `api-node/src/routes/admin-links.ts`, `api-node/src/server.ts`.
      Verify: `npm run build` (api-node) compiles.

- [ ] 9. Add a public resolver the web Share button can call to get a product's short code:
      `GET /api/products/:id/short-link` (in `routes/catalog.ts`, public) returning
      `{ code }` — creating the link on demand if absent via `createShortLinkForProduct`, so the
      Share button always has a short link. Return `{ code: null }` only if creation genuinely fails.
      Files: `api-node/src/routes/catalog.ts`.
      Verify: `npm run build` (api-node) compiles.

- [ ] 10. Add the `/link/<code>` Apache rewrite to `deploy/4astore-og.conf`. Add an all-UA rule
      (NOT crawler-gated) that reverse-proxies `^/?link/([A-Za-z0-9]+)/?$` to
      `http://127.0.0.1:4000/api/link/$1 [P,L]`, placed inside the existing `<IfModule mod_rewrite.c>`
      block. Add a comment that it must stay in sync with the Node mount. deploy.sh already installs
      this file into Apache conf.d on every deploy (step 5b) — no deploy.sh change needed; confirm by
      reading step 5b.
      Files: `4astore-v2/deploy/4astore-og.conf`.
      Verify: `apachectl configtest`-style syntax is not runnable in the worktree; instead confirm by
      reading the file that the new rule is well-formed and inside the mod_rewrite block, and record
      that live verification happens post-deploy (see Documentation below). `npm run build` (api-node)
      still compiles (unchanged).

## FEATURE 2 — frontend: admin Links UI + product-page Share button

- [ ] 11. Add web admin client functions in `web/src/lib/admin.ts`: `fetchShortLinks()`
      (`GET /admin/links`), `createShortLink(input)` (`POST /admin/links`), and
      `fetchProductShortLink(id)` (`GET /products/:id/short-link`). Follow the existing
      `api.get/api.post(...).data` pattern in that file. Add the `ShortLink` TS type.
      Files: `web/src/lib/admin.ts` (+ `web/src/types.ts` if the type lives there).
      Verify: `npm run build` (web) compiles.

- [ ] 12. Add an admin "Links" page `web/src/pages/admin/AdminLinks.tsx`: a table (code, target,
      type, clicks, created_at) with Copy and Open buttons per row, and a "Create link" form (target
      URL + optional custom code, validate uniqueness via the 409 from the API). Reuse the toast
      (`showToast`) + react-query patterns seen in `AdminMarketing.tsx` / `AdminProducts.tsx`. Register
      the route in `web/src/App.tsx` under the `/admin` shell (`<Route path="links" element={<AdminLinks/>} />`)
      beside the other admin routes, and add a nav entry wherever the admin menu is defined
      (follow how `marketing` is linked).
      Files: `web/src/pages/admin/AdminLinks.tsx`, `web/src/App.tsx`, admin nav/menu file.
      Verify: `npm run build` (web) compiles.

- [ ] 13. Add the Share button to `web/src/pages/ProductDetails.tsx`. Near the price/CTA block, add a
      clean bilingual "Share / शेयर" button that: resolves the share URL = the product's SHORT link
      `https://4astore.com/link/<code>` (via `fetchProductShortLink(product.id)`) else canonical
      `https://4astore.com/product/<id>`; if `navigator.share` exists, calls it with
      `{ title, text: shortCaption, url }`; else shows "Share on WhatsApp"
      (`https://wa.me/?text=<caption + url>`, reuse `web/src/lib/whatsapp.ts` if it exposes a helper)
      and "Copy link" (`navigator.clipboard.writeText`). Keep styling consistent with the existing
      inline-styled buttons on the page.
      Files: `web/src/pages/ProductDetails.tsx`.
      Verify: `npm run build` (web) compiles.

## Final verification + documentation (record for the reviewer)

- [ ] 14. Full build + validate, then document the runtime checks.
      Files: none (verification).
      Verify / record:
      - `cd api-node && npm run build` passes; `npx prisma validate` passes (note TLS-copy fallback
        if the client was copied from the main checkout).
      - `cd web && npm run build` passes.
      - Document the post-deploy runtime checks that CANNOT run in the worktree (mark as
        "needs verification during implementation / post-deploy"):
        1. `curl -A 'WhatsApp/2.0' https://4astore.com/link/<code> | grep og:image` → shows the
           product image (crawler branch reuses `buildProductShareHtml`).
        2. `curl -A 'Mozilla/5.0' https://4astore.com/link/<code>` → returns the smart-redirect HTML
           (Android app-open + Play Store fallback id `com.store4a.app`; `<meta refresh>` to website).
        3. A desktop browser hitting `/link/<code>` lands on the website product page.
        4. The product page Share button appears and shares the short link.
        5. Creating a product (single + bulk) auto-creates a `short_links` row (idempotent).

## Notes / gaps (reasonable assumptions)

- "Bulk upload" in the user request maps to the existing `importProducts()` import path; there is no
  separate admin CSV/URL bulk-upload UI in the codebase. Auto-create is wired into both the single
  admin create and `importProducts()`. The "create a link for ANY url" requirement is satisfied by
  the admin Links "Create link" form (`createCustomShortLink`), which covers arbitrary URLs.
- Apache `configtest` and live curl checks cannot run in the worktree; they are recorded as
  post-deploy verification. Everything else is verified by the real `npm run build` / `prisma validate`.
