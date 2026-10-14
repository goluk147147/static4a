# Admin panel: instant out-of-stock, newest-first lists, no stale admin data

Three surgical admin-panel bug fixes. BUG 1 makes an out-of-stock toggle show up in the admin product list immediately instead of after a ~10s window, by removing the version-number read from the 10s in-memory cache that gated the catalog ETag. BUG 2 makes the web admin Users list newest-first by dropping a client-side ascending re-sort that was overriding the API's `id desc` order (Orders were already correct end-to-end). BUG 3 adds `Cache-Control: no-store` to the two admin GET JSON endpoints and gives the admin-users react-query `staleTime: 0` + focus refetch so edits appear within seconds. The diff touches exactly five code files, adds no dependencies, and makes no schema change.

**Watch for:** nothing blocking. The one thing a reviewer should understand is that BUG 1 removes only the *version-number* cache, not the public catalog ETag/304 scheme — the storefront still revalidates cheaply, it just picks up an edit on the very next request (confirmed below). (confirmed)

**Verdict**: APPROVED

## High-level view

BUG 1's root cause was staleness, not a wrong field. The admin products page already reads the correct column (`in_stock`), renders the correct field, and invalidates its query on save. The stale window came from `catalogVersion()` being wrapped in the shared 10s `ttlCache`, so after `bumpCatalogVersion()` incremented the DB column the ETag kept matching the old value and the admin's refetch got a 304. The fix reads the version directly each call. This is one indexed single-row SELECT on `/products` and `/categories` only, and it leaves `serveCatalogConditional`, `CATALOG_CACHE`, `STATIC_CACHE`, and the `/config` + `/settings` 10s caches untouched — so the public instant-catalog ETag cache behaves exactly as before, just one request fresher.

BUG 2 was a single-line UI defect. The Users API already returns `id desc`; the web admin list re-sorted ascending on top of it. Removing the `.sort` lets the API's newest-first order through. Orders needed no code change — the API uses `id desc` on both the paginated and unpaginated staff branches, and the UI only slices for pagination in received order.

BUG 3 adds `no-store` to the admin orders staff branch and the admin users GET, scoped so the customer `?mobile=` order path and every other route keep their existing headers. The admin-users query gets `staleTime: 0` + `refetchOnWindowFocus: true` to match the freshness admin-orders already gets from its 7s poll; admin-orders and the shared public `useProducts`/`useCategories` are deliberately left alone.

The change stays inside its lane: no POS/inventory, SEO/OG, short-link, or marketing files, no new deps, no Prisma schema change. Build evidence is recorded in the verification note (web `npm run build` exit 0; api-node has 155 pre-existing env-blocked Prisma errors that are identical with the changes stashed vs applied, i.e. zero new errors).

<details>
<summary>Issues (0)</summary>

No blocking or non-blocking actionable findings. All three fixes match the plan, are surgical, and preserve the public catalog cache.

</details>

<details>
<summary>Details</summary>

### BUG 1 — out-of-stock now reflects on the next catalog request, not up to 10s later

The write/store/read/render path checks out end to end. The write in `admin.ts` persists the Zod `inStock` field (default true) to column `in_stock` (`in_stock: p.inStock`) and calls `bumpCatalogVersion()` after every product/category mutation. The admin products page reads through the public `GET /api/products` via `useProducts()`, and renders the badge from `p.in_stock` (`p.in_stock ? 'In Stock' : 'Out'`) with the edit modal mapping `inStock: p?.in_stock !== false`. So the field is correct on both ends — the bug was never a wrong field, and the diff correctly leaves the render field alone. (confirmed)

The actual defect was the ETag going stale. `GET /products` builds `"cat-v<version>"` from `catalogVersion()`; before this change that read was wrapped in the shared 10s `ttlCache`. After a stock toggle, `bumpCatalogVersion()` had already incremented the DB column, but `catalogVersion()` kept returning the cached old number for up to ~10s, so the ETag didn't change and the admin's refetch — which already runs with `staleTime: 0` and query invalidation — got a 304 with stale `in_stock`. The fix unwraps the read:

```ts
async function catalogVersion(): Promise<number> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ catalog_version?: unknown }>>(
      'SELECT catalog_version FROM app_version WHERE id = 1'
    );
    const v = Number(rows[0]?.catalog_version);
    return Number.isFinite(v) && v > 0 ? v : 1;
  } catch {
    return 1;
  }
}
```

The try/catch fallback to `1` (for a DB where `catalog_version` hasn't been migrated yet) is preserved. The read now reflects the bump on the very next request, so the ETag flips `cat-v<n>` → `cat-v<n+1>` and the refetch gets a fresh 200. (confirmed)

### Public catalog ETag cache is preserved

The concern with BUG 1 is whether unwrapping the version read disturbed the storefront's instant-catalog cache. It did not. `serveCatalogConditional` still sets `CATALOG_CACHE` (`no-cache, must-revalidate`) and the `"cat-v<version>"` ETag and still returns 304 on a matching `If-None-Match` — unchanged. `STATIC_CACHE` and the `/config` + `/settings` 10s `cached(...)` entries are untouched, and the `cached` helper is still referenced by those two handlers, so there's no unused-symbol regression. The only behavioral delta for the storefront is that an admin edit is visible on the next request instead of up to ~10s later — a strict freshness improvement, not a weakening of the cache. (confirmed)

### BUG 2 — Users newest-first by trusting the API order; Orders already correct

The Users fix is one line: the `users` memo kept its STAFF filter but dropped `.sort((a, b) => Number(a.id) - Number(b.id))`, which had been forcing oldest-first on top of the API's `orderBy: { id: 'desc' }`. Ordering is now explicit at the API (`id desc`) and unmolested at the UI. (confirmed)

Orders needed no change and got none. `GET /orders` uses `orderBy: { id: 'desc' }` on both the keyset/cursor branch and the unpaginated branch, and `AdminOrders.tsx` only slices `filtered` for pagination in received order with no re-sort. Newest-first holds at both layers. (confirmed)

### BUG 3 — admin JSON is no-store, admin-users refetches fresh, catalog headers untouched

`res.setHeader('Cache-Control', 'no-store')` is set once at the top of the `if (staff && !mobile)` block in `orders.ts`, so it covers both the `{ orders, nextCursor }` and `{ orders }` returns, and is scoped away from the customer `?mobile=` branch and every other route. The same header is added to `GET /admin/users` before the response. This stops a browser or Cloudflare from serving the weak-ETag'd admin JSON. The public catalog headers are not in these handlers and are not changed. (confirmed)

On the client, `useAdminUsers` gains `staleTime: 0` + `refetchOnWindowFocus: true`, which gives mount and focus refetches so a role/delivery/new-rider edit shows within seconds without a manual reload — matching the freshness `useAdminOrders` already gets from its 7s poll. `useAdminOrders` is left as-is (no extra hammering), and the shared public `useProducts`/`useCategories` in `lib/queries.ts` are not in the diff. `persistCache.ts` is also unchanged, so no admin list is served from localStorage. (confirmed)

### Build evidence (read, not re-run)

Per the task constraints the build/typecheck suites were not re-run; the verification note is the evidence. Web `npm run build` recorded exit 0. api-node reports 155 TypeScript errors that are a documented environment limitation — the Prisma engine CDN is blocked so a fresh install can't generate a typed client — and the note proves these are pre-existing: building with the three api-node edits stashed yields 155 errors and with them applied yields 155, i.e. the changes introduce zero new errors, and none of the 155 reference the added `res.setHeader(...)` lines or the unwrapped `catalogVersion()` body. Mobile was not type-checked because no mobile source changed, which the diff confirms. The added lines are plain Express / react-query / JSX with no new type surface, so this evidence is credible and no spot-check is warranted. (confirmed)

### Scope and safety

The diff is five code files — `catalog.ts`, `orders.ts`, `admin.ts`, `AdminUsers.tsx`, `adminData.ts` — plus the two task docs. No POS/inventory, SEO/OG, short-link, or marketing code is touched; no dependency is added; the Prisma schema is unchanged. All edits are consistent with the plan. (confirmed)

</details>

<details>
<summary>File map</summary>

- `api-node/src/routes/catalog.ts` — BUG 1: `catalogVersion()` no longer goes through the 10s `ttlCache`; reads the row directly. Public ETag/304 scheme and `/config`+`/settings` caches unchanged.
- `api-node/src/routes/orders.ts` — BUG 3: `Cache-Control: no-store` set once in the staff list branch, covering both returns.
- `api-node/src/routes/admin.ts` — BUG 3: `Cache-Control: no-store` on `GET /users`.
- `web/src/pages/admin/AdminUsers.tsx` — BUG 2: dropped the client ascending re-sort; keeps STAFF filter.
- `web/src/pages/admin/adminData.ts` — BUG 3: `useAdminUsers` gains `staleTime: 0` + `refetchOnWindowFocus: true`.

Full diff: `git -C c:\xampp\htdocs\static4a\.worktrees\admin-fixes diff main...admin-fixes`

</details>
