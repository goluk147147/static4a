# 4A Store — Smart Billing & Inventory (POS) — Implementation Plan

Derived from the APPROVED design `.agents/tasks/pos-design.md` (iteration 2,
verdict `APPROVED` in `pos-design-review.json`). This plan sequences that design
faithfully — it does **not** re-decide the architecture. Every item was grounded
in files read during exploration of the worktree
`c:\xampp\htdocs\static4a\.worktrees\pos-billing` (project root
`...\4astore-v2`, apps `api-node`, `web`, `mobile`).

## Working rules (apply to EVERY item)

- **All paths are absolute inside the worktree.** cwd is the parent session, NOT
  the worktree — relative paths land in the wrong tree. Use
  `git -C c:\xampp\htdocs\static4a\.worktrees\pos-billing ...` for git.
- **NEVER run `prisma migrate` / `prisma db push`.** Every schema change is an
  additive, `information_schema`-guarded raw-SQL `ensure*()` in
  `api-node/src/services/dataImport.ts`, mirrored by a Prisma model carrying the
  "created at runtime … do NOT run prisma migrate/db push" comment, plus a manual
  `.sql` under `api-node/prisma/`. (Pattern: `ensureMasterPasswordColumn`,
  `ensureMarketingTables`, `ensureShortLinkTables`.)
- **New `prisma.<model>` delegate-missing tsc errors are EXPECTED** until
  `prisma generate` runs on deploy — they are **not** a regression. `prisma
  generate` may 403 on the engine CDN; do not treat that as failure.
- **No native build:** no AAB, no `expo prebuild`, no gradle. Leave
  `mobile/app.config.ts` `versionCode` ALONE.
- **Money is `DECIMAL(10,2)` / aggregates `DECIMAL(12,2)`; quantity is
  `DECIMAL(10,3)`.** Never floats for money; do all math in integer paise.
- **Protect ALL admin/POS APIs server-side** with the existing
  `requireAuth` + `requireStaff(permission)` / `requireOwner` (never frontend
  hiding alone).
- **Do NOT break** online orders/checkout/catalog/SEO/short-links/marketing.
- **The worktree has NO `node_modules` in any of the three projects** (verified).
  The FIRST verification in each project must `npm install` (api-node, web) /
  `npm install` (mobile) before building. `exceljs@4.4.0` is added to
  `api-node/package.json` then installed.

## Verification commands (discovered during exploration)

- api-node: `npm --prefix c:\xampp\htdocs\static4a\.worktrees\pos-billing\4astore-v2\api-node run build`
  (= `tsc -p tsconfig.json`). Tolerable ONLY: new `prisma.<posModel>` delegate
  errors. Any OTHER new tsc error is a regression and must be fixed.
- web: `npm --prefix c:\xampp\htdocs\static4a\.worktrees\pos-billing\4astore-v2\web run build`
  (= generate-sitemap + `tsc -b` + `vite build`) MUST exit 0.
- mobile: `npm --prefix ...\mobile run typecheck` (= `tsc --noEmit`) clean for
  touched files; `npm --prefix ...\mobile test` (node test runner,
  `src/__tests__/**/*.test.ts`) for shared pure logic.

---

# Phase 1 — DB + backend foundation

- [ ] 1. Add the additive POS schema via runtime `ensure*()` functions.
      In `api-node/src/services/dataImport.ts`, add `ensureProductInventoryColumns()`
      (information_schema-guarded `ALTER TABLE products ADD COLUMN …` for `sku`,
      `barcode`, `purchase_price DECIMAL(10,2)`, `stock DECIMAL(10,3) DEFAULT 0.000`,
      `unit VARCHAR(12) DEFAULT 'pcs'`, `tax_rate DECIMAL(5,2) DEFAULT 0.00`,
      `low_stock_threshold DECIMAL(10,3)`, `track_inventory TINYINT(1) DEFAULT 1`,
      `allow_negative_stock TINYINT(1)`, each swallowing MySQL 1060; plus non-unique
      `idx_products_sku`, `idx_products_barcode`), `ensurePosSettingsColumns()`
      (the §2.3 columns on `settings`, swallow 1060), and `ensurePosTables()`
      (`CREATE TABLE IF NOT EXISTS` for `pos_bills`, `pos_bill_items`,
      `stock_movements`, `admin_phones`, `pos_import_batches`, `product_change_log`
      per §2.2, InnoDB utf8mb4, with the indexes listed in the design). Mirror each
      as a `.sql` under `api-node/prisma/` (`pos-inventory.sql`, `pos-settings.sql`,
      `pos-tables.sql`). Follow `ensureMarketingTables()` byte-for-byte in style.
      Files: `api-node/src/services/dataImport.ts`, `api-node/prisma/pos-inventory.sql`,
      `api-node/prisma/pos-settings.sql`, `api-node/prisma/pos-tables.sql`
      Verify: `npm --prefix ...\api-node run build` — only new `prisma.<model>`
      delegate errors permitted (there are none yet since no model added in this item).

- [ ] 2. Mirror the new tables/columns as Prisma models + fields.
      In `api-node/prisma/schema.prisma` add models `PosBill`, `PosBillItem`,
      `StockMovement`, `AdminPhone`, `PosImportBatch`, `ProductChangeLog` (with
      `@@map` to the snake_case table names) and add the §2.1 inventory fields to the
      existing `Product` model. Each new model carries the runtime-created comment
      ("created at runtime by ensure* in dataImport.ts; do NOT run prisma
      migrate/db push"). Do NOT run prisma migrate/db push/generate.
      Files: `api-node/prisma/schema.prisma`
      Verify: `npm --prefix ...\api-node run build` — new `prisma.<posModel>`
      delegate-missing errors are EXPECTED and tolerated; no OTHER new error.

- [ ] 3. Wire the three ensures into startup.
      In `api-node/src/server.ts`, import the three new functions and call them
      fire-and-forget with `.catch(console.error)` AFTER `ensureMarketingTables()`
      inside the `app.listen` callback (order per §2.4:
      `ensureProductInventoryColumns`, `ensurePosSettingsColumns`, `ensurePosTables`).
      Files: `api-node/src/server.ts`
      Verify: `npm --prefix ...\api-node run build` passes (only expected prisma errors).

- [ ] 4. Guard the public catalog against inventory/cost leakage.
      In `api-node/src/routes/catalog.ts` define one `PUBLIC_PRODUCT_SELECT`
      allow-list (id, name, category, price, mrp, discount, image, description,
      unit, in_stock, stock, and all pre-existing public columns) and apply
      `select: PUBLIC_PRODUCT_SELECT` to BOTH `GET /api/products` (findMany) AND
      `GET /api/products/:id` (findUnique). Exclude `purchase_price`,
      `low_stock_threshold`, `allow_negative_stock`, `track_inventory`. Audit any
      other `prisma.product.findMany/findUnique` in `routes/` and `seo/` and apply
      the same select. (§2.1a — fatal if a cost/control field leaks.)
      Files: `api-node/src/routes/catalog.ts` (+ any other public product read found)
      Verify: `npm --prefix ...\api-node run build` passes; add/run the §10 leakage
      shape test (see item 7) asserting neither payload has `purchase_price` etc.

- [ ] 5. Extract shared session helpers (prereq for phone-OTP, finding 2).
      Create `api-node/src/auth/session.ts` and MOVE `issueTokens`, `safeUser`,
      `toClaims`, `isMobileClient` (+ the `cookieOpts`, `REFRESH_COOKIE`,
      `ACCESS_COOKIE` they depend on) out of `routes/users.ts`, exporting them.
      Re-point `routes/users.ts` to import them (optionally re-export) so its login
      shape `{ user: safeUser(user), token, ...(isMobileClient ? { refreshToken } :
      {}) }` is byte-for-byte unchanged. Pure move, no behavioural change.
      Files: `api-node/src/auth/session.ts`, `api-node/src/routes/users.ts`
      Verify: `npm --prefix ...\api-node run build` passes; existing users/login
      routes compile unchanged.

- [ ] 6. Phone allowlist + phone-OTP auth + RBAC keys.
      Add new permission keys `pos`, `inventory`, `pos_reports` to `ALLOWED_PERMS`
      in `api-node/src/routes/admin.ts`. Create `routes/pos-auth.ts`
      (`/api/pos/auth/otp/send` + `/verify`, both PUBLIC, zod-validated
      `^[6-9]\d{9}$` / `^\d{6}$`, OTP in `email_otps` with `purpose='pos_login'`,
      `email='pos:<mobile>'`, enumeration-safe generic 200, `devOtp` in non-prod,
      delivery via `tokensForStaff`+`sendToTokens`, rate-limited via
      `utils/rateLimit.ts`; verify upserts the user by mobile with role
      owner|admin + permissions and calls shared `issueTokens`). Create
      `routes/admin-pos.ts` (`GET/POST /api/admin/pos/phones`,
      `DELETE /api/admin/pos/phones/:mobile` — `requireOwner`; add/update/revoke
      `admin_phones`, demote user + revoke refresh tokens on removal, self-removal
      409). Mount both in `server.ts` (`admin-pos` BEFORE generic `/api/admin`,
      like `admin-links`; `pos-auth` under `/api/pos/auth`).
      Files: `api-node/src/routes/pos-auth.ts`, `api-node/src/routes/admin-pos.ts`,
      `api-node/src/routes/admin.ts`, `api-node/src/server.ts`
      Verify: `npm --prefix ...\api-node run build` — only expected prisma errors.

- [ ] 7. Backend unit test harness + leakage test.
      api-node has no test runner today. Add a minimal `node --test` setup (dev-dep
      free: use Node's built-in `node:test` + `ts-node` already present) or a tiny
      script, and write the §10 public-catalog leakage shape test asserting the
      response shapes of both `GET /api/products` and `/products/:id` carry no
      `purchase_price`/`low_stock_threshold`/`allow_negative_stock`/`track_inventory`.
      Files: `api-node/src/__tests__/catalogLeakage.test.ts` (+ test wiring)
      Verify: run the new test; it passes. `npm --prefix ...\api-node run build`
      still only shows expected prisma errors.

# Phase 2 — Billing + stock engine

- [ ] 8. POS billing service (pure money math + tx helpers).
      Create `api-node/src/services/posBilling.ts` owning ALL money/quantity math in
      integer paise (`round2`, line_total, line_tax, subtotal, tax_total,
      grand_total per §4.3), quantity/rate/discount validation bounds, and the
      bill-number formatter. Server ALWAYS recomputes catalogue-line totals from the
      authoritative product price/tax_rate; never trusts client totals. Fix the
      §4.2 off-by-one (NIT 1): seed `pos_next_bill_seq=0` OR read-then-increment so
      the first invoice is `INV-000001`.
      Files: `api-node/src/services/posBilling.ts`
      Verify: unit test (item 11) covers paise rounding, 0.5 kg / 500 g lines, ₹1 and
      ₹100000 bounds; `npm --prefix ...\api-node run build` only shows expected errors.

- [ ] 9. POS bills router — idempotent, transactional checkout + hold/history.
      Create `api-node/src/routes/pos.ts` mounted `/api/pos` (all `requireAuth`),
      with `GET /products/search` (`requireStaff('pos')`), `POST /bills`
      (idempotency pre-check on `uq_pos_bills_idem`, `prisma.$transaction` with
      `SELECT … FOR UPDATE` row locks, stock check honoring per-product +
      global negative-stock, bill-number reservation inside the tx, insert bill +
      items, `UPDATE products SET stock=…, in_stock=…`, insert `stock_movements`
      `reason='sale'`; duplicate key → return existing bill `{idempotent:true}`),
      `POST /bills/hold` (no stock move, `bill_no=NULL`), `GET /bills` (keyset),
      `GET /bills/:billNo`, `GET /bills/id/:id` (reopen held). Mount in `server.ts`.
      Files: `api-node/src/routes/pos.ts`, `api-node/src/server.ts`
      Verify: `npm --prefix ...\api-node run build` — only expected prisma errors.

- [ ] 10. Cancel / refund controlled reversal + audit.
      Add `POST /api/pos/bills/:billNo/cancel` and `/refund` (`requireStaff('pos')`)
      to `routes/pos.ts`: in a transaction, guard status is `completed` (idempotent
      no-op if already cancelled/refunded), restock each catalogue line, recompute
      `in_stock`, insert `stock_movements` reversal rows (positive change_qty), set
      status + `cancelled_by` + `cancel_reason`.
      Files: `api-node/src/routes/pos.ts`
      Verify: `npm --prefix ...\api-node run build` — only expected prisma errors.

- [ ] 11. Billing unit test + idempotency/transaction proof (acceptance d).
      Unit-test `posBilling.ts` math. For the transactional/idempotent guarantee:
      write a focused test proving a retried/duplicated checkout (same
      `idempotencyKey`) deducts stock exactly once and that cancel restores it. If
      the DB is unreachable in this environment, write the test, state it needs the
      deploy DB, AND prove idempotency by a precise transaction + idempotency-key
      code walkthrough in the test file comments / findings.
      Files: `api-node/src/__tests__/posBilling.test.ts`
      Verify: run the test (unit parts pass); document the DB-gated integration part.

# Phase 3 — Excel import / export

- [ ] 12. Add `exceljs@4.4.0` + import/export router.
      Add `"exceljs": "4.4.0"` (exact pin) to `api-node/package.json` dependencies
      and `npm install`. Create `routes/pos-import.ts` mounted `/api/admin/pos`
      (`requireStaff('inventory')`) using existing `multer` (memory, 5 MB, xlsx/csv
      by ext + magic bytes). Endpoints per §6.1: `POST /import/preview` (parse +
      per-row validate + duplicate detect, NO product write, create
      `pos_import_batches status='previewed'`), `POST /import/commit` (re-validate,
      ONE transaction insert/update + `product_change_log` + `stock_movements`
      `reason='import'`, recompute `in_stock`, update counters), `GET
      /export/products.xlsx`, `POST /bulk-update`, `GET /import/history`, `GET
      /change-log`. CSV via a small internal RFC-4180 splitter (no dep). Mount in
      `server.ts` before generic `/api/admin`.
      Files: `api-node/package.json`, `api-node/src/routes/pos-import.ts`,
      `api-node/src/server.ts`
      Verify: `npm --prefix ...\api-node run build` — only expected prisma errors;
      `exceljs` resolves.

- [ ] 13. Excel validation unit test.
      Extract row validation + duplicate-detection (sku→barcode→name+category
      precedence) into a pure function and unit-test it with fixture rows including
      error rows (per §6.2).
      Files: `api-node/src/__tests__/excelValidation.test.ts` (+ pure helper if split)
      Verify: run the test; it passes.

# Phase 4 — POS UI (web + mobile, parity)

- [ ] 14. Web POS data layer + admin tabs/routes.
      Create `web/src/lib/pos.ts` (react-query hooks over `lib/api.ts`, following
      `pages/admin/adminData.ts`). Add tabs to `ADMIN_TABS` in
      `web/src/pages/admin/AdminApp.tsx` (keys `pos`, `pos`, `inventory`,
      `inventory`, `pos_reports`, owner-only) and routes under `/admin` in `App.tsx`
      for `AdminPos`, `AdminPosHistory`, `AdminInventory`, `AdminPosImport`,
      `AdminPosReports`, `AdminPosAccess` — gated by the existing
      `canAdmin(role, perms, key)` nav filter.
      Files: `web/src/lib/pos.ts`, `web/src/pages/admin/AdminApp.tsx`,
      `web/src/App.tsx`
      Verify: `npm --prefix ...\web run build` exits 0.

- [ ] 15. Web POS billing screen + inventory/import/access/history pages.
      Create `web/src/pages/admin/AdminPos.tsx` (responsive two-pane search/scan +
      cart; `+`/`−` steppers; decimal qty for weight units; barcode = fast-burst
      Enter → exact SKU/barcode lookup; idempotencyKey via `useRef` per cart;
      minimal-click Charge), `AdminPosHistory.tsx`, `AdminInventory.tsx`,
      `AdminPosImport.tsx` (upload → preview table with row errors → commit;
      bulk-update; export), `AdminPosReports.tsx`, `AdminPosAccess.tsx` (phone
      allowlist, owner-only).
      Files: the six `web/src/pages/admin/AdminPos*.tsx` / `AdminInventory.tsx`
      Verify: `npm --prefix ...\web run build` exits 0.

- [ ] 16. Mobile POS data layer + screens (JS/TS only, no native modules).
      Create `mobile/src/pos.ts` (react-query over `src/api.ts`). Add expo-router
      screens following the existing `app/admin/orders.tsx` guard pattern
      (`canAdmin` + `router.replace('/login')` bounce): `app/admin/pos.tsx`,
      `pos-history.tsx`, `pos-bill/[billNo].tsx`, `inventory.tsx`, `pos-import.tsx`
      (explains Excel runs on web; offers bulk/single edit via same `/api/admin/pos`
      endpoints — NO file picker, no new native module), `pos-reports.tsx`,
      `pos-access.tsx` (owner). Single-column thumb-reachable billing layout.
      Files: `mobile/src/pos.ts`, `mobile/app/admin/pos.tsx`,
      `mobile/app/admin/pos-history.tsx`, `mobile/app/admin/pos-bill/[billNo].tsx`,
      `mobile/app/admin/inventory.tsx`, `mobile/app/admin/pos-import.tsx`,
      `mobile/app/admin/pos-reports.tsx`, `mobile/app/admin/pos-access.tsx`
      Verify: `npm --prefix ...\mobile run typecheck` clean for touched files.

# Phase 5 — Invoice (PDF, WhatsApp, print, share, copy)

- [ ] 17. Shared invoice template + adapters (web browser-print, mobile expo-print).
      Create `web/src/lib/posInvoice.ts` as a NEW file (do NOT touch the legacy
      jsPDF `web/src/lib/invoice.ts` for online orders): the shared Unicode HTML
      template (generalised from `mobile/src/invoice.ts`) with a `kind:'pos'` flag
      that OMITS the Delivery row and renders Tax (when >0) + Payment method/status
      instead (finding 5), rendering server-computed `line_total`/`subtotal`/
      `tax_total`/`grand_total` VERBATIM (no `price*quantity` recompute, finding 6);
      plus a hidden-iframe `print()` helper (Print + Save-as-PDF, zero new deps) and
      a `billToInvoice` adapter. Extend `mobile/src/invoice.ts` with a POS
      `billToInvoice` + `kind:'pos'` branch reusing its expo-print path. Reads live
      `settings.store_address` (romanized), Devanagari string only as blank fallback.
      Files: `web/src/lib/posInvoice.ts`, `mobile/src/invoice.ts`
      Verify: `npm --prefix ...\web run build` exits 0; `npm --prefix ...\mobile run
      typecheck` clean; add footing test (item 18).

- [ ] 18. Invoice actions wiring + footing/no-delivery tests.
      Wire the five actions into the bill-detail views: WhatsApp (web
      `lib/whatsapp.ts openWhatsApp`, mobile `src/native.ts openWhatsApp` with the
      §8.3 text summary), Download PDF (web print dialog, mobile `printToFileAsync`→
      `expo-sharing`), Print, Native Share (web `navigator.share({text})`, mobile
      `Share`/`expo-sharing` PDF), Copy (web `navigator.clipboard`, mobile
      `expo-clipboard`). Add a shared test asserting `billToInvoice` output foots to
      `grand_total` for a 0.5 kg line and shows no Delivery row for `kind:'pos'`.
      Files: `web/src/lib/posInvoice.ts`, `mobile/src/invoice.ts`, bill-detail
      components (web `AdminPosHistory.tsx`/detail, mobile `pos-bill/[billNo].tsx`),
      `mobile/src/__tests__/posInvoice.test.ts`
      Verify: `npm --prefix ...\mobile test` passes; web + mobile builds/typecheck clean.

# Phase 6 — Push notifications + dashboard + reports

- [ ] 19. POS notifications service wired into checkout/reversal/adjustments.
      Create `api-node/src/services/posNotify.ts` with typed helpers (`sale`,
      `lowStock`, `outOfStock`, `cancelRefund`, `stockAdjust`) resolving recipients
      via `tokensForStaff('pos')`, each wrapped in `.catch(()=>null)` +
      `recordNotification(...)` (new types `pos_sale`, `pos_low_stock`,
      `pos_out_of_stock`, `pos_cancel`, `pos_stock_adjust`). Low-stock fires only on
      the TRANSITION into low/out state (compare previous stock vs `balance_after`).
      Wire fire-and-forget after checkout commit (gated by `pos_sale_notifications`),
      after reversal commit, and on significant manual/bulk adjustments.
      Files: `api-node/src/services/posNotify.ts`, `api-node/src/routes/pos.ts`,
      `api-node/src/routes/pos-import.ts`
      Verify: `npm --prefix ...\api-node run build` — only expected prisma errors.

- [ ] 20. Dashboard summary + reports endpoints + Excel export, web + mobile.
      Add `GET /api/admin/pos/dashboard` (`requireStaff('dashboard')`, raw-SQL
      aggregate like `/api/admin/stats`) and `GET /api/admin/pos/reports`
      (`requireStaff('pos_reports')`, day/week/month aggregates over
      `pos_bills`/`pos_bill_items`/`stock_movements`: total sales, #bills,
      discounts, refunds, payment-method summary, best-sellers, low/out-of-stock)
      plus `GET /api/admin/pos/reports/export.xlsx` (reuse the §6 exceljs writer).
      Add a POS summary strip to web `AdminDashboard.tsx` and populate
      `AdminPosReports.tsx` + mobile `pos-reports.tsx`. Sensitive (purchase
      price/profit) reports require `pos_reports` (403 otherwise).
      Files: `api-node/src/routes/admin-pos.ts` (or `routes/pos.ts`),
      `web/src/pages/admin/AdminDashboard.tsx`,
      `web/src/pages/admin/AdminPosReports.tsx`,
      `mobile/app/admin/pos-reports.tsx`
      Verify: api-node build (only expected prisma errors); `npm --prefix ...\web run
      build` exits 0; `npm --prefix ...\mobile run typecheck` clean.

# Phase 7 — Integration verification (whole-feature)

- [ ] 21. Cross-cutting build + acceptance verification.
      Run all three builds green (api-node tsc with only expected prisma delegate
      errors; `web` build exit 0; mobile typecheck + `npm test`). Confirm acceptance
      criteria a–h against the code paths: (a) unauthorised phone/customer JWT
      rejected by every `/api/pos/*` + `/api/admin/pos/*`; (b) Excel import visible in
      DB; (c) bill via product select + qty change; (d) sale deducts stock exactly
      once (idempotency test); (e) low-stock push to owner devices; (f) invoice
      WhatsApp/PDF/print; (g) history/stock movements/reports consistent; (h) online
      storefront/checkout/catalog/SEO unaffected (leakage test green).
      Files: none (verification only)
      Verify: all three build/test commands pass as specified above.

---

## Decisions / assumptions recorded by the planner

- **Phase→feature mapping.** The six design phases are the natural
  dependency-ordered units; this plan preserves that order. If the workflow tail
  is restructured into FEAT artifacts, Phase 1 and Phase 2 are merged into one
  backend-foundation+engine feature only if a coder prefers, but the default is
  one FEAT per phase (see `.agents/tasks/features`).
- **No `node_modules` in the worktree (verified).** Each project must `npm
  install` before its first build; `exceljs@4.4.0` is installed with Phase 3.
- **`react-native-view-shot@4.0.3` and `@react-native-firebase/messaging@22.4.0`
  ARE present** in `mobile/package.json` (design NIT 3 resolved — the "already
  present" claim is correct; neither is load-bearing for invoice/push anyway).
- **Expected tsc errors are ONLY the new `prisma.<posModel>` delegates.** Any
  other new error is a regression a coder must fix before marking done.
