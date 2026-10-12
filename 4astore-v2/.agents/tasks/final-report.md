# Final Report — order-pending-cache

**Verdict:** APPROVED (`.agents/tasks/review.json`) — two info findings, both non-blocking.
**Integration:** rebased `order-pending-cache` onto `main` (clean, no conflicts) and fast-forwarded `main`.
**Final commit on `main`:** `7b6981fdd43397b8b145e267ec598b9b1fa9745c`
**Not pushed** to any remote; worktree left in place for the orchestrator to remove.

Commits now on `main` (on top of `527bcf2d`):
- `e98b36a4` feat(orders): two-phase pending→confirmed lifecycle + admin manual confirm
- `8b4cd323` feat(catalog): catalog_version ETag + must-revalidate for instant edits
- `7b6981fd` docs(review): approved review artifacts

Verification run on the rebased tree:
- api-node `tsc --noEmit` → clean (exit 0)
- web `tsc --noEmit` → clean (exit 0)
- mobile `orderPhase` unit tests → 5/5 pass

---

## Feature 1 — Two-phase order lifecycle (Pending Payment → Order Placed)

**Problem solved:** a customer who tapped pay, minimized the app, and never returned left no trace — the order was lost. Now the order is captured as a lead the moment they proceed, so the owner can follow up and the user's cart/order is not lost.

**New status label (verbatim, shared across api + web + mobile):**
- `'Pending Payment'` — the early lead. Created when the customer taps "Proceed to UPI Payment". `payment_reference` is `NULL`.
- `'Order Placed'` — the confirmed/paid state (unchanged meaning). Set on screenshot + 12-digit UTR confirm, on a normal single-POST confirm, or on an admin manual confirm.

**Endpoints / flags:**
- `POST /api/orders` gains an additive request flag `phase: 'pending' | 'confirm'`, plus an optional client-supplied `orderId`.
  - `phase` **defaults to `'confirm'`** in the Zod schema, so any old app/web build (which sends neither `phase` nor `orderId`) runs the exact current UTR-required single-POST path. The pending flow is purely additive.
  - `phase: 'pending'` bypasses the 12-digit UTR guard, writes `payment_reference = null` and `order_status = 'Pending Payment'`, and fires **no staff push**.
  - `phase: 'confirm'` enforces the 12-digit UTR + uniqueness and sets `'Order Placed'`.

**How the pending→confirmed flip works:**
- The client generates one `orderId` and does a fire-and-forget pending `POST` on "Proceed" (never network-blocks the pay redirect — `web/src/pages/checkout/Checkout.tsx`, `mobile/app/checkout.tsx`).
- On confirm it `POST`s again with the **same `orderId`** and the UTR. The server `prisma.order.upsert` keyed on `order_id` flips the existing pending row's `order_status` to `'Order Placed'` and stores the UTR.
- Idempotency/dup rules: the same `orderId` may re-confirm its own pending row; a *different* order already holding the UTR is a genuine 409 duplicate.
- Staff "new order" push fires **only** on the genuine pending→placed / first-placed transition (guarded by `wasAlreadyPlaced` and `reminder_count === 0`) — never on a pending create and never on an idempotent re-save.

**Old-app compatibility (additive-phase default):** old clients omit `phase` → defaults to `'confirm'`, omit `orderId` → the server mints one. They therefore hit the original single-POST confirm path with the original UTR validation and the original single `'Order Placed'` push. No behavior change for installed builds.

**Admin manual-confirm location:**
- Endpoint: `POST /api/admin/orders/status` now accepts an **optional** `payment_reference` passthrough. When present and non-empty it is validated as a 12-digit UTR; an explicit empty string clears it to `null`; when the key is absent it is left untouched. The existing tracking sync + customer push run on every status change, so a manual confirm triggers the same downstream as a normal confirm.
- UI: web `AdminOrders.tsx` adds a `'Pending Payment'` amber chip (`.status-pending`), the status in the lists, a **Confirm** action, and a **pending-only filter**. Mobile `app/admin/orders.tsx` + `app/admin/order/[id].tsx` add the matching `STATUS_STYLE` chip and confirm/filter.
- Review note (info, non-blocking): the endpoint validates/writes `payment_reference` for any target status, not only confirmed states. Harmless (12-digit validated, clears on empty, untouched when absent). No change requested.

**Rider / push exclusions:**
- Rider available pool (`mobile/app/rider.tsx`) filters to paid states only: `['Order Placed', 'Confirmed', 'Packed']`. `'Pending Payment'` is intentionally excluded so riders never see or try to deliver an unpaid order; it enters the pool only after the flip.
- No staff push on a pending create (see above).

**Files changed (Feature 1):**
- `api-node/src/routes/orders.ts` — phase handling, pending create, confirm flip, push gating.
- `api-node/src/routes/admin.ts` — `/orders/status` optional UTR passthrough.
- `web/src/pages/checkout/Checkout.tsx`, `web/src/pages/admin/AdminOrders.tsx`, `web/src/pages/admin/admin.css`.
- `mobile/app/checkout.tsx`, `mobile/app/admin/orders.tsx`, `mobile/app/admin/order/[id].tsx`, `mobile/app/rider.tsx`, `mobile/src/theme.ts`.
- `mobile/src/orderPhase.ts` (pure, dependency-free decision helper mirroring the server branch) + `mobile/src/__tests__/orderPhase.test.ts`.
- `mobile/app.config.ts` — versionCode → 33.

**Review note (info, non-blocking):** every "Proceed" writes a `'Pending Payment'` row and most will never pay; by design there is no TTL cleanup, only the admin pending filter. Monitor table growth; a future TTL job marking stale pendings `'Cancelled'` is the documented follow-up.

---

## Feature 2 — Instant catalog refresh (catalog_version ETag + staleTime)

**Problem solved:** admin product/category edits did not reflect promptly in the storefront.

**Server (`api-node/src/routes/catalog.ts`):**
- `GET /products` and `GET /categories` now send `Cache-Control: no-cache, must-revalidate` plus an `ETag` of the form `"cat-v<N>"`.
- `N` is `catalog_version`, read via raw SQL from `app_version` and cached behind the existing 10s in-memory TTL cache so it never adds a per-request query. Falls back to `1` when the column/row is absent.
- When the client's `If-None-Match` matches the current version, the server short-circuits with a `304` (no body). On an edit the version changes and the next request gets fresh data immediately — regardless of any shared/edge cache.

**Version bump (`api-node/src/routes/admin.ts`):**
- `bumpCatalogVersion()` runs `UPDATE app_version SET catalog_version = catalog_version + 1` after every product/category add/update/delete. Fire-and-forget: it never blocks or fails a save, and on a DB that has not yet run the migration the UPDATE throws and is swallowed (freshness falls back to the old TTL behavior).

**Migration (`api-node/prisma/catalog-version.sql`):**
- ADD-COLUMN-only, information_schema-guarded, safe to re-run. Adds `catalog_version INT NOT NULL DEFAULT 1` to `app_version`. No `prisma migrate` / `db push` — the Prisma schema is unchanged; the column is read via raw SQL with a fallback.
- Run once on the live DB: `mysql -u <user> -p four_a_store < prisma/catalog-version.sql`.

**Client staleTime changes:**
- Web (`web/src/lib/queries.ts`): `useProducts` / `useCategories` set `staleTime: 0` + `refetchOnWindowFocus: true` (overriding the global 60s / no-focus-refetch). The ETag keeps these refetches cheap 304s.
- Mobile (`mobile/src/queries.ts`): `useProducts` / `useCategories` set `staleTime: 30_000` + `refetchOnWindowFocus: true` + `refetchOnReconnect: true`.

---

## Deploy / rebuild split

**api + web = server deploy via `deploy.sh`.** Run it on the server:
```
bash ~/4astore/4astore-v2/deploy.sh
```
It uses the confirmed server paths (`/home/ec2-user/4astore/...`), builds api-node to `dist` (`npm run build` → `dist/server.js`) with `prisma generate`, `pm2 restart 4astore-api --update-env`, and rsyncs `web/dist` to `/var/www/html`. It protects `api-node/.env`, `web/.env`, `fcm-service-account.json`, `/var/www/html/.htaccess`, `.well-known`, and `phpmyadmin` (rsync excludes, no `--delete`), and guards against the wrong FCM path.

> **Note:** `deploy.sh` step 1 does `git pull origin main`. This integration committed to **local** `main` only and did **not** push. Push `main` to origin (per your release process) before/so the server pull picks up these commits. Also run `prisma/catalog-version.sql` once on the live DB so the ETag uses a real version counter (it degrades gracefully until then).

**mobile = NEW AAB at versionCode 33.** `app.config.ts` is bumped to `33`. The mobile pending-order flow and the catalog staleTime changes only take effect once the versionCode 33 build is built, uploaded, and installed. The server-side changes work for web and for the API immediately after `deploy.sh`.

## Cloudflare caveat

**No cache purge was added.** The catalog ETag + `no-cache, must-revalidate` is sufficient when `/api` is NOT proxied/cached at the edge. If `/api` is ever orange-clouded (proxied) through Cloudflare, add a purge-on-mutation step using `CF_API_TOKEN` / `CF_ZONE_ID` (the same credentials already used by `subdomain-provision.sh`) to purge the `/products` and `/categories` responses after an admin write.
