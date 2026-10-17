# Implementation Plan — Product Publish/Unpublish Status

Goal: Admins get a publish/unpublish status control per product. New products default to `draft` (hidden from the storefront); the public storefront shows only `published` products; publishing is blocked (server-authoritative) when required fields are missing. Follows the repo's ADD-only / no-migrate runtime-column convention exactly.

All paths are absolute and INSIDE the worktree:
`c:\xampp\htdocs\static4a\.worktrees\product-publish-status\4astore-v2\...`

## Key design decisions (grounded in the code I read)

1. **Status model.** `status VARCHAR(16) NOT NULL DEFAULT 'published'` on `products`. Existing live rows stay visible after deploy (column default). Only NEW creates via the admin `add` action default to `draft`. Values are constrained to `'draft' | 'published'` at the API layer (zod enum), not by a DB CHECK (matches the repo — no CHECK constraints used; `track_inventory` etc. are plain columns).

2. **No Prisma migrate.** Added two ways, mirroring `max_qty_per_order`: (a) documented on `model Product` in `schema.prisma` with an `@@index`; (b) created at runtime by a new idempotent `ensureProductStatusColumn()` in `dataImport.ts`, wired into `server.ts` boot. The Prisma client is NOT regenerated here, so `status` is written in `create`/`update` `{ data }` exactly like `max_qty_per_order`/`featured` already are (plain object property; Prisma accepts it against the live column).

3. **Admin vs storefront read path — the pivotal decision.** I confirmed by reading the code that `AdminProducts.tsx` reads products through `useProducts()` (`web/src/lib/queries.ts`), which calls the PUBLIC `GET /api/products` endpoint (`api-node/src/routes/catalog.ts`). There is NO admin-only product-list endpoint (verified: the only `/products` GET routes are in `catalog.ts`). Therefore, if I simply filter drafts out of `GET /api/products`, the admin can no longer see or publish draft products.

   Rejected option: apply `optionalAuth` to `GET /api/products` and return drafts only to staff. Rejected because that endpoint sets a shared `ETag: "cat-v<version>"` with `no-cache, must-revalidate` (see `serveCatalogConditional` in `catalog.ts`); the ETag does NOT vary by auth, so a staff request and an anonymous request would collide in any shared/conditional cache — an anonymous client could receive a 304 for (or a cached copy of) a body that included drafts. That is a storefront-leak risk and is not acceptable.

   Chosen option: keep the public `GET /api/products` and `GET /api/products/:id` filtered to `published` (no auth, caching behaviour unchanged), and add a dedicated admin-scoped list `GET /api/admin/products` (`requireStaff('products')`, `Cache-Control: no-store`) that returns ALL products including drafts, with `status` included. Point ONLY `AdminProducts.tsx` at it via a new `useAdminProducts()` hook so it can display status and publish drafts. Other admin pages that read `useProducts()` (dashboard/marketing/etc.) continue to see published-only, which is acceptable (they promote/sell live products).

4. **`status` in `PUBLIC_PRODUCT_SELECT`?** NO. The task prefers not adding owner-workflow fields to the public payload, and the public endpoints only need to FILTER by status (`where: { status: 'published' }`), which does not require selecting it. Keeping `status` out of `PUBLIC_PRODUCT_SELECT` means the leakage test's asserted shape is unchanged and `FORBIDDEN_PUBLIC_PRODUCT_FIELDS` semantics stay intact. The admin list endpoint uses its own explicit select (NOT `PUBLIC_PRODUCT_SELECT`) that adds `status`, so admins see it. **No change to `catalog-leak.test.ts` is required**, and it must stay green.

5. **Publish guard (server-authoritative).** In `admin.ts`, before writing `status: 'published'` (on both `add` with an explicit publish and `update`), validate: non-empty `name`, `price > 0`, non-empty `category`, non-empty `image`. If publish is requested with missing fields, return HTTP 422 with a short bilingual message listing what's missing (e.g. `Publish ke liye ye zaroori hain / Required to publish: price, image`). The client mirrors a lightweight check before calling publish and handles the server 422 gracefully.

6. **Status normalization on the client.** `status` comes back as a plain string. `AdminProducts.tsx` treats any value other than `'draft'` as published-equivalent for display? NO — be explicit: `published` badge when `status === 'published'`, otherwise `draft` badge. The admin list endpoint always returns a concrete `status` string.

## Build / test commands (from the real package.json files)

- Backend (`api-node`): build `npm run build` (`tsc -p tsconfig.json`); tests `npm test` (`node --import ./src/__tests__/register.mjs --test "src/__tests__/**/*.test.ts"`). Single test file: `node --import ./src/__tests__/register.mjs --test "src/__tests__/catalog-leak.test.ts"`. NOTE: `npm install` must have been run in the worktree first (it has now been run; baseline tests pass).
- Frontend (`web`): build `npm run build` (`node scripts/generate-sitemap.mjs && tsc -b && vite build`). There is NO unit-test script; type-check via the build (`tsc -b`) is the verification. `npm install` must have been run in `web` first.

## Ordered implementation items

- [ ] 1. Add the `status` column to the Prisma schema (documentation mirror) and a runtime ensure function, wired into boot.
      Add to `model Product` in `api-node/prisma/schema.prisma` (near `max_qty_per_order`): `status String @default("published") @db.VarChar(16)` and an index `@@index([status], map: "idx_products_status")`, with a short comment matching the `max_qty_per_order` comment style (runtime-added, no migrate). Add `ensureProductStatusColumn()` to `api-node/src/services/dataImport.ts` modeled exactly on `ensureProductMaxQtyColumn()`: information_schema-guarded `ALTER TABLE products ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'published'` swallowing MySQL 1060, then idempotently add index `idx_products_status` via the statistics-guarded `CREATE INDEX` pattern (swallow 1061) used in `ensureProductInventoryColumns()`. Export it, and in `api-node/src/server.ts` add it to the `dataImport` import list and call `ensureProductStatusColumn().catch(...)` in the boot block beside `ensureProductMaxQtyColumn()`.
      Files: `api-node/prisma/schema.prisma`, `api-node/src/services/dataImport.ts`, `api-node/src/server.ts`
      Verify: `npm run build` in `api-node` compiles clean.

- [ ] 2. Extend the admin product schema + write path, and enforce the publish guard, in `admin.ts`.
      In `api-node/src/routes/admin.ts`: add `status: z.enum(['draft','published']).optional()` to `productSchema`. Add a helper `missingPublishFields(d)` returning the list of empty required fields (`name` empty, `price <= 0`, `category` empty, `image` empty). In the `add`/`update` handler compute the effective status: for `add`, `p.status ?? 'draft'`; for `update`, only include `status` in `data` when `p.status` is provided (leave unchanged otherwise). When the effective write sets `status === 'published'`, run `missingPublishFields` against the resolved values and, if non-empty, `return res.status(422)` with a short bilingual message listing them (reuse the `fail(res, msg, 422)` helper). Add `status` to the `data` object passed to `prisma.product.create`/`update` (only for update when provided). Keep `bumpCatalogVersion()` + the SEO/short-link fire-and-forget calls unchanged.
      Files: `api-node/src/routes/admin.ts`
      Verify: `npm run build` in `api-node` compiles clean.

- [ ] 3. Add the admin-scoped product list endpoint `GET /api/admin/products`.
      In `api-node/src/routes/admin.ts` add `router.get('/products', requireAuth, requireStaff('products'), ...)` that sets `Cache-Control: no-store` and returns `prisma.product.findMany({ orderBy: { id: 'asc' }, select: {...} })` where the select is an explicit allow-list that mirrors `PUBLIC_PRODUCT_SELECT` PLUS `status: true` (admins may see owner fields too, but to minimise surface just add the fields the admin UI needs: the same public fields + `status`). Return `ok(res, { products })`. This endpoint is the admin's source of truth and is the ONLY place drafts are listed. (Route order is fine: `admin.ts` is mounted at `/api/admin` after the specific admin sub-routers in `server.ts`, and no existing admin route collides with `GET /products`.)
      Files: `api-node/src/routes/admin.ts`
      Verify: `npm run build` in `api-node` compiles clean; grep is not sufficient — rely on compile.

- [ ] 4. Make the public catalog endpoints hide drafts.
      In `api-node/src/routes/catalog.ts`: change `GET /products` `findMany` to `{ where: { status: 'published' }, orderBy: { id: 'asc' }, select: PUBLIC_PRODUCT_SELECT }`. Change `GET /products/:id` `findUnique` to add the status check — use `findFirst({ where: { id: BigInt(req.params.id), status: 'published' }, select: PUBLIC_PRODUCT_SELECT })` (findUnique cannot take a non-unique `where`), so a draft id returns the existing 404 path. Do NOT add `status` to `PUBLIC_PRODUCT_SELECT`.
      Files: `api-node/src/routes/catalog.ts`
      Verify: `npm run build` in `api-node` compiles clean, AND `node --import ./src/__tests__/register.mjs --test "src/__tests__/catalog-leak.test.ts"` passes (shape unchanged, so it stays green). Also run the full `npm test` and confirm no regressions vs the baseline.

- [ ] 5. Add the admin API client call + the admin products query hook.
      In `web/src/lib/admin.ts` add `fetchAdminProducts()` → `GET /admin/products` returning `Product[]`. In `web/src/lib/queries.ts` add `useAdminProducts()` (queryKey `['admin-products']`, `staleTime: 0`, mapping through the existing `normalizeProduct`) so status/price normalize consistently. Add `status` normalization note: `normalizeProduct` passes `status` through unchanged (string). (Optionally extend `normalizeProduct` to coerce an unknown/empty status to `'draft'` defensively.)
      Files: `web/src/lib/admin.ts`, `web/src/lib/queries.ts`
      Verify: `npm run build` in `web` type-checks + builds clean.

- [ ] 6. Add `status` to the `Product` type.
      In `web/src/types.ts` add to `interface Product`: `status?: 'draft' | 'published';` with a one-line comment (admin publish/unpublish; public catalog only returns published, so storefront reads can treat absent as published).
      Files: `web/src/types.ts`
      Verify: covered by the `web` build in item 7.

- [ ] 7. Wire the admin UI: status badge column + per-row Publish/Unpublish button + modal field, using the admin products hook.
      In `web/src/pages/admin/AdminProducts.tsx`: (a) switch the list source from `useProducts()` to the new `useAdminProducts()` so drafts are visible. (b) Add `status` to `FormState` and `toForm` (default `'published'` for edit of an existing row; for `add`, the server will default to draft, so send no status or `'draft'`). (c) Add a Status column to the table header and a badge cell reusing the `stock-badge` styling: green "Published" when `p.status === 'published'`, gray "Draft" otherwise. (d) Add a per-row Publish/Unpublish button: draft → `🚀 Publish`, published → `⏸ Unpublish`. On Publish, first run a client-side required-field check (name, price>0, category, image) mirroring the server; if incomplete, `showToast(...)` an error and do not call the API. Otherwise call a helper `setStatus(p, next)` that does `saveProduct('update', { id: p.id, name: p.name, price: p.price, mrp: p.mrp, category: p.category, image: p.image, status: next })` then `qc.invalidateQueries({ queryKey: ['admin-products'] })` (and `['products']` so storefront caches refresh) + a bilingual success toast. Handle a server 422 by showing `apiError(e)`. (e) Add `status` to the `save()` payload so the modal can also set it (optional surface). (f) Bump the table `colSpan` for the empty-state row to match the new column count.
      Files: `web/src/pages/admin/AdminProducts.tsx`
      Verify: `npm run build` in `web` type-checks + builds clean.

- [ ] 8. Full-stack verification pass.
      Backend: `npm run build` + `npm test` in `api-node` — all tests pass (baseline was green after `npm install`), catalog-leak test green. Frontend: `npm run build` in `web` — type-check + production build succeed. Confirm no change to `catalog-leak.test.ts` was needed.
      Files: (none — verification only)
      Verify: both builds succeed and the backend test suite passes.

## Notes / assumptions
- `importProducts()` and the POS import create products without `status`; the column default `'published'` keeps imported/legacy rows visible. No change needed there.
- The admin `api` client sends the auth cookie (`extractToken` falls back to the `access_token` cookie), so `GET /api/admin/products` authenticates the existing admin session with no client auth changes.
- Bilingual, emoji-labelled toasts match the existing style in this file.
