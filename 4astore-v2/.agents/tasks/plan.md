# Implementation Plan — Two-phase order lifecycle + instant catalog refresh (4A Store v2)

Scope: `4astore-v2` ONLY (api-node + web + mobile). Legacy `4AStoreApp` / old PHP / root `*.html` are OUT of scope.
All edits/builds happen in the worktree with ABSOLUTE paths under
`c:\xampp\htdocs\static4a\.worktrees\order-pending-cache\4astore-v2\`.
Git uses `git -C c:\xampp\htdocs\static4a\.worktrees\order-pending-cache` (branch `order-pending-cache`).

Grounded in the audit at `.agents/tasks/order-lifecycle-cache-audit.md` and the files read during exploration.

## Key design decisions (made here, not left open)

- **New status literal: `'Pending Payment'`** (exact string, used verbatim across api + web + mobile). `'Order Placed'` stays the confirmed/paid state so the rider pool, staff push, and revenue logic that key off `'Order Placed'` are unchanged. Rationale: the audit confirms 5+ screens read `'Order Placed'`; keeping it as "paid" means we only add one new early state instead of re-labeling the paid state everywhere.
- **Phase flag: `order.phase: 'pending' | 'confirm'`, default `'confirm'`.** Old app builds send no `phase` → treated as `'confirm'` → the existing UTR-required single-POST path runs unchanged. This is the additive-compatibility guarantee. Rationale: a defaulted optional field is the smallest change that keeps old clients working while enabling the new flow.
- **Idempotent flip stays on `order_id`.** `POST /orders` is already an upsert keyed on `order_id`. Proceed creates the row with a client-generated `orderId` (`'4A'+genHex8()`); Confirm upserts the SAME `orderId` → the row flips in place. No new endpoint for create/confirm. Rationale: reuses the audited idempotent recovery path mobile already relies on.
- **UTR validation moves to confirm-time only.** `payment_reference` is already `String? @unique @db.VarChar(12)` (schema.prisma line ~169) and MySQL UNIQUE allows multiple NULLs → pending rows carry `payment_reference = null`. NO migration. The `/^\d{12}$/` + uniqueness guard runs only on `phase:'confirm'`.
- **Admin manual confirm** reuses the generic `POST /admin/orders/status` (admin.ts) with an optional `payment_reference` passthrough. Rationale: avoids a new endpoint; that handler already syncs tracking + pushes the customer.
- **Catalog freshness: a `catalog_version` counter on the `app_version` row, surfaced as an ETag + `no-cache, must-revalidate`.** `app_version` is a raw-SQL table (no Prisma model); add a `catalog_version` column via an idempotent `information_schema`-guarded SQL file (the project's established no-migrate pattern — see `prisma/charges-settings.sql`). Do NOT reuse `asset_version` (it forces a full web shell reload — too blunt for per-edit catalog freshness). Rationale: ETag + must-revalidate makes edits appear within one cheap revalidation regardless of Cloudflare.
- **No Cloudflare purge call** is added (audit: `/api` is Apache reverse-proxied, not confirmed orange-clouded). Documented as a future option only.

## Verification commands (discovered from package.json files)
- api-node: `cd api-node && npm run build` (tsc) and `cd api-node && npx prisma validate`
- web: `cd web && npm run build` (sitemap + `tsc -b` + vite build)
- mobile: `cd mobile && npm run typecheck` (tsc --noEmit) and `cd mobile && npm test` (`node --test` over `src/__tests__/**/*.test.ts`)
- **Prisma-engine-TLS fallback:** if `npx prisma validate` / `prisma generate` fails because the engine download is blocked, copy the generated client + engines from the MAIN checkout:
  `robocopy "c:\xampp\htdocs\static4a\4astore-v2\api-node\node_modules\.prisma" "c:\xampp\htdocs\static4a\.worktrees\order-pending-cache\4astore-v2\api-node\node_modules\.prisma" /E`
  and the same for `node_modules\@prisma\engines`. Note this fallback in the final report if used.

---

# Implementation Plan

- [ ] 1. **DB: idempotent `catalog_version` column on `app_version`.** Create a new guarded SQL file that adds `catalog_version INT NOT NULL DEFAULT 1` to the `app_version` table only when absent (copy the `information_schema.COLUMNS` COUNT + `IF(@c=0, ...)` pattern from `prisma/charges-settings.sql`). This is run-once on the live DB; the app code must tolerate the column being absent (fallback to `1`). Document in the file header that it is ADD-only and safe to re-run, and that no `prisma migrate`/`db push` is used.
      Files: create `api-node/prisma/catalog-version.sql`
      Verify: `cd api-node && npx prisma validate` still passes (schema unchanged — the column is raw-SQL only); open the file and confirm the `information_schema` guard matches the existing SQL files' shape.

- [ ] 2. **API — pending create + confirm flip in `POST /orders`.** In `api-node/src/routes/orders.ts`: add `phase: z.enum(['pending','confirm']).optional().default('confirm')` and make `paymentReference: z.string().optional().default('')` on `saveSchema.order`. In the handler: when `phase === 'pending'` BYPASS the 12-digit UTR guard + the duplicate check, keep the serviceability (PIN/village/GPS) checks, and upsert with `payment_reference: null`, `order_status: 'Pending Payment'`. When `phase === 'confirm'` (default, or whenever a non-empty UTR is supplied) keep the existing `/^\d{12}$/` + uniqueness enforcement, and in BOTH the `create` and `update` upsert branches set `order_status: 'Order Placed'` + `payment_reference: utr` (the `update` branch currently omits `order_status`, so add it — this is the pending→placed flip). Fire `notifyStaffNewOrder` ONLY when the resulting `created.order_status === 'Order Placed'` AND it was not already placed (guard so a pending create never pushes and a re-save of an already-placed order never double-pushes — keep the existing `reminder_count === 0` guard too). Add code comments documenting the two status labels and the phase default.
      Files: `api-node/src/routes/orders.ts`
      Verify: `cd api-node && npm run build` compiles clean; manually re-read the handler to confirm the pending branch sets `payment_reference: null` + `'Pending Payment'` and does NOT call `notifyStaffNewOrder`.

- [ ] 3. **API — admin manual confirm passthrough.** In `api-node/src/routes/admin.ts` `POST /orders/status`: accept an optional `payment_reference` in the body; when present and the new status is a confirmed state (`'Order Placed'`/`'Confirmed'`), include `payment_reference` in the `prisma.order.update` data (validate `/^\d{12}$/` if non-empty, allow explicit clear with `null`). The handler already syncs the `tracking` row and calls `notifyCustomerStatus`, so manual-confirming a pending order already triggers the customer push + tracking row — confirm that path runs for a `'Pending Payment' → 'Order Placed'` transition. Do NOT change the push/tracking behavior otherwise.
      Files: `api-node/src/routes/admin.ts`
      Verify: `cd api-node && npm run build` compiles clean; re-read the handler to confirm `payment_reference` is only written when supplied and the tracking + customer-push fire on the status change.

- [ ] 4. **API — catalog version bump on product/category mutations.** In `api-node/src/routes/admin.ts`: after each successful DB write in `POST /products` (add/update/delete) and `POST /categories` (add/update/delete), fire-and-forget `UPDATE app_version SET catalog_version = catalog_version + 1 WHERE id = 1` (wrap in a try/catch that swallows a missing-column error so a DB that hasn't run step 1's SQL yet never 500s). Add a small shared helper (e.g. `bumpCatalogVersion()`) so all six call sites use one path. Do NOT touch `asset_version`.
      Files: `api-node/src/routes/admin.ts`
      Verify: `cd api-node && npm run build` compiles clean; grep-free manual read confirms the bump is called in all six mutation branches and errors are swallowed.

- [ ] 5. **API — ETag + must-revalidate on `GET /products` and `GET /categories`.** In `api-node/src/routes/catalog.ts`: read the current `catalog_version` (SELECT from `app_version`, fallback `1` if the column/row is missing), set `ETag: "cat-v<version>"` (weak or strong) and change `Cache-Control` to `no-cache, must-revalidate` on both `/products` and `/categories`. Honour `If-None-Match`: when it matches the current version, return `304` with no body. Keep the `max-age` constants for the other endpoints (`/settings`, `/config`, etc.) unchanged. Cache the version read behind the existing 10s `ttlCache` or a tiny local read so it doesn't add a query per request.
      Files: `api-node/src/routes/catalog.ts`
      Verify: `cd api-node && npm run build` compiles clean; re-read to confirm both routes set the new ETag + `no-cache, must-revalidate` and short-circuit on `If-None-Match`.

- [ ] 6. **Mobile — pending create on Proceed, same orderId on Confirm (checkout.tsx).** In `mobile/app/checkout.tsx`: hoist `genHex8()` usage so the `orderId` is generated ONCE in `proceed()` (store it in a `useRef`/state, e.g. `pendingOrderId`). In `proceed()`, AFTER `setCustomer(c); setPayOpen(true);` (never before — payment must open instantly), fire-and-forget `api.post('/orders', { order: { orderId: pendingOrderId, phase:'pending', customer: c, addressLabel: label, items: <mapped>, subtotal/discount/deliveryCharge/handlingCharge/totalAmount } })` with `.catch(() => null)` so a failed pending create never blocks the user. In `confirmOrder(utr, screenshot)`, REUSE `pendingOrderId` as `clientOrderId` (instead of generating a fresh one) and add `phase:'confirm'` to the payload so the server flips the SAME row; keep the existing 30s timeout + idempotent GET-recovery and the screenshot upload to that id. If `proceed()` ran before an id existed (edge), fall back to generating one in `confirmOrder`.
      Files: `mobile/app/checkout.tsx`
      Verify: `cd mobile && npm run typecheck` passes; re-read to confirm the same `orderId` is used by both the pending POST and the confirm POST and that `proceed()` does not `await` the pending POST.

- [ ] 7. **Web — pending create on Proceed, same orderId on Confirm (Checkout.tsx).** In `web/src/pages/checkout/Checkout.tsx`: add a client `orderId` generator (same `'4A'+8-uppercase-hex` shape as the server/mobile) and store the id in a ref/state. In `proceedToPayment()`, after `setCustomerInfo(c); setPayOpen(true);`, fire a non-blocking `api.post('/orders', { order: { orderId, phase:'pending', customer: c, addressLabel: label, items, subtotal, discount, deliveryCharge, totalAmount } })` (`.catch(() => {})`). In `confirmOrder(utr, screenshot)`, include that same `orderId` + `phase:'confirm'` in the payload (web currently omits `orderId` and lets the server mint it — switch to the client id so Proceed and Confirm hit the same row). Keep the screenshot upload + success panel exactly as today.
      Files: `web/src/pages/checkout/Checkout.tsx`
      Verify: `cd web && npm run build` compiles clean; re-read to confirm the same `orderId` is sent by both calls and `proceedToPayment()` does not await the pending POST.

- [ ] 8. **Mobile — catalog freshness in queries.ts.** In `mobile/src/queries.ts`: lower `useProducts` `staleTime` from `5 * 60_000` to a short value (`30_000`) and `useCategories` from `10 * 60_000` to `30_000`, and add `refetchOnWindowFocus: true` + `refetchOnReconnect: true` on both (overriding the global `refetchOnWindowFocus: false`). The server must-revalidate ETag (step 5) keeps these refetches cheap 304s. Leave `useConfig`/`useSettings` staleTimes unchanged.
      Files: `mobile/src/queries.ts`
      Verify: `cd mobile && npm run typecheck` passes; `cd mobile && npm test` — existing tests still pass.

- [ ] 9. **Web — catalog freshness in queries.ts.** In `web/src/lib/queries.ts`: set `useProducts` and `useCategories` to `refetchOnWindowFocus: true` and `staleTime: 0` (overriding the global `staleTime: 60_000` / `refetchOnWindowFocus: false` from `main.tsx`). Admin `invalidateQueries` stays as-is. Leave `useConfig`/`useSettings` unchanged.
      Files: `web/src/lib/queries.ts`
      Verify: `cd web && npm run build` compiles clean.

- [ ] 10. **Admin visibility (web) — `Pending Payment` chip + confirm action.** In `web/src/pages/admin/AdminOrders.tsx`: add `['Pending Payment', '⏳ Pending Payment']` to `STATUS_OPTIONS` and `'Pending Payment': 'status-pending'` to `STATUS_CLASS`; add a distinct `.status-pending` CSS rule (find the existing `.status-*` block in the admin stylesheet referenced by this page and add a matching amber/grey chip). Add a prominent **"Confirm order"** button shown only for rows with `order_status === 'Pending Payment'` that calls `updateOrderStatus(orderId, 'Order Placed')` (reusing `web/src/lib/admin.ts`), and a filter/tab so the owner can list pending orders. Keep revenue/earnings keyed off `'Delivered'` (unaffected).
      Files: `web/src/pages/admin/AdminOrders.tsx` (+ the admin status CSS file it uses)
      Verify: `cd web && npm run build` compiles clean; re-read to confirm the new option, class, confirm button (pending-only), and filter are present.

- [ ] 11. **Admin visibility (mobile) — status lists, chip colour, new-lead badge.** In `mobile/src/theme.ts` add `'Pending Payment': { bg: '#fff4e5', fg: '#b96500' }` (distinct amber) to `STATUS_STYLE`. In `mobile/app/admin/order/[id].tsx` add `'Pending Payment'` to the `STATUS` array (so staff can set/clear it) and ensure the status buttons allow confirming to `'Order Placed'`. In `mobile/app/admin/orders.tsx`, change the `pending` list and the `isNew`/🆕 badge to flag `order_status === 'Pending Payment'` (the real paid-but-unconfirmed lead) in addition to / instead of `'Order Placed'`, so the owner's follow-up list surfaces unpaid leads. Add a visible way to filter/see pending orders.
      Files: `mobile/src/theme.ts`, `mobile/app/admin/order/[id].tsx`, `mobile/app/admin/orders.tsx`
      Verify: `cd mobile && npm run typecheck` passes; re-read to confirm the chip colour, the `STATUS` entry, and the pending-lead badge/filter are present.

- [ ] 12. **Rider + push exclusions for `Pending Payment`.** In `mobile/app/rider.tsx` the available-pool filter is `['Order Placed','Confirmed','Packed']` — leave it UNCHANGED (it already excludes `'Pending Payment'`, so unpaid orders never reach riders) and add a code comment stating pending orders are intentionally excluded. Confirm (from step 2) that `notifyStaffNewOrder` never fires on a pending create. No functional change if the exclusion is already correct — this item is the explicit verification + comment that riders/staff never see unpaid orders.
      Files: `mobile/app/rider.tsx`
      Verify: `cd mobile && npm run typecheck` passes; re-read `rider.tsx` to confirm `'Pending Payment'` is absent from the available-pool array and the comment is present.

- [ ] 13. **Mobile versionCode bump to 33.** In `mobile/app.config.ts` change the `VERSION_CODE` default from `32` to `33` (`Number(process.env.STORE4A_VERSION_CODE || 33)`). Update the nearby comment that documents 31/32 to note 33.
      Files: `mobile/app.config.ts`
      Verify: `cd mobile && npm run typecheck` passes; re-read to confirm the default is `33`.

- [ ] 14. **(Optional) Pure-logic unit test for the phase/UTR branch.** If a pure helper is extracted for the pending-vs-confirm decision (recommended: a tiny `orderPhase.ts` returning `{ status, paymentReference }` given `phase`+`utr`), add `mobile/src/__tests__/orderPhase.test.ts` following the `addressPayload.test.ts` pattern (node:test, no React, no network) covering: pending → `status 'Pending Payment'`, `paymentReference null`; confirm with 12-digit UTR → `status 'Order Placed'`, UTR set; confirm without UTR rejected. Keep this additive and only if a pure function is cleanly extractable without reshaping the handler.
      Files: `mobile/src/__tests__/orderPhase.test.ts` (+ optional shared helper)
      Verify: `cd mobile && npm test` — the new test file passes alongside the existing suite.

- [ ] 15. **Abandoned-pending hygiene — document only (no auto-delete).** Do NOT add a TTL job or auto-delete. The admin pending filter/tab (steps 10–11) is sufficient. Record in the final report that stale `'Pending Payment'` rows are left for manual admin review/cancel, and that an optional future TTL job could mark pendings older than N hours as `'Cancelled'`.
      Files: (none — report note)
      Verify: confirm the final report contains this note.

- [ ] 16. **Full per-subsystem verification.** Run every build/test gate end to end and fix any failure before committing: `cd api-node && npm run build && npx prisma validate` (use the Prisma-engine-TLS fallback above if the engine download is blocked), `cd web && npm run build`, `cd mobile && npm run typecheck && npm test`. Clean up any temporary files created during verification.
      Files: (none — verification)
      Verify: all four commands exit 0.

---

## Commit, rebase, and merge (no force, no remote push)

Run these from the worktree with `git -C c:\xampp\htdocs\static4a\.worktrees\order-pending-cache`.

- [ ] 17. **Commit Feature 1 (two-phase order) locally.** Stage ONLY the Feature-1 files by name: `api-node/src/routes/orders.ts`, `api-node/src/routes/admin.ts` (status passthrough), `mobile/app/checkout.tsx`, `web/src/pages/checkout/Checkout.tsx`, `web/src/pages/admin/AdminOrders.tsx` (+ CSS), `mobile/src/theme.ts`, `mobile/app/admin/order/[id].tsx`, `mobile/app/admin/orders.tsx`, `mobile/app/rider.tsx`, `mobile/app.config.ts`, and any Feature-1 test/helper. Commit with a conventional message (e.g. `feat(orders): two-phase pending→confirmed lifecycle + admin manual confirm`). Do NOT push.
      Verify: `git -C c:\xampp\htdocs\static4a\.worktrees\order-pending-cache log --oneline -1` shows the Feature-1 commit; `git ... status` shows only Feature-2 files remaining.

- [ ] 18. **Commit Feature 2 (instant catalog refresh) locally.** Stage ONLY the Feature-2 files: `api-node/prisma/catalog-version.sql`, `api-node/src/routes/catalog.ts`, `api-node/src/routes/admin.ts` (the catalog bump — if admin.ts carries both features, make it part of whichever commit runs first and note it), `mobile/src/queries.ts`, `web/src/lib/queries.ts`. Commit (e.g. `feat(catalog): catalog_version ETag + must-revalidate for instant edits`). Do NOT push. NOTE: `admin.ts` is touched by both features; if it cannot be cleanly split, fold its changes into the Feature-1 commit (step 17) and keep Feature-2's commit to the remaining files — document this in the report.
      Verify: `git ... log --oneline -2` shows both feature commits; `git ... status` is clean.

- [ ] 19. **Rebase onto main and fast-forward merge (local only).** Fetch/refresh the base, rebase `order-pending-cache` onto the latest `main`, resolve any conflicts, then re-run the full step-16 verification on the rebased tree. Fast-forward merge into `main` (`git merge --ff-only`). NO `--force`, NO `git push`, NO remote operations.
      Verify: `git ... log --oneline -3` shows the two feature commits now on `main` via fast-forward; the step-16 build/test gates still pass on the merged tree.

---

## Compatibility & safety notes (for the implementer)
- Old app builds send no `phase` and no client `orderId` on web → default `'confirm'` + server-minted id → the exact current single-POST behavior. Nothing regresses.
- A failed pending POST on Proceed is swallowed; the normal confirm still creates the order via the old path.
- `'Pending Payment'` is deliberately excluded from the rider pool and the staff new-order push so riders never see unpaid orders and staff are not spammed.
- Revenue/earnings key off `'Delivered'` and are unaffected; status-count tiles should label the new pending state as a follow-up list, not revenue.
- No Prisma migration: `payment_reference` is already nullable+unique; `catalog_version` is added via the idempotent raw-SQL file only.
- No Cloudflare purge is added; document that IF `/api` is ever orange-clouded, a purge-on-mutation using `CF_API_TOKEN`/`CF_ZONE_ID` (already used by `subdomain-provision.sh`) can be added. The ETag + must-revalidate makes edits appear within one revalidation regardless.
