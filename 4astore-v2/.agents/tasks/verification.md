# Verification — Two-phase order lifecycle + instant catalog refresh (4A Store v2)

Branch: `order-pending-cache`. Scope: `4astore-v2` (api-node + web + mobile). First iteration (no review.json present).

## Build / test gates — all green

| Subsystem | Command | Result |
|-----------|---------|--------|
| api-node  | `npm run build` (tsc) | ✅ compiles clean |
| api-node  | `npx prisma validate` | ✅ schema valid (ran with a dummy `DATABASE_URL`; schema syntax only) |
| web       | `npm run build` (sitemap + `tsc -b` + vite) | ✅ built in ~10s (only the pre-existing chunk-size >500 kB warning) |
| mobile    | `npm run typecheck` (`tsc --noEmit`) | ✅ no errors (the known usesCleartextTraffic note did not surface) |
| mobile    | `npm test` (`node --test`) | ✅ 64 pass / 0 fail (incl. 5 new `orderPhase` tests) |

## Prisma / node_modules note (TLS fallback)

The worktree had NO `node_modules`, and a fresh `prisma` CLI download prompted interactively (engine/CLI fetch would be blocked). Per the plan's fallback, I did NOT run `npm install` in the worktree; instead I pointed the worktree at the MAIN checkout's already-installed, identical dependencies via directory junctions (schema + package.json are identical):

```
mklink /J <worktree>/4astore-v2/api-node/node_modules  c:\xampp\htdocs\static4a\4astore-v2\api-node\node_modules
mklink /J <worktree>/4astore-v2/web/node_modules       c:\xampp\htdocs\static4a\4astore-v2\web\node_modules
mklink /J <worktree>/4astore-v2/mobile/node_modules    c:\xampp\htdocs\static4a\4astore-v2\mobile\node_modules
```

`prisma validate` then passed with `DATABASE_URL` set to a throwaway value (validation checks schema syntax, not a live DB). `node_modules` is gitignored, so these junctions are not committed. They can be removed with `rmdir` (they are reparse points, not real dirs) or replaced by a real `npm ci` once network/TLS allows.

## DB change (run-once, no Prisma migration)

`api-node/prisma/catalog-version.sql` adds `catalog_version INT NOT NULL DEFAULT 1` to the `app_version` table, guarded by `information_schema` (ADD-only, safe to re-run) — same pattern as `charges-settings.sql`. The Prisma schema is unchanged; the column is read via raw SQL and the app falls back to version `1` when it is absent, so builds/validate pass and a DB that hasn't run the SQL never 500s. `payment_reference` is already `String? @unique` (schema line 169) — NO migration for the pending flow.

## Manual re-reads (confirming behaviour)

- `orders.ts` POST `/`: `phase:'pending'` bypasses the 12-digit UTR guard, writes `payment_reference: null` + `order_status: 'Pending Payment'`, and does NOT call `notifyStaffNewOrder`. `phase:'confirm'` (default) enforces `/^\d{12}$/` + uniqueness (allowing the SAME order_id to re-confirm its own pending row) and the upsert's `update` branch now sets `order_status` + `payment_reference` so the pending row FLIPS to `Order Placed`. Staff push fires only on the genuine pending→placed / first-placed transition (`!wasAlreadyPlaced && reminder_count === 0`).
- `admin.ts` `/orders/status`: optional `payment_reference` passthrough (12-digit validated, empty clears, absent untouched); tracking sync + `notifyCustomerStatus` already fire on every status change, so an admin manual confirm triggers the same downstream as a normal confirm.
- `admin.ts`: `bumpCatalogVersion()` called in all SIX product/category mutation branches (product add/update/delete, category add/update/delete), swallowing a missing-column error.
- `catalog.ts`: `/products` + `/categories` set `ETag: "cat-v<version>"` + `Cache-Control: no-cache, must-revalidate` and 304 on `If-None-Match`; the version read is cached behind the existing 10s ttlCache.
- `checkout.tsx` (mobile) + `Checkout.tsx` (web): same client orderId used by the fire-and-forget pending create in proceed and the confirm flip; proceed never awaits the pending POST.
- `rider.tsx`: available pool stays `['Order Placed','Confirmed','Packed']` — `'Pending Payment'` is intentionally excluded (comment added).

## Abandoned-pending hygiene (no auto-delete)

No TTL job / auto-delete was added. Stale `'Pending Payment'` rows are left for manual admin review via the new pending filter/tab (web `AdminOrders` ⏳ Pending toggle; mobile `admin/orders` pending banner toggle). An optional future TTL job could mark pendings older than N hours as `'Cancelled'`.

## Cloudflare

No Cloudflare purge call was added (the audit found `/api` is Apache reverse-proxied, not confirmed orange-clouded). The ETag + `must-revalidate` makes catalog edits appear within one cheap revalidation regardless. IF `/api` is ever orange-clouded, a purge-on-mutation using `CF_API_TOKEN`/`CF_ZONE_ID` (the same secrets `subdomain-provision.sh` already uses for DNS) can be added fire-and-forget inside `bumpCatalogVersion()`.
