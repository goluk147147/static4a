# Admin-fixes verification note

Branch: `admin-fixes` (worktree `c:\xampp\htdocs\static4a\.worktrees\admin-fixes`).
Three independent admin-panel bugs. All edits are minimal/surgical. No new deps, no schema change,
no POS / SEO-OG / short-link / marketing / public-catalog-cache code touched.

## Review-artifact note
`.agents/tasks/review.json` + `review.md` present in this worktree describe an UNRELATED task
("Forgot Password flow + social login on the web Login page", verdict APPROVED, `reviewDoc` points at
a different worktree `web-login-forgot-social`). They are not a review of these admin fixes and carry
no actionable findings for this task, so this was implemented as a first iteration against `plan.md`.

## Files changed (code)
- `4astore-v2/api-node/src/routes/catalog.ts` — BUG 1
- `4astore-v2/web/src/pages/admin/AdminUsers.tsx` — BUG 2
- `4astore-v2/api-node/src/routes/orders.ts` — BUG 3a
- `4astore-v2/api-node/src/routes/admin.ts` — BUG 3a
- `4astore-v2/web/src/pages/admin/adminData.ts` — BUG 3b

---

## BUG 1 — Out-of-stock shows immediately in admin (write → store → read → render)
Root cause confirmed by reading: the admin products list renders the correct field and already
refetches; the stale window was the server caching the catalog version for 10s.

- WRITE: `admin.ts POST /products` persists Zod `inStock` → column `in_stock`, then calls
  `bumpCatalogVersion()` (increments `app_version.catalog_version`). Correct, unchanged.
- STORE: DB column `in_stock` (boolean) + `app_version.catalog_version`. Unchanged.
- READ: web `AdminProducts` → `useProducts()` → `GET /api/products` (public catalog). The handler
  builds ETag `"cat-v<version>"` from `catalogVersion()` and returns 304 when `If-None-Match` matches.
- RENDER: `AdminProducts.tsx:141` renders `p.in_stock ? 'stock-in'/'In Stock' : 'stock-out'/'Out'`;
  edit modal maps `inStock: p?.in_stock !== false`. Confirmed correct — render field NOT changed.
- FIX (`catalog.ts`): `catalogVersion()` no longer goes through the 10s `ttlCache`; it reads
  `SELECT catalog_version FROM app_version WHERE id=1` directly each call (same try/catch → fallback 1).
  So after an admin stock toggle, `bumpCatalogVersion()`'s new value is visible on the very next
  `/products` request → ETag flips `cat-v<n>`→`cat-v<n+1>` → admin's refetch gets a fresh 200 with the
  new `in_stock` instead of a stale 304 for up to ~10s. The public ETag/304 revalidation scheme itself
  is unchanged (storefront still revalidates cheaply; it just picks up the edit on the next request).
- The `/config` and `/settings` 10s `cached(...)` entries are untouched; `serveCatalogConditional`,
  `CATALOG_CACHE`, `STATIC_CACHE` unchanged. The `cached` helper is still used (config/settings), so no
  unused-symbol regression.

## BUG 2 — Orders AND Users newest-first (descending, last created on top)
- Orders API (`orders.ts GET /`): staff branch uses `orderBy: { id: 'desc' }` on BOTH the keyset/cursor
  path and the unpaginated path. ✓ (no change)
- Web Orders UI (`AdminOrders.tsx:149`): slices in received order, no client re-sort. ✓ (no change)
- Mobile Orders (`mobile/app/admin/orders.tsx` → `useAllOrders` `limit:50` → keyset id desc): no re-sort,
  no mobile file changed. ✓
- Users API (`admin.ts GET /users:368`): `orderBy: { id: 'desc' }`. ✓ (no change)
- Users UI DEFECT FIXED (`AdminUsers.tsx:160`): removed the client ascending re-sort
  `.sort((a,b) => Number(a.id) - Number(b.id))` that was overriding the API order. The `users` memo now
  only filters out STAFF roles and preserves the API's `id desc` (newest-first) order. Staff filter and
  `useMemo` kept. One-line behavioural fix; ordering is now explicit/correct at API (id desc) and UI
  (trusts API, no re-sort).

## BUG 3 — Admin data fresh, not cached/stale
API no-store (admin GET JSON only):
- `orders.ts` staff list branch: `res.setHeader('Cache-Control', 'no-store')` set once at the top of the
  `if (staff && !mobile)` block, so it covers BOTH returns (`{ orders, nextCursor }` and `{ orders }`).
  The customer `?mobile=` branch and every other route are untouched.
- `admin.ts GET /users`: `res.setHeader('Cache-Control', 'no-store')` before `ok(res, …)`.
- These prevent browser/Cloudflare from serving stale admin JSON (Express would otherwise attach a weak
  body ETag). Public catalog headers (`no-cache, must-revalidate` on /products|/categories, `public,
  max-age=30` on /settings|/config|/announcement|/version) are NOT changed.

Web react-query freshness (admin only):
- `adminData.ts useAdminUsers`: added `staleTime: 0` + `refetchOnWindowFocus: true` so role/delivery/new-
  rider edits appear within seconds on mount/focus without adding a poll.
- `useAdminOrders` left as-is (already polls 7s). Public `useProducts`/`useCategories` in `lib/queries.ts`
  left as-is (already `staleTime:0` + focus refetch; shared with storefront).
- `persistCache.ts` only snapshots public single-segment keys — admin lists are never served from
  localStorage. No change needed.

---

## Build / typecheck evidence
- **web** (`4astore-v2/web`): `npm install` then `npm run build` → generate-sitemap + `tsc -b` + `vite build`
  completed, **exit 0** (722 modules; only the pre-existing vendor chunk-size >500kB warning). The
  regenerated `public/sitemap.xml` is a build artifact and was reverted (not committed).
- **api-node** (`4astore-v2/api-node`): `npm install` then `npm run build` (`tsc -p tsconfig.json`).
  The Prisma engine CDN is blocked in this env, so a fresh install cannot `prisma generate` a typed
  client; `prisma.<model>` delegates fall back to untyped and tsc reports 155 pre-existing
  `TS2347 / TS7006` errors spread across unrelated files (seo, video, push, dataImport, etc.). This is
  the documented env limitation.
  - **No-new-error proof**: building with my three api-node edits STASHED produced **155** errors; building
    with them APPLIED produced **155** errors — identical. My changes add ZERO new TypeScript errors.
  - None of the 155 errors reference the lines I added: the `res.setHeader(...)` lines (orders.ts,
    admin.ts) and the un-wrapped `catalogVersion()` body (catalog.ts) are plain Express/`$queryRawUnsafe`
    calls with no new type surface. The errors shown inside those files are the same pre-existing
    untyped-`prisma` `TS2347` lines present on baseline.
  - For reference, `main` with its already-generated (older) Prisma client builds with only 8 errors, all
    `Property 'shortLink' does not exist` (a newer migration not in that generated client) — unrelated to
    these fixes and not in any touched file.
- **mobile**: no mobile source changed, so per the plan `npx tsc --noEmit` was not required and was not run.

## Scope / safety
Only the five code files above (+ the pre-existing `plan.md`) are modified. No POS/inventory, SEO/OG,
short-link, or marketing code touched. No dependencies added. No Prisma schema change. Public storefront
instant-catalog ETag caching preserved.
