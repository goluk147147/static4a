# Two-phase pending→confirmed order lifecycle + instant catalog refresh

This change closes the owner's #1 revenue leak (shoppers who pay via UPI but never return to upload the screenshot were never recorded anywhere) and makes admin product/category edits appear on storefronts within seconds. Feature 1 adds a `phase: 'pending' | 'confirm'` flag to `POST /orders`: tapping *Proceed to UPI Payment* now fire-and-forget creates a `'Pending Payment'` lead with no UTR, and the later screenshot+UTR confirm flips that same `order_id` to `'Order Placed'`. Feature 2 adds a `catalog_version` counter bumped on every admin product/category mutation and surfaced as an ETag + `no-cache, must-revalidate` on `GET /products` and `GET /categories`, with mobile/web React Query staleTimes dropped and refetch-on-focus enabled. The change is deliberately additive — old app builds that send no `phase` run the exact prior single-POST path unchanged.

Watch for: nothing blocking. The pending-create path correctly bypasses the UTR guard, writes `payment_reference=null`, and suppresses the staff push (confirmed). The admin manual-confirm validates a 12-digit UTR even when the target status isn't a confirmed state, slightly broader than the plan's wording but harmless (possible). No Cloudflare purge was added, matching the plan (confirmed).

**Verdict**: APPROVED

## High-level view

The two-phase order flow hinges on `POST /orders` branching on `phase`. A `'pending'` request skips the 12-digit UTR guard and the duplicate check, writes `payment_reference=null` and `order_status='Pending Payment'`, and never fires `notifyStaffNewOrder`. A `'confirm'` request (the default, so any old client falls into it) enforces `/^\d{12}$/` plus uniqueness — with the one correct exception that the SAME `order_id` may re-use its own UTR — and the upsert's update branch now also flips `order_status` and `payment_reference`, so a confirm of a prior pending row updates in place rather than creating a second order. The staff push fires once, only on the genuine pending→placed (or first-placed) transition.

Unpaid leads are kept away from fulfilment and alerts: the rider available-pool still filters to `['Order Placed','Confirmed','Packed']`, so `'Pending Payment'` is excluded, and the staff push guard means no alert on a pending create. Admin surfaces gained the new state everywhere it needs to appear — web `STATUS_OPTIONS`/`STATUS_CLASS` + a `status-pending` chip + a pending-only filter + a per-row Confirm button; mobile `theme.ts` chip colour, the order-detail `STATUS` list, and the orders-list pending filter/badge. Admin manual-confirm reuses `POST /admin/orders/status`, which already syncs the tracking row and pushes the customer, so a manual confirm triggers the same downstream as a normal one. Revenue/earnings still key off `'Delivered'` and are untouched.

Catalog freshness is a single counter: `bumpCatalogVersion()` runs in all six admin product/category branches (fire-and-forget, swallows a missing-column error), and `GET /products`/`/categories` read it (cached behind the existing 10s TTL, falling back to 1) to set `ETag: "cat-v<n>"` + `no-cache, must-revalidate` and 304 on a matching `If-None-Match`. Clients revalidate often but cheaply: web products/categories go to `staleTime:0` + refetch-on-focus, mobile drops from 5/10 min to 30s + refetch-on-focus/reconnect. The `catalog_version` column is added by an idempotent `information_schema`-guarded SQL file, no Prisma migration. No Cloudflare purge was added, consistent with the audit's finding that `/api` is Apache-proxied, not confirmed orange-clouded.

Build/test evidence is recorded in verification.md: api-node `tsc` + `prisma validate`, web `vite` build, mobile `tsc --noEmit` + `node --test` (64 pass incl. 5 new `orderPhase` tests). The worktree had no `node_modules`; per the plan's fallback the coder junctioned to the main checkout's identical, already-installed deps rather than running a blocked `npm install`. mobile `versionCode` is 33.

<details>
<summary>Issues (2)</summary>

1. **Manual-confirm UTR scope** — `POST /admin/orders/status` validates/writes `payment_reference` for any target status, not only confirmed states as the plan worded it. Harmless (still 12-digit-validated, clear-on-empty, untouched-when-absent); no action required unless the owner wants it gated to confirmed states.
2. **Abandoned-pending growth** — every Proceed writes a row and most won't be paid; by design there is no TTL cleanup, only the admin pending filter. Monitor table growth; a future TTL job marking stale pendings `'Cancelled'` is the documented follow-up.

</details>

<details>
<summary>Details</summary>

### Pending-create bypass and the idempotent confirm flip

The whole feature rests on one handler staying additive. `saveSchema.order` gained `phase: z.enum(['pending','confirm']).optional().default('confirm')` and `paymentReference` became optional-defaulting-to-empty. The handler computes `isPending = o.phase === 'pending'` and only runs the `/^\d{12}$/` guard and the duplicate lookup when NOT pending. The duplicate check is the one place that needed care: it now allows `dup.order_id === o.orderId` through, so a confirm that re-uses the UTR already written to its own pending row isn't a false 409 — only a *different* order holding that UTR is a genuine conflict. `newStatus`/`paymentReference` are `'Pending Payment'`/`null` on pending and `'Order Placed'`/`utr` on confirm, and the upsert's `update` branch now sets both (the base branch omitted `order_status`), which is exactly the pending→placed flip.

The staff push is guarded three ways: `created.order_status === 'Order Placed'` (never on a pending create), `!wasAlreadyPlaced` (never on an idempotent re-save of an already-placed order), and the pre-existing `reminder_count === 0`. `wasAlreadyPlaced` is read from a `prior` lookup taken before the upsert. This is correct for the lost-lead requirement: a pending create is silent, and the one confirm that flips the row pushes once.

Old clients: no `phase` → `'confirm'`; web previously let the server mint the id and now sends a client id, but a confirm with a brand-new `order_id` still hits the `create` branch as `'Order Placed'` with the UTR, identical to before. Nothing regresses.

### Keeping unpaid leads out of fulfilment and alerts

`rider.tsx` deliberately did NOT change its pool filter — `['Order Placed','Confirmed','Packed']` already excludes `'Pending Payment'`, so an unpaid lead can never be claimed by a rider. The added comment documents this as intentional. Combined with the push guard above, a `'Pending Payment'` row is invisible to riders and generates no staff alert until it flips to paid.

### Admin visibility for the new state

Both admin surfaces distinguish the pending lead from a paid order. Web adds `['Pending Payment','⏳ Pending Payment']` to `STATUS_OPTIONS`, a `status-pending` → amber `.status-pending` chip, a pending-only toggle (with a count badge), and a per-row `✅ Confirm` button rendered only when `order_status === 'Pending Payment'` that calls `updateOrderStatus(orderId,'Order Placed')` then invalidates the admin list. Mobile adds the amber chip in `theme.ts`, `'Pending Payment'` to the order-detail `STATUS` array (so staff can set/clear it and confirm to `'Order Placed'`), and reworks the orders-list banner/`isNew` badge + filter to key off `'Pending Payment'` — the real paid-but-unconfirmed follow-up list. The admin manual-confirm path reuses `POST /admin/orders/status`, which already syncs the tracking row and calls `notifyCustomerStatus`, so a manual confirm triggers the same downstream as a client confirm.

One deviation from the plan's wording: the `payment_reference` passthrough validates/writes the UTR for any target status, not only `'Order Placed'`/`'Confirmed'`. It still 12-digit-validates a non-empty value, clears on empty string, and leaves the field untouched when the key is absent, so there is no correctness or data-integrity risk — just a wider surface than described.

### Catalog version counter and conditional GETs

`bumpCatalogVersion()` issues `UPDATE app_version SET catalog_version = catalog_version + 1 WHERE id = 1` and swallows errors, and it is called in all six mutation branches: product add/update/delete and category add/update/delete. On the read side, `catalogVersion()` selects the column behind the existing 10s `ttlCache` (so it adds no per-request query) and falls back to `1` when the column/row is missing, so a DB that hasn't run `catalog-version.sql` degrades to the old behaviour rather than 500ing. `serveCatalogConditional()` sets `ETag: "cat-v<n>"` + `Cache-Control: no-cache, must-revalidate` on `/products` and `/categories` and returns a bodyless 304 when `If-None-Match` matches. The `max-age` constants on the other public GETs are left alone.

Client staleTimes were cut to make the revalidation actually happen: web `useProducts`/`useCategories` → `staleTime:0` + `refetchOnWindowFocus:true`; mobile → `staleTime:30_000` + `refetchOnWindowFocus`/`refetchOnReconnect`. Because the server answers unchanged catalogs with a cheap 304, these frequent refetches are inexpensive. The `catalog-version.sql` file uses the project's established `information_schema`-guarded ADD-only pattern and is safe to re-run; no Prisma schema change.

### Test coverage

The pure branch logic is covered by `src/orderPhase.ts` + `src/__tests__/orderPhase.test.ts` (5 cases: pending→`'Pending Payment'`/null with UTR ignored, confirm+12-digit→`'Order Placed'`/UTR, non-digit stripping, confirm-without-UTR rejected, confirm-with-wrong-length rejected). The helper mirrors the server branch exactly, so it guards the status/payment_reference mapping without React or network.

Not tested: there is no integration test exercising the actual `POST /orders` handler (the idempotent same-`order_id` flip, the 409-only-on-different-order rule, the push-fires-once guard) or the ETag 304 path — these were verified by the coder's manual re-read, not an automated test. For a change this correctness-sensitive that's an acceptable gap given the pure-logic test plus the type-check/build gates, but an API-level test of the flip and the push guard would harden it.

### Verification evidence

verification.md records all four gates green and the mobile suite at 64 pass / 0 fail including the new tests. The worktree lacked `node_modules`; rather than run a network-blocked install the coder junctioned to the main checkout's identical installed deps (documented, gitignored, reversible) so `prisma validate` and the builds could run — this matches the plan's stated TLS fallback. No build re-run was performed in this review per the task constraints; the evidence is present and specific.

</details>

<details>
<summary>File map</summary>

- `api-node/src/routes/orders.ts` — `phase` flag; pending bypasses UTR guard → `'Pending Payment'`/null; confirm flips same `order_id` → `'Order Placed'`/UTR; push once on transition.
- `api-node/src/routes/admin.ts` — `bumpCatalogVersion()` in all six product/category branches; `payment_reference` passthrough on `/orders/status`.
- `api-node/src/routes/catalog.ts` — `catalog_version` ETag + `no-cache, must-revalidate` + 304 on `/products` and `/categories`.
- `api-node/prisma/catalog-version.sql` — idempotent ADD-only `catalog_version` column.
- `mobile/app/checkout.tsx` — pending POST on Proceed (fire-and-forget), same `orderId` reused on confirm with `phase:'confirm'`.
- `web/src/pages/checkout/Checkout.tsx` — client `orderId` + pending POST on Proceed; confirm sends same id + `phase:'confirm'`.
- `web/src/pages/admin/AdminOrders.tsx` + `admin.css` — pending status option/chip, pending filter, per-row Confirm button.
- `mobile/app/admin/orders.tsx`, `mobile/app/admin/order/[id].tsx`, `mobile/src/theme.ts` — pending badge/filter, status list entry, amber chip.
- `mobile/app/rider.tsx` — comment documenting pending exclusion from the available pool (filter unchanged).
- `mobile/src/queries.ts`, `web/src/lib/queries.ts` — reduced catalog staleTimes + refetch-on-focus.
- `mobile/app.config.ts` — versionCode 32 → 33.
- `mobile/src/orderPhase.ts` + `mobile/src/__tests__/orderPhase.test.ts` — pure phase-decision helper + 5 unit tests.
- `.agents/tasks/plan.md`, `verification.md` — plan and coder's verification note.

Full diff: `git -C c:\xampp\htdocs\static4a\.worktrees\order-pending-cache diff main...order-pending-cache`

</details>
