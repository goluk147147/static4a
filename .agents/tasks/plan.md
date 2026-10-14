# Implementation Plan — Admin Panel: Out-of-Stock Freshness, Newest-First Lists, No Stale Data

Three small, surgical admin-panel bug fixes in the 4A Store v2 worktree. Keep diffs minimal.
Another branch (pos-billing) is adding POS/inventory columns, so do NOT touch POS files, SEO/OG,
short-link, or marketing code. Do NOT alter the public catalog ETag cache behaviour for the
storefront. No new dependencies. No schema changes.

## Worktree (all paths absolute, inside the worktree — never the main checkout)

- Root: `c:\xampp\htdocs\static4a\.worktrees\admin-fixes\4astore-v2`
- api-node: `…\4astore-v2\api-node` — Express + Prisma + MySQL, TS. Build: `npm run build` (= `tsc -p tsconfig.json`). No test script, no test suite.
- web: `…\4astore-v2\web` — React + Vite + TS admin. Build: `npm run build` (= generate-sitemap + `tsc -b` + `vite build`). No test/lint script.
- mobile: `…\4astore-v2\mobile` — Expo RN + TS. Typecheck: `npx tsc --noEmit`. Tests: `npm test` (node test runner). Do NOT run expo prebuild / build any native binary/AAB.

Verification across this task is **the project build / typecheck** (there is no unit-test suite for
these modules) plus a **manual admin-UI walkthrough on a running dev server**, because every bug is
about live request/response + render behaviour, not pure logic.

---

## Ground truth established during exploration (read this before editing)

### Data model (api-node/prisma/schema.prisma — DO NOT CHANGE)
- `model Product` — stock is a single boolean `in_stock Boolean @default(true)`; autoincrement `id`. There is an index `idx_products_instock`. There is NO `available` / `stock` / `out_of_stock` / `status` column.
- `model Order` — `order_date DateTime`, `created_at DateTime @default(now())`, autoincrement `id`. Because `id` is monotonic autoincrement, `orderBy: { id: 'desc' }` == newest-created first.
- `model User` — `registered_at DateTime?`, `created_at DateTime @default(now())`, autoincrement `id`. `orderBy: { id: 'desc' }` == newest first.

### BUG 1 — write/store/read/render trace (CONFIRMED)
- WRITE: `api-node/src/routes/admin.ts` → `POST /products` (action add/update). The Zod field `inStock` (default true) is persisted to column `in_stock`. After the write it calls `bumpCatalogVersion()` (increments `app_version.catalog_version`). **Write is correct.**
- READ (admin list): the web admin products page reads the **PUBLIC** `GET /api/products` in `api-node/src/routes/catalog.ts` (via web `useProducts()` → `api.get('/products')`). There is no separate admin products-read endpoint.
- RENDER: `web/src/pages/admin/AdminProducts.tsx` renders the stock badge from `p.in_stock` (`<span className={... p.in_stock ? 'stock-in' : 'stock-out'}>{p.in_stock ? 'In Stock' : 'Out'}</span>`) and the edit modal maps `inStock: p?.in_stock !== false`. **Render field is correct.** (So "UI reads wrong field" is NOT the cause — do not change the render field.)
- ROOT CAUSE = STALENESS via the catalog-version cache: `GET /products` builds an ETag `"cat-v<version>"` and returns **304 Not Modified** when the client's `If-None-Match` matches. The version is read by `catalogVersion()` which is wrapped in the in-memory **10-second `ttlCache`** (`TTL_MS = 10_000`, key `'catalog_version'`). So right after an admin toggles stock, `bumpCatalogVersion()` has incremented the DB column, but `catalogVersion()` keeps returning the OLD cached number for up to ~10s → ETag unchanged → the admin's refetch gets a 304 → the list still shows the old `in_stock` for up to ~10s. This is the actual "still shows in stock" window, and it is the same mechanism as BUG 3.
- Note: web `useProducts()` already has `staleTime: 0` + `refetchOnWindowFocus: true` and `AdminProducts.save()`/`remove()` call `qc.invalidateQueries(['products'])`, so the client DOES refetch immediately — it is the server-side 304 (from the stale cached version) that returns stale data.

### BUG 2 — ordering (CONFIRMED, one real defect)
- Orders API: `api-node/src/routes/orders.ts` `GET /` staff path uses `orderBy: { id: 'desc' }` on BOTH the unpaginated branch and the keyset/cursor branch. ✓
- Web Orders UI: `web/src/pages/admin/AdminOrders.tsx` uses `useAdminOrders()` (`web/src/pages/admin/adminData.ts`, key `['admin-orders']`, `api.get('/orders')`) and does NOT re-sort — it slices for pagination in received order. ✓ (needs a quick runtime confirm it shows newest on top.)
- Mobile Orders UI: `mobile/app/admin/orders.tsx` uses `useAllOrders` (`mobile/src/queries.ts`, `limit:50` → keyset `id desc`), no client re-sort. ✓
- Users API: `api-node/src/routes/admin.ts` `GET /users` uses `orderBy: { id: 'desc' }`. ✓
- **Web Users UI DEFECT:** `web/src/pages/admin/AdminUsers.tsx` re-sorts the API result ASCENDING, overriding the API order:
  `const users = useMemo(() => allUsers.filter((u) => !STAFF.includes(u.role)).sort((a, b) => Number(a.id) - Number(b.id)), [allUsers]);`
  The `.sort((a,b) => Number(a.id) - Number(b.id))` forces oldest-first. This is the Users "not newest-first" root cause.
- Mobile Users: `mobile/app/admin/roles.tsx` is an assign-by-mobile FORM with no user list — nothing to sort. (`mobile/app/admin/` has only `orders.tsx`, `roles.tsx`, `order/[id].tsx` — NO admin product-stock screen, so BUG 1 is web-only for the admin UI.)

### BUG 3 — freshness (CONFIRMED gaps)
- Admin GET endpoints set NO `Cache-Control` header today:
  - `GET /api/orders` (staff list) in `orders.ts` — no cache header.
  - `GET /api/admin/users` in `admin.ts` — no cache header.
  Express then adds a weak ETag off the JSON body; a browser/Cloudflare may serve stale admin JSON. Admin JSON must be `no-store`.
- React Query freshness:
  - Web global default (`web/src/main.tsx`): `staleTime: 60_000`, `refetchOnWindowFocus: false`.
  - `useAdminOrders` already polls every 7s (`refetchInterval: 7000`, `refetchIntervalInBackground: true`). Good enough for orders freshness; leave the interval as-is (do not hammer harder).
  - `useAdminUsers` (`['admin-users']`) has NO freshness override → inherits `staleTime 60_000` + no focus refetch. Edits (role/delivery/new rider) only show via explicit `invalidateQueries(['admin-users'])`; a stale window remains on navigation/focus. Needs `staleTime: 0` + `refetchOnWindowFocus: true` (and mount refetch, which `staleTime:0` gives).
  - `useProducts` / `useCategories` (web `lib/queries.ts`) already have `staleTime: 0` + `refetchOnWindowFocus: true`. Do NOT change these (shared with storefront).
- `web/src/lib/persistCache.ts` only snapshots PUBLIC single-segment keys (`products`, `categories`, `config`, `settings`, `pages`) — it does NOT persist `admin-orders`/`admin-users`, so no admin list is served from localStorage. No change needed there.
- Mobile admin (`useAllOrders`) already polls 7s + `retry:false`; mobile has no admin users/products list. No mobile freshness change required (verify only).
- The public catalog ETag path (`serveCatalogConditional`, `CATALOG_CACHE`, `/products`, `/categories`, `/config`, `/settings`, `/version`, `/announcement` in `catalog.ts`) and the `STATIC_CACHE` public headers MUST stay intact.

---

## Design decisions (chosen approach + rationale)

1. **BUG 1 fix lives on the server at the catalog-version source, not in the UI.** The render field and client refetch are already correct; the stale window is the 10s-cached `catalog_version`. Rationale: a one-line change that makes the version read reflect writes immediately fixes admin out-of-stock display AND keeps the public ETag/304 scheme working (storefront still revalidates cheaply; it just picks up the new version on the next request instead of up to 10s later). Chosen fix: **stop caching the `catalog_version` read behind the 10s `ttlCache`** — read it directly (it is a single tiny indexed `SELECT … WHERE id=1`, far cheaper than the product/category queries it gates, and only runs on `/products` + `/categories`). This is strictly less code than alternatives (e.g. clearing the cache key inside `bumpCatalogVersion`, which is cross-file and racier). The `/config` and `/settings` 10s caches are untouched.

2. **BUG 2 (Users) fix = remove the client ascending re-sort**, keep the server `id desc` as the single source of truth. Rationale: the task says make ordering explicit/correct at API and UI and not rely on insertion order — the API is already explicit (`id desc`); the only thing fighting it is the UI `.sort`. Removing the sort makes the UI render in the API's newest-first order. (Keep the `STAFF` filter and `useMemo`.) Orders need no code change (already correct) — only runtime verification.

3. **BUG 3 fix = `no-store` on admin GETs + `staleTime:0`/focus-refetch on the admin-users query.** Rationale: smallest change that guarantees neither the browser nor Cloudflare caches admin JSON and that the admin-users list refetches on mount/focus like admin-orders already effectively does via polling. Add the header inline per admin GET handler (two handlers) rather than a new middleware, to keep the diff minimal and avoid touching shared mount order in `server.ts`.

**Decision on workflow restructuring:** NOT decomposing into FEAT artifacts / not restructuring the
workflow tail. These are three tiny, interdependent edits (BUG 1 and BUG 3 share the catalog-version
cache; all touch the same two or three files) with no separable feature boundaries and no test suites
to parallelize. The existing implement-and-review loop running this single plan is the right vehicle.

---

## Items (ordered by dependency; each leaves the tree buildable)

- [ ] 1. BUG 1 — make the catalog version reflect writes immediately (fixes admin out-of-stock staleness without breaking the public ETag scheme).
      In `catalog.ts`, change `catalogVersion()` so it does NOT go through the 10s `ttlCache`: read `app_version.catalog_version` directly each call (keep the same try/catch fallback to `1` when the column/row is absent). Leave `serveCatalogConditional`, `CATALOG_CACHE`, `STATIC_CACHE`, the `/config` and `/settings` `cached(...)` calls, and the ETag/304 logic exactly as-is.
      Files: `c:\xampp\htdocs\static4a\.worktrees\admin-fixes\4astore-v2\api-node\src\routes\catalog.ts`
      Verify: in `…\api-node` run `npm run build` → exits 0 (tsc clean). Runtime walkthrough on a running api + web dev server: in the web admin Products page, edit a product and set **Out of Stock**, Save; the row's Stock badge must flip to **Out** within ~1–2s (not after ~10s), and a hard refetch (focus/switch tab back) of the admin list must still show **Out**. Then flip back to In Stock and confirm it shows **In Stock** promptly. Confirm the public storefront `/products` still returns 304 on an unchanged `If-None-Match` and fresh data after an edit (ETag changes from `cat-v<n>` to `cat-v<n+1>`).

- [ ] 2. BUG 1 (verification only) — confirm admin products READ path and render field are the correct ones.
      No code change expected. Confirm `AdminProducts.tsx` reads via `useProducts()` and renders `p.in_stock`, and that `saveProduct` → `invalidateQueries(['products'])` runs. If (and only if) runtime shows the badge still wrong AFTER item 1 and a confirmed fresh (`200`, new ETag) response that contains the correct `in_stock` value, THEN investigate a render/normalize mismatch — but do not pre-emptively change the render field; the field is confirmed correct by reading. Mark this item done once the item-1 walkthrough shows correct out-of-stock display.
      Files: (none expected) `c:\xampp\htdocs\static4a\.worktrees\admin-fixes\4astore-v2\web\src\pages\admin\AdminProducts.tsx` (read-only confirm)
      Verify: covered by item 1's walkthrough — out-of-stock shows immediately in the admin list and detail/edit modal.

- [ ] 3. BUG 2 — Users list newest-first in the web admin (remove the client ascending re-sort).
      In `AdminUsers.tsx`, change the `users` memo to stop re-sorting ascending. Keep the staff filter and `useMemo`; drop the `.sort((a, b) => Number(a.id) - Number(b.id))` so the API's `id desc` (newest-first) order is preserved. i.e. `const users = useMemo(() => allUsers.filter((u) => !STAFF.includes(u.role)), [allUsers]);` (If a stable tiebreak is ever wanted, sort DESCENDING `Number(b.id) - Number(a.id)` — but prefer simply trusting the API order to keep the diff one line.)
      Files: `c:\xampp\htdocs\static4a\.worktrees\admin-fixes\4astore-v2\web\src\pages\admin\AdminUsers.tsx`
      Verify: in `…\web` run `npm run build` → exits 0. Runtime: open the web admin Users tab; the most recently registered user appears at the TOP of page 1. Create a new rider via "New Delivery Boy" and confirm it appears at the top after the list refreshes (see item 5 freshness).

- [ ] 4. BUG 2 (verification only) — confirm Orders are newest-first end-to-end (web + mobile); fix only if a re-sort is found.
      No code change expected. Web `AdminOrders` (`useAdminOrders` → `/orders`) and mobile `useAllOrders` (`/orders?limit=50`) both consume the API's `id desc` order with no client re-sort. Confirm at runtime. If a client re-sort to ascending is discovered in either, remove it the same way as item 3 (trust API `id desc`). The API handlers in `orders.ts` already use `orderBy: { id: 'desc' }` — do not change them.
      Files: (none expected) `…\web\src\pages\admin\AdminOrders.tsx`, `…\mobile\app\admin\orders.tsx` (read-only confirm)
      Verify: web admin Orders page page-1 shows the most recent order on top; place/admin-create a new order and confirm it lands at the top on next refetch. Mobile `npx tsc --noEmit` stays clean (no change) and, if runnable, the staff Orders screen shows newest first.

- [ ] 5. BUG 3 — stop browser/edge caching of admin JSON and make the admin-users list refetch fresh.
      (a) API no-store headers on the two admin GETs:
         - In `orders.ts`, in the staff list branch of `GET /` (both the paginated `{ orders, nextCursor }` return and the unpaginated `{ orders }` return), set `res.setHeader('Cache-Control', 'no-store')` before responding. Scope strictly to the staff branch; leave the customer `?mobile=` branch and all other routes untouched.
         - In `admin.ts`, in `GET /users`, set `res.setHeader('Cache-Control', 'no-store')` before `ok(res, …)`.
      (b) Web react-query freshness for the admin-users list: in `web/src/pages/admin/adminData.ts`, add `staleTime: 0` and `refetchOnWindowFocus: true` to `useAdminUsers` (mirrors `useAdminOrders` freshness without adding a poll). Do NOT change `useAdminOrders` (already polls 7s) and do NOT change the public `useProducts`/`useCategories` in `lib/queries.ts`.
      Files: `c:\xampp\htdocs\static4a\.worktrees\admin-fixes\4astore-v2\api-node\src\routes\orders.ts`, `c:\xampp\htdocs\static4a\.worktrees\admin-fixes\4astore-v2\api-node\src\routes\admin.ts`, `c:\xampp\htdocs\static4a\.worktrees\admin-fixes\4astore-v2\web\src\pages\admin\adminData.ts`
      Verify: `npm run build` in `…\api-node` and in `…\web` → both exit 0. Runtime: in browser devtools Network, the responses for `GET /api/orders` (staff) and `GET /api/admin/users` carry `Cache-Control: no-store`. Edit a user (role/delivery) or create a rider; switch tabs away and back — the admin Users list refetches and shows the change within a couple seconds without a manual reload. Confirm public `GET /api/products|/categories|/settings|/config` headers are unchanged (`no-cache, must-revalidate` / `public, max-age=30`).

- [ ] 6. Full build gate + regression confirmation across all three projects.
      Run every project's build/typecheck and do a final admin walkthrough covering all three bugs together. Fix any TypeScript error introduced by items 1,3,5. Confirm nothing in POS/SEO/OG/short-link/marketing or the public catalog cache path was touched.
      Files: (whole worktree — no new edits unless a build error surfaces)
      Verify:
        - `…\api-node`: `npm run build` → exit 0.
        - `…\web`: `npm run build` → exit 0.
        - `…\mobile`: `npx tsc --noEmit` → exit 0 (no mobile source changed; this guards against accidental edits). Do NOT run expo prebuild / assembleRelease / bundleRelease.
        - Combined runtime: out-of-stock shows immediately in admin Products; admin Users and Orders both show newest-first on top; admin JSON responses are `no-store` and the lists update within seconds of an edit.

## Notes / assumptions

- No api-node/web unit-test suite exists for these modules (no `test` script, no test dir), so verification is a clean build/typecheck plus the runtime admin walkthrough — the review loop exercises the UI. This matches how the repo validates web/api changes.
- "Data update frequently, not cached" is satisfied by `no-store` on admin GETs + `staleTime:0`/focus-refetch (admin-users) and the already-present 7s poll (admin-orders). We intentionally do NOT lower polling intervals further, to avoid hammering the server (per the constraint).
- The public storefront's instant-catalog ETag cache is preserved; item 1 only removes the 10s *version-number* cache so the ETag reflects an edit on the very next request (the 304 revalidation scheme itself is unchanged).
- All three bugs are confirmed by reading except the pure runtime behaviours flagged "verification only" (items 2 & 4) and the live header/refetch checks — the coder must verify those on a running dev server and fix only if confirmed broken, never dismiss from reading alone.
