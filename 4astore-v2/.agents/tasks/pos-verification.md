# POS/Billing — FEAT-006 verification note

Feature: **FEAT-006 — Owner push notifications + admin dashboard + reports**
(final integration phase). Branch `pos-billing`, worktree
`c:\xampp\htdocs\static4a\.worktrees\pos-billing`. FEAT-001..005 were already
committed (HEAD `90eda2df`); this note covers the FEAT-006 work committed on top.

## What FEAT-006 added (all code-complete)

- `api-node/src/services/posNotify.ts` — typed best-effort push layer over the
  existing FCM infra (`services/push.ts`: `tokensForStaff('pos')`,
  `sendToTokens`, `recordNotification`). Helpers: `sale`, `lowStock`,
  `outOfStock`, `stockStateAfterSale`, `cancelRefund`, `stockAdjust`. New
  notification `type`s: `pos_sale`, `pos_low_stock`, `pos_out_of_stock`,
  `pos_cancel`, `pos_stock_adjust`. Every helper swallows all errors so a push
  can never block or fail a bill.
- `api-node/src/routes/pos.ts` — wired fire-and-forget AFTER the checkout commit:
  `posNotify.sale` (gated on `settings.pos_sale_notifications`) and
  `posNotify.stockStateAfterSale` per product (low/out-of-stock on the TRANSITION
  into the state only, using the pre-deduction stock + post-deduction balance
  captured inside the tx). `posNotify.cancelRefund` fires AFTER the reversal
  commit, and only when this call performed the completed→cancelled/refunded
  transition (idempotent no-op does not re-alert).
- `api-node/src/routes/pos-import.ts` — `posNotify.stockAdjust` fires after a
  bulk-update commit for significant swings (|Δ| ≥ `SIGNIFICANT_STOCK_DELTA` = 10).
- `api-node/src/routes/admin-pos.ts` — new read-only endpoints:
  - `GET /api/admin/pos/dashboard` (`requireStaff('dashboard')`): today's POS
    sales + #bills, low/out-of-stock counts, recent bills.
  - `GET /api/admin/pos/reports?period=day|week|month&from=&to=`
    (`requireStaff('pos_reports')`): totals, #bills, discounts, refunds,
    payment-method summary, best-sellers (real `pos_bill_items` join), low/out
    lists.
  - `GET /api/admin/pos/reports/export.xlsx` (`requireStaff('pos_reports')`):
    the same report as a workbook via the FEAT-003 `exceljs` writer.
  All mounted in `server.ts` on `/api/admin/pos` BEFORE the generic `/api/admin`.
- `web/src/lib/pos.ts` — `usePosDashboard`, `usePosReport`, `exportReportXlsx`
  (+ types). `retry:false` and `staleTime` kept short so prices/stock stay fresh.
- `web/src/pages/admin/AdminDashboard.tsx` — POS summary strip (today's sales,
  #bills, low/out counts, recent bills) + quick links (New Bill, Billing History,
  Inventory, Excel Import, Sales Reports), each guarded by `canAdmin(...)`.
- `web/src/pages/admin/AdminPosReports.tsx` — reports view with period tabs,
  custom date range, payment/best-seller/low/out panels, and Excel export.
- `mobile/src/pos.ts` + `mobile/app/admin/pos-reports.tsx` — read-only reports
  screen (period tabs, summary/payment/best-seller/low/out), gated by
  `canAdmin(user, 'pos_reports')` with the standard `/login` bounce. Excel export
  is web-only by design (§9.2); mobile shows the same figures.

Role gating is enforced server-side on every new endpoint
(`requireStaff('dashboard' | 'pos_reports')`); frontend `canAdmin(...)` hiding is
secondary. The online order/checkout/catalog flow and FEAT-001..005 POS paths are
untouched by these changes.

## Build / test verification (concrete evidence)

Established the FEAT-005 baseline by stashing the FEAT-006 changes, building
`90eda2df`, then restoring and rebuilding, and diffing the error sets.

- **api-node** (`npm run build` = `tsc -p tsconfig.json`): exits 1, but ONLY with
  the documented `prisma.<model>`/untyped-`$queryRawUnsafe` errors that exist
  because the Prisma engine CDN is blocked here, so the generated client is a
  stub (`node_modules/.prisma/client/index.d.ts` ≈ 3989 bytes). This is a
  pre-existing, whole-repo condition, not a FEAT-006 regression.
  - Baseline (FEAT-005) tsc error lines: **175**.
  - FEAT-006 tsc error lines: **179** (delta **+4**).
  - Per-file diff: the ONLY file whose error count changed is
    `src/routes/admin-pos.ts` (**2 → 6**, +4). `pos.ts` and `pos-import.ts`
    error counts are unchanged (their line-number differences in a raw diff are
    pure position shifts from added code, not new errors). No non-POS file gained
    any error.
  - The 4 new errors are at the new dashboard/reports raw-SQL calls
    (`admin-pos.ts` lines 170, 181, 194 — `$queryRawUnsafe<T>` generic → TS2347;
    line 207 — `.map()` callback param → TS7006). All are the expected
    stub-Prisma signature and will disappear once `prisma generate` runs on
    deploy. **Zero other new errors.**
- **web** (`npm run build` = generate-sitemap + `tsc -b` + `vite build`):
  **exit 0**. (The build regenerated `web/public/sitemap.xml` to 207 URLs — the
  committed sitemap change.)
- **mobile** (`npm run typecheck` = `tsc --noEmit`): **exit 0, clean.**
- **mobile** (`npm test`, Node test runner): **71 pass / 0 fail**, including the
  FEAT-005 POS invoice footing / no-delivery-row tests.

## Acceptance criteria status (original spec a–h)

FEAT-006 is the final phase; it directly owns (e) and (g) and depends on the
earlier phases for (a)–(d), (f), (h). Status for this phase:

- **(e) Owner push notifications — CODE-COMPLETE; live delivery NEEDS A DEVICE +
  DEPLOY DB.** The triggers (sale/low-stock/out-of-stock/cancel-refund/
  stock-adjust) are wired fire-and-forget into the committed POS paths, resolve
  recipients via `tokensForStaff('pos')` (so all of an owner's registered devices
  are reached and only authorised staff), record a `notifications` history row,
  and fire low/out alerts only on the state transition. Actual FCM delivery to a
  physical device and the `notifications` history row require the deploy DB +
  real device tokens and cannot be exercised in this offline worktree. The code
  path is real (not a scaffold) and is dormant-safe: with no tokens it records a
  0-recipient entry and never throws.
- **(g) Dashboard + reports — CODE-COMPLETE-AND-BUILD-VERIFIED; live numbers NEED
  THE DEPLOY DB.** Endpoints, role gating (403 without `pos_reports`), web
  dashboard strip + reports view + Excel export, and mobile reports screen all
  compile/build/typecheck. The aggregates read runtime-created POS tables, so
  real figures require the deploy DB; query shapes mirror the existing
  `/api/admin/stats` pattern.
- **(a) RBAC** — the new endpoints are guarded by `requireStaff('dashboard' |
  'pos_reports')`; a customer JWT / unauthorised phone is rejected server-side.
  Code-complete; the live-rejection integration check needs the deploy DB.
- **(h) Online storefront/checkout/catalog/SEO unaffected** — FEAT-006 touched
  only POS files + the admin dashboard strip + the sitemap regeneration; no
  change to public catalog or online checkout. Web build (which runs the SEO
  sitemap generator) passed. The public-catalog leakage guard belongs to Phase 1
  and is unchanged.
- **(b) Excel import, (c) product-select billing, (d) exactly-once checkout,
  (f) invoice sharing** — delivered in FEAT-001..005; unchanged here. (d) and the
  import/DB assertions remain DB-gated integration checks per the design's
  testability note.

## Honesty summary

Nothing here is a hidden stub. All FEAT-006 code is wired into the real,
committed POS paths and the real FCM infra. The only items that genuinely cannot
run in this offline worktree are: (1) actual push delivery to a physical device,
(2) DB-backed figures/aggregates and the DB-gated idempotency/RBAC integration
checks — all of which require the deploy DB and real device tokens. The tsc
`prisma.<model>` errors are the known offline-Prisma condition, confined to POS
files and limited to +4 vs the FEAT-005 baseline, with zero other new errors.
