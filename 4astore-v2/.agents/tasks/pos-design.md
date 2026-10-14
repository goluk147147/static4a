# 4A Store — Smart Billing & Inventory (POS) — Technical Design

Status: Phase 0 (design). **Iteration 2** — revised in response to
`.agents/tasks/pos-design-review.json` (verdict `CHANGES_REQUESTED`: 1 HIGH, 4
MEDIUM, 2 NIT). Every finding is addressed in the body and summarised in §13.
Changes were re-verified against source (`web/src/lib/invoice.ts`,
`mobile/src/invoice.ts`, `routes/users.ts`, `routes/catalog.ts`,
`four_a_store_live.sql`).

Scope: an **in-store counter POS + inventory module** added to the existing 4A
Store v2 app on **both web and mobile**, sharing the one `four_a_store`
MariaDB/MySQL database and the one `api-node` Express backend. The POS is
**separate** from the existing online-order flow. The online storefront,
checkout, catalog, SEO, short-links, marketing, push, rider tracking and the
existing admin panel must keep working unchanged.

---

## 1. Overview

The feature adds a counter-sales subsystem that reuses the entire existing
stack: Express + Prisma + raw-SQL on `api-node`, React + Vite on `web`, and Expo
SDK 54 + expo-router on `mobile`. It extends the existing `products` table with
inventory columns (one stock figure serving both the online store and the
counter), adds new tables for bills, bill items, stock movements, phone-based
admin allowlisting, Excel import batches and a product change log, and layers a
set of guarded `/api/pos/*` and `/api/admin/pos/*` endpoints onto the existing
auth + RBAC middleware.

The design follows the repo's hard conventions exactly:

- **No `prisma migrate` / `prisma db push`, ever.** Every schema change is
  additive and applied at runtime by an idempotent, `information_schema`-guarded
  raw-SQL `ensure*()` function in `api-node/src/services/dataImport.ts`, mirrored
  by a Prisma model carrying the "created at runtime … do NOT run prisma migrate
  / db push" comment, plus a manual `.sql` file under `api-node/prisma/`.
- **Prisma generate may fail on the engine CDN (403/TLS).** That is a known
  limitation. We rely on `tsc`. New `prisma.<model>` delegate-missing tsc errors
  are **expected** before `prisma generate` runs on deploy and are **not** a
  regression.
- **Money is `DECIMAL(10,2)`, quantity is `DECIMAL(10,3)`.** Never floats for
  money. Prices span ₹1–₹100000; quantities span 10 g to 50 kg plus piece
  counts.
- **Every new admin/POS API uses the existing guard pattern** (`requireAuth` +
  `requireStaff(permission)` / `requireOwner`), never frontend hiding alone.
- **No native binary work.** Mobile stays JS/TS only — no AAB, no
  `expo prebuild`, no gradle. `app.config.ts` `versionCode` is left alone. All
  mobile deps needed (`expo-print`, `expo-sharing`, `expo-clipboard`,
  `@notifee/react-native`, `@react-native-firebase/messaging`,
  `react-native-view-shot`) are already in `mobile/package.json`.

### 1.1 Technology stack (LOCKED on approval)

| Layer | Technology (existing, reused) |
|---|---|
| Backend | Node 20, Express 4, TypeScript 5.5, Prisma 5 client + raw SQL, MariaDB/MySQL `four_a_store` |
| Auth | JWT access + hashed refresh token (`auth/jwt.ts`, `auth/middleware.ts`); email-OTP table `email_otps` extended with POS phone-OTP purpose |
| Push | FCM via `firebase-admin` (`services/push.ts`), `fcm-service-account.json`; mobile `@react-native-firebase/messaging` + `@notifee/react-native` |
| Web | React 18, Vite 5, react-router-dom 6, @tanstack/react-query 5, zustand, axios; POS invoice via **browser print pipeline** (hidden-iframe `print()` → Print or "Save as PDF"), Unicode-safe, **no new deps** — see §8.0. The legacy jsPDF-core order invoice is untouched. |
| Mobile | Expo SDK 54, expo-router 6, react-query 5, zustand; PDF via `expo-print`, share via `expo-sharing`/`react-native` `Share`, copy via `expo-clipboard` |
| Excel | **New backend-only dependency `exceljs` (pinned `4.4.0`)** — see §6. No new web/mobile deps. |

**Decision — Excel parsing lives on the server, not the client.** `exceljs`
reads `.xlsx`; `.csv` is parsed with a small hand-written RFC-4180 splitter (no
extra dep). This keeps validation, duplicate-detection and the DB write in one
transaction-capable place, keeps the web/mobile bundles unchanged, and lets both
clients use the identical preview/commit API. Rejected alternative: client-side
`SheetJS` (would duplicate validation logic across web + mobile and bypass
server-side safety). `exceljs` is a well-known, actively maintained package;
pinned to an exact version per the dependency convention.

---

## 2. Data model

All new columns are nullable or defaulted so existing rows and the online flow
are untouched. All new tables are InnoDB / utf8mb4, created by `ensure*()` at
startup (idempotent `CREATE TABLE IF NOT EXISTS`), mirrored by Prisma models and
a manual SQL file.

### 2.1 Additive `products` inventory columns

Added by `ensureProductInventoryColumns()` (information_schema-guarded ALTERs,
swallow MySQL 1060 duplicate-column — mirrors `ensureMasterPasswordColumn()`).
Manual equivalent: `prisma/pos-inventory.sql`. Mirrored on the Prisma `Product`
model with the runtime-created comment.

| Column | Type | Default | Purpose |
|---|---|---|---|
| `sku` | `VARCHAR(64)` | NULL | Stock-keeping unit; unique **when present** (see note) |
| `barcode` | `VARCHAR(64)` | NULL | Scanned/typed barcode; unique when present |
| `purchase_price` | `DECIMAL(10,2)` | NULL | Cost price (owner/reports only, never public) |
| `stock` | `DECIMAL(10,3)` | `0.000` | Current on-hand quantity (shared online + in-store) |
| `unit` | `VARCHAR(12)` | `'pcs'` | `pcs` \| `g` \| `kg` \| `ml` \| `l` \| … |
| `tax_rate` | `DECIMAL(5,2)` | `0.00` | Percent GST applied to line |
| `low_stock_threshold` | `DECIMAL(10,3)` | NULL | Per-product low-stock trigger (e.g. 2 pcs) |
| `track_inventory` | `TINYINT(1)` | `1` | When 0, product is never stock-checked/deducted |
| `allow_negative_stock` | `TINYINT(1)` | NULL | Per-product override of the global negative-stock setting |

Notes / decisions:

- **`in_stock` (existing boolean) is kept and derived.** The online storefront
  already reads `in_stock`. When `track_inventory = 1`, a stock write sets
  `in_stock = (stock > 0 OR allow_negative_stock)` so the online catalog stays
  truthful automatically. When `track_inventory = 0`, `in_stock` is left under
  manual admin control exactly as today. This is the single integration point
  with the online flow and is covered by acceptance criterion (h).
- **Uniqueness of `sku`/`barcode` is enforced in the application layer, not a DB
  unique index.** A unique index on a nullable column that is NULL for every
  legacy product is fine in MySQL (multiple NULLs allowed), but adding it at
  runtime over a large existing table risks a slow ALTER and a hard failure if
  any dirty duplicates already exist. Instead the import/edit layer checks
  uniqueness with a `SELECT … WHERE sku = ?` (and `barcode`) before insert. We
  add plain non-unique indexes `idx_products_sku`, `idx_products_barcode` for
  lookup speed. **Invariant owner:** the POS service layer owns SKU/barcode
  uniqueness; documented here because it is not a DB constraint.
- `purchase_price` is **never** returned by the public `GET /api/products`
  (that route is unchanged and selects via Prisma without these fields unless we
  add them — see §2.1a). It is only exposed on guarded `/api/admin/pos/*` reads.

#### 2.1a Public-catalog leakage guard

**Both** public product reads in `routes/catalog.ts` return all columns today
and must be fixed (review finding 3):

- `GET /api/products` → `prisma.product.findMany({ orderBy: { id: 'asc' } })`
  (returns every column).
- `GET /api/products/:id` → `prisma.product.findUnique({ where: { id } })`
  (returns every column — the review confirmed this endpoint has **no**
  `select`, so once the Prisma `Product` model gains the inventory fields it
  leaks `purchase_price` for a single product).

Once the Prisma `Product` model gains the inventory fields, both endpoints would
start returning `purchase_price`, `low_stock_threshold`, `allow_negative_stock`,
`track_inventory`. **Decision:** define one shared public projection constant in
`routes/catalog.ts`, e.g.

```ts
// Explicit allow-list for every PUBLIC product read. Never add cost/inventory-
// control fields here. Enforced by the §10 leakage test on BOTH payloads.
const PUBLIC_PRODUCT_SELECT = {
  id: true, name: true, category: true, price: true, mrp: true,
  discount: true, image: true, description: true, unit: true,
  in_stock: true, stock: true, /* …all existing public columns… */
} satisfies Prisma.ProductSelect;
```

and apply `select: PUBLIC_PRODUCT_SELECT` to **both** `findMany` (list) **and**
`findUnique` (single) — plus any other public product read that may exist in
`og`/`seo` helpers (audit `findMany`/`findUnique` on `prisma.product` across
`routes/`). `stock`, `unit`, `in_stock` stay public so the storefront can show
"only N left"; `purchase_price`, `low_stock_threshold`, `allow_negative_stock`,
`track_inventory` are **excluded**. This mirrors the existing explicit allow-list
discipline used for `settings`. **Validation:** the §10 leakage test asserts that
the response bodies of **both** `GET /api/products` and `GET /api/products/:id`
have no `purchase_price` (and no `low_stock_threshold`/`allow_negative_stock`/
`track_inventory`) key. Fatal if violated — reviewer must block.

### 2.2 New tables

**`pos_bills`** (Prisma `PosBill`, map `pos_bills`)

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `bill_no` | `VARCHAR(20)` UNIQUE **NULL** | e.g. `INV-000123` (see §4.2); NULL while a bill is `held` — assigned only on the held→completed transition and on direct completed inserts. MySQL allows multiple NULLs under a unique index (same treatment as `idempotency_key`). |
| `idempotency_key` | `CHAR(36)` UNIQUE NULL | client-supplied UUID; enforces exactly-once checkout (§5) |
| `status` | `VARCHAR(16)` | `held` \| `completed` \| `cancelled` \| `refunded` |
| `customer_name` | `VARCHAR(120)` NULL | optional |
| `customer_mobile` | `VARCHAR(15)` NULL | optional |
| `subtotal` | `DECIMAL(12,2)` | |
| `discount` | `DECIMAL(12,2)` default 0 | bill-level discount |
| `tax_total` | `DECIMAL(12,2)` default 0 | sum of line taxes |
| `grand_total` | `DECIMAL(12,2)` | payable |
| `amount_paid` | `DECIMAL(12,2)` default 0 | for partial payments |
| `balance_due` | `DECIMAL(12,2)` default 0 | `grand_total - amount_paid` |
| `payment_method` | `VARCHAR(20)` | `cash` \| `upi` \| `other` \| `split` |
| `payment_status` | `VARCHAR(12)` | `paid` \| `partial` \| `pending` |
| `payments_json` | `JSON` NULL | breakdown when split (method→amount) |
| `note` | `VARCHAR(500)` NULL | |
| `created_by` | `VARCHAR(64)` | username/id of staff who created it |
| `cancelled_by` | `VARCHAR(64)` NULL | audit |
| `cancel_reason` | `VARCHAR(255)` NULL | |
| `created_at` | `DATETIME(3)` default now | timestamp |
| `updated_at` | `DATETIME(3)` | |

Indexes: `uq_pos_bills_bill_no`, `uq_pos_bills_idem (idempotency_key)`,
`idx_pos_bills_created (created_at)`, `idx_pos_bills_status (status)`,
`idx_pos_bills_mobile (customer_mobile)`.

Decimal width is `(12,2)` on bill aggregates (not `(10,2)`) so a cart of many
₹100000 items cannot overflow; line/product money stays `(10,2)`.

**`pos_bill_items`** (Prisma `PosBillItem`, map `pos_bill_items`)

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `bill_id` | `BIGINT UNSIGNED` | FK → `pos_bills.id` ON DELETE CASCADE |
| `product_id` | `BIGINT UNSIGNED` NULL | NULL for off-catalogue manual items |
| `name` | `VARCHAR(200)` | snapshot at sale time |
| `sku` | `VARCHAR(64)` NULL | snapshot |
| `unit` | `VARCHAR(12)` | snapshot |
| `quantity` | `DECIMAL(10,3)` | supports 0.500 kg etc. |
| `rate` | `DECIMAL(10,2)` | unit selling price at sale time |
| `tax_rate` | `DECIMAL(5,2)` default 0 | snapshot |
| `line_total` | `DECIMAL(12,2)` | `round(quantity*rate) (+tax)` — see §4.3 |
| `is_manual` | `TINYINT(1)` default 0 | off-catalogue line |

Index: `idx_pos_bill_items_bill (bill_id)`, `idx_pos_bill_items_product (product_id)`.
Items are **snapshots** — editing a product later never rewrites historic bills.

**`stock_movements`** (Prisma `StockMovement`, map `stock_movements`)

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `product_id` | `BIGINT UNSIGNED` | FK → `products.id` |
| `change_qty` | `DECIMAL(10,3)` | signed: negative = sale, positive = restock/reversal |
| `balance_after` | `DECIMAL(10,3)` | stock value immediately after this movement |
| `reason` | `VARCHAR(24)` | `sale` \| `cancel_reversal` \| `refund_reversal` \| `import` \| `manual_adjust` \| `bulk_update` |
| `bill_no` | `VARCHAR(20)` NULL | links to the bill when reason is sale/reversal |
| `batch_id` | `BIGINT UNSIGNED` NULL | links to `pos_import_batches` for imports |
| `note` | `VARCHAR(255)` NULL | |
| `created_by` | `VARCHAR(64)` | who |
| `created_at` | `DATETIME(3)` default now | |

Indexes: `idx_stock_mov_product (product_id)`, `idx_stock_mov_bill (bill_no)`,
`idx_stock_mov_created (created_at)`. This is the append-only audit trail; it is
never updated or deleted.

**`admin_phones`** (Prisma `AdminPhone`, map `admin_phones`) — phone allowlist

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `mobile` | `VARCHAR(15)` UNIQUE | authorised number (`^[6-9]\d{9}$`) |
| `role` | `VARCHAR(16)` | `owner` \| `staff` |
| `permissions` | `JSON` NULL | staff permission list (same keys as existing RBAC) |
| `name` | `VARCHAR(120)` NULL | label for the owner |
| `active` | `TINYINT(1)` default 1 | soft-disable without deleting |
| `added_by` | `VARCHAR(64)` NULL | audit |
| `created_at` | `DATETIME(3)` default now | |

Index: `uq_admin_phones_mobile`.

**`pos_import_batches`** (Prisma `PosImportBatch`, map `pos_import_batches`)

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `filename` | `VARCHAR(255)` | original upload name |
| `status` | `VARCHAR(16)` | `previewed` \| `committed` \| `failed` |
| `total_rows` | `INT` default 0 | |
| `inserted` | `INT` default 0 | |
| `updated` | `INT` default 0 | |
| `skipped` | `INT` default 0 | |
| `errors` | `INT` default 0 | |
| `error_json` | `JSON` NULL | row-wise error list (persisted for the history view) |
| `created_by` | `VARCHAR(64)` | |
| `created_at` | `DATETIME(3)` default now | |

Index: `idx_pos_import_batches_created (created_at)`.

**`product_change_log`** (Prisma `ProductChangeLog`, map `product_change_log`)

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK AI | |
| `product_id` | `BIGINT UNSIGNED` NULL | NULL if product deleted |
| `field` | `VARCHAR(32)` | which field changed (`price`, `stock`, `selling_price`, …) |
| `old_val` | `VARCHAR(255)` NULL | |
| `new_val` | `VARCHAR(255)` NULL | |
| `source` | `VARCHAR(24)` | `import` \| `bulk_update` \| `edit` \| `pos_adjust` |
| `batch_id` | `BIGINT UNSIGNED` NULL | |
| `actor` | `VARCHAR(64)` | |
| `created_at` | `DATETIME(3)` default now | |

Indexes: `idx_pcl_product (product_id)`, `idx_pcl_created (created_at)`.

### 2.3 Additive `settings` columns (POS-wide toggles)

Added by `ensurePosSettingsColumns()` (information_schema-guarded, swallow 1060).
`settings` is a raw-SQL table (not a Prisma model) — consistent with the repo.

| Column | Type | Default | Purpose |
|---|---|---|---|
| `pos_allow_negative_stock` | `TINYINT(1)` | 0 | global negative-stock allow (per-product column overrides) |
| `pos_sale_notifications` | `TINYINT(1)` | 1 | fire owner push on completed sale |
| `pos_bill_prefix` | `VARCHAR(8)` | `'INV-'` | invoice-number prefix |
| `pos_next_bill_seq` | `BIGINT UNSIGNED` | 1 | monotonically increasing bill counter (see §4.2) |
| `pos_allow_manual_items` | `TINYINT(1)` | 1 | permit off-catalogue lines |
| `store_address` | existing | — | reused for invoice; default seeded below |

`store_address` already exists. **Corrected per finding 7:** the invoice reads
the *live* `settings.store_address` value, which is the **romanized** string
`'Gajna Road, Chandargarh, Nabinagar, Aurangabad, Bihar - 824301'` (verified in
`four_a_store_live.sql`), together with `settings.store_phone` and
`settings.upi_name`. The Devanagari string
`4A KIRANA STORE, गाजना रोड, चंद्रगढ़, नबीनगर, औरंगाबाद, बिहार – 824301` is used
**only as a hard-coded fallback** when `store_address` is blank — it is not the
live value. The owner can edit `store_address` in settings to any string
(including the Devanagari one) and the invoice (now Unicode-capable per §8) will
render it. `GET /api/settings` public allow-list is **not** extended with any POS
column (they are owner/staff-only; read via `/api/admin/pos/settings`).

### 2.4 Startup wiring

In `server.ts`, beside the existing `ensure*` calls, add (each
`.catch(e => console.error(...))`, fire-and-forget, order after
`ensureMarketingTables`):

```
ensureProductInventoryColumns()
ensurePosSettingsColumns()
ensurePosTables()        // pos_bills, pos_bill_items, stock_movements,
                         // admin_phones, pos_import_batches, product_change_log
```

`ensurePosTables()` creates all six tables with `CREATE TABLE IF NOT EXISTS`.
Manual equivalents: `prisma/pos-inventory.sql`, `prisma/pos-settings.sql`,
`prisma/pos-tables.sql`.

---

## 3. Auth & RBAC extension (phone allowlist + OTP)

### 3.1 Model

The existing system already has `owner`/`superadmin`/`admin` roles with a JSON
`permissions` array and the `requireStaff(permission)` middleware. POS adds a
**phone allowlist** so the owner can authorise a mobile number *before* that
person is a staff user, and an **OTP login by phone**.

**Decision — reuse the user `role`/`permissions` as the source of truth for API
authorization; `admin_phones` is the owner-managed allowlist that drives
OTP login and seeds the user's role on first login.** On a successful phone-OTP
login we look up `admin_phones` by mobile; if present and `active`, we upsert the
matching `users` row (match by `mobile`) to `role = owner|admin` with the stored
`permissions`, then issue the normal JWT via the shared `issueTokens()` (see the
extraction note below). This means every existing guard (`requireStaff`,
`hasPermission`) keeps working unchanged — the JWT claims already carry `role` +
`permissions`. Rejected alternative: a parallel POS-only permission system (would
duplicate `requireStaff` and risk drift).

**Required refactor (finding 2) — extract the shared session helpers.** The
token/cookie helpers `issueTokens`, `safeUser`, `toClaims` and `isMobileClient`
are currently **module-private** in `routes/users.ts` (the file only
`export default router`), so `routes/pos-auth.ts` cannot import them and must not
duplicate them (duplication risks drift in cookie flags, refresh-token hashing
and the `X-Client: mobile` handling). **Phase 1 adds an explicit refactor step:**
move these four functions into a new `api-node/src/auth/session.ts` and export
them (`export { issueTokens, safeUser, toClaims, isMobileClient }`);
`routes/users.ts` imports them from there (and may re-export for backward
compatibility) so its behaviour is byte-for-byte unchanged; `routes/pos-auth.ts`
imports the **same** symbols. The returned login shape
`{ user: safeUser(user), token, ...(isMobileClient ? { refreshToken } : {}) }`
is therefore guaranteed identical to `/api/users/login`. This is a pure move with
no behavioural change to the online auth flow (acceptance h).

New permission keys added to the existing `ALLOWED_PERMS` list in
`routes/admin.ts` and the mobile/web permission pickers: **`pos`** (use the
billing screen), **`inventory`** (products/stock/Excel), **`pos_reports`**
(sales reports). `owner`/`superadmin` implicitly pass all (existing
`hasPermission` short-circuit).

### 3.2 Phone-OTP flow

New router `routes/pos-auth.ts` mounted at `/api/pos/auth`:

- `POST /api/pos/auth/otp/send { mobile }` — validate `^[6-9]\d{9}$`. Look up
  `admin_phones` where `mobile = ? AND active = 1`. **Enumeration-safe:** always
  return a generic `{ message }` 200 whether or not the number is authorised; an
  OTP row is only created + delivered when it is. OTP = 6 digits, 10-min expiry,
  stored in the existing `email_otps` table with `purpose = 'pos_login'` and the
  `email` column holding `pos:<mobile>` (the table has no phone column; this
  reuses it without a schema change — documented decision). Delivery: the repo
  has **no SMS provider**. **Decision:** deliver the POS OTP by (a) FCM push to
  the owner's already-registered devices via `tokensForStaff` + a new
  `sendToTokens` call *when the number already maps to a staff user with
  devices*, and (b) in non-production, return `devOtp` in the response (mirrors
  `routes/otp.ts`). A `TODO(sms)` is recorded: wiring an SMS gateway later is a
  drop-in replacement for the delivery step and does not change the API. This is
  acceptable because the owner's own device is the primary POS device and
  receives the code via push; for a brand-new number the owner can read the
  `devOtp` during setup or use the master-password/user-login path. Rate-limited
  via the existing `utils/rateLimit.ts` (5/min/number).
- `POST /api/pos/auth/otp/verify { mobile, otp }` — verify against the latest
  unconsumed non-expired `pos_login` row; on success consume it, upsert the user
  as above, call the **shared** `issueTokens()` (from `auth/session.ts`, §3.1),
  and return `{ user: safeUser(user), token, ...(isMobileClient ? { refreshToken }
  : {}) }` — the exact shape and helpers used by `/api/users/login`. Failure →
  401 `Invalid or expired code`.

Validation rules (each external input): `mobile` required, string, regex
`^[6-9]\d{9}$`, else 422. `otp` required, string, regex `^\d{6}$`, else 422.
Both endpoints are **public** (no `requireAuth`) — they are the login path.

### 3.3 Allowlist management (owner only)

New router `routes/admin-pos.ts` mounted at `/api/admin/pos` (mounted in
`server.ts` **before** the generic `/api/admin` router, like `admin-links`):

- `GET /api/admin/pos/phones` — `requireAuth, requireOwner` — list allowlist.
- `POST /api/admin/pos/phones` — `requireOwner` — add/update
  `{ mobile, role: 'owner'|'staff', permissions[], name }`; validates mobile +
  permission keys against the allow-list; upserts `admin_phones` and, if a
  matching user exists, updates their role/permissions immediately (so revocation
  is instant).
- `DELETE /api/admin/pos/phones/:mobile` — `requireOwner` — set `active = 0`
  **and** demote any matching user to `role = 'customer'`, `permissions = []`
  (so admin access is revoked server-side at once, satisfying acceptance (a)).
  The owner's own primary number cannot be removed (guard: compare to
  `OWNER_MOBILE`/`req.user.mobile`; 409 if self).

**Invariant — "an unauthorised phone cannot call admin/POS APIs" (acceptance a):**
enforced at the **API layer** by `requireStaff`/`requireOwner` reading JWT
claims, not by the allowlist alone. The allowlist governs who can *obtain* a
staff JWT; the middleware governs every request. Removing a phone demotes the
user row so their next token refresh (≤15 min) carries `customer`, and we also
revoke their refresh tokens on removal (`refresh_tokens.revoked = 1`) so they are
forced to re-auth and cannot refresh into staff again. This is the layer that
owns the invariant.

---

## 4. Billing + stock engine (Phase 2)

### 4.1 API surface (`routes/pos.ts`, mounted `/api/pos`, all `requireAuth`)

| Method & path | Guard | Purpose |
|---|---|---|
| `GET /api/pos/products/search?q=` | `requireStaff('pos')` | search by name/SKU/barcode, returns id, name, sku, barcode, unit, price, tax_rate, stock, in_stock |
| `POST /api/pos/bills` | `requireStaff('pos')` | create/complete a bill (idempotent, transactional) |
| `POST /api/pos/bills/hold` | `requireStaff('pos')` | save a `held` bill (reopen later) — no stock move |
| `GET /api/pos/bills` | `requireStaff('pos')` | history (keyset pagination, filters) |
| `GET /api/pos/bills/:billNo` | `requireStaff('pos')` | one completed/cancelled/refunded bill + items (by `bill_no`) |
| `GET /api/pos/bills/id/:id` | `requireStaff('pos')` | one bill by numeric `id` (used to reopen `held` bills, which have no `bill_no` yet) |
| `POST /api/pos/bills/:billNo/cancel` | `requireStaff('pos')` | controlled stock reversal |
| `POST /api/pos/bills/:billNo/refund` | `requireStaff('pos')` | controlled stock reversal |

Manual-item lines require `settings.pos_allow_manual_items = 1` **and** the
caller to hold `pos`; otherwise the line is rejected 403. Rate: the search
endpoint is debounced client-side (250 ms) and uses the existing
`idx_products_sku/barcode/category` + a `name LIKE` prefix match.

### 4.2 Unique bill numbers

**Decision — sequence counter inside the checkout transaction, not
`crypto.randomBytes`.** Online orders use random `4A<hex>` ids because they only
need uniqueness; POS invoices must be **human-sequential** (`INV-000123`). Inside
the same DB transaction as the bill insert we run
`UPDATE settings SET pos_next_bill_seq = pos_next_bill_seq + 1 WHERE id = 1`,
then read it back with `SELECT pos_next_bill_seq` (same connection/transaction →
no race), and format `pos_bill_prefix + zero-pad(seq, 6)`. The `uq_pos_bills_bill_no`
unique index is the final backstop. This gives gap-free, collision-free,
owner-prefixed numbers. Rejected: `MAX(bill_no)+1` (racy under concurrency).

### 4.3 Money & quantity math (invariant: correct rounding)

- Line: `line_total = round2(quantity * rate)`; tax (if `tax_rate > 0`):
  `line_tax = round2(line_total * tax_rate / 100)`.
- Subtotal = Σ line_total; tax_total = Σ line_tax; grand_total =
  `round2(subtotal - discount + tax_total)`.
- All arithmetic is done in integer **paise** server-side (multiply by 100, use
  `Math.round`, divide back) to avoid binary-float drift, then stored in the
  `DECIMAL` columns. Prisma returns `Decimal`; we convert to number only at the
  JSON boundary. **Invariant owner:** the POS service (`services/posBilling.ts`)
  owns all money math; clients send quantities + the chosen rate but the server
  **recomputes** every total from the authoritative product `price`/`tax_rate`
  (for catalogue lines) and never trusts client-sent totals. Manual lines trust
  the client-entered rate (there is no catalogue reference) but still recompute
  the line/grand totals.
- Quantity validation: `DECIMAL(10,3)`, must be `> 0`, max 50000 (covers 50 kg in
  grams if a gram unit is used, and large piece counts). Rate validation: `>= 0`,
  `<= 100000`. Discount: `>= 0`, `<= subtotal`.

### 4.4 Idempotent, transactional checkout (acceptance c + d)

`POST /api/pos/bills` body (zod-validated):

```
{
  idempotencyKey: string (uuid v4),          // REQUIRED for complete
  status: 'completed' | 'held',
  customer?: { name?, mobile? },
  items: [{ productId?|null, name, unit, quantity, rate, taxRate?, isManual? }],
  discount?: number,
  payment: { method: 'cash'|'upi'|'other'|'split', amountPaid?: number, breakdown?: {...} },
  note?: string
}
```

Flow for a `completed` bill:

1. **Idempotency pre-check (outside tx):** `SELECT * FROM pos_bills WHERE
   idempotency_key = ?`. If found → return that bill as `200` with
   `{ bill, idempotent: true }` and do **nothing else**. This is what makes a
   refresh/retry safe (acceptance d). The `uq_pos_bills_idem` index is the
   race backstop: if two requests slip past the pre-check, the second insert
   throws P2002/1062 and we catch it, re-select the existing row and return it.
2. **Open `prisma.$transaction`** (interactive transaction, `tx`):
   - Load every catalogue `productId` `FOR UPDATE` via
     `tx.$queryRawUnsafe('SELECT ... FROM products WHERE id IN (...) FOR UPDATE')`
     to lock rows and prevent oversell under concurrency.
   - Recompute all money (§4.3).
   - **Stock check:** for each catalogue line with `track_inventory = 1`, if
     `stock - quantity < 0` and neither the product's `allow_negative_stock` nor
     global `pos_allow_negative_stock` is set → **abort the whole transaction**
     and return 409 `{ message: 'Insufficient stock for <name>', productId }`.
     Nothing is written (recoverable error, caller fixes the cart).
   - Reserve the bill number (§4.2).
   - Insert `pos_bills` (+ `idempotency_key`), insert `pos_bill_items`.
   - For each catalogue line: `UPDATE products SET stock = stock - :q,
     in_stock = (stock - :q > 0 OR allow_negative) WHERE id = :id`, then insert a
     `stock_movements` row (`reason='sale'`, `change_qty = -q`,
     `balance_after`, `bill_no`, `created_by`).
   - Commit.
3. **After commit (fire-and-forget):** fire owner push for completed sale (if
   `pos_sale_notifications`), and low-stock / out-of-stock push for any product
   whose new `stock <= low_stock_threshold` / `<= 0` (§7). Never block the
   response on push.

`held` bills skip stock entirely (no movement, no sequence number consumed until
completed). A held bill is inserted with `bill_no = NULL` (the column is UNIQUE
NULL — multiple held bills coexist) and `status = 'held'`, and is addressed by
its numeric `id`. The `bill_no` (and the reserved sequence from §4.2) is assigned
only when the bill transitions `held → completed`. Consequently the
`GET /api/pos/bills/:billNo` route addresses **completed / cancelled / refunded**
bills only; held bills are fetched/reopened via their `id`
(`GET /api/pos/bills/:id` resolves by id, and `POST /api/pos/bills/hold` returns
the held bill's `id`). This removes the earlier contradiction between a NOT NULL
`bill_no` and a held bill that has no number yet.

Error handling for checkout:

| Condition | Recoverable? | Caller receives | Logged |
|---|---|---|---|
| zod validation fails | yes | 422 + message | no |
| product id not found | yes | 422 `Product #<id> not found` | no |
| insufficient stock (negative disabled) | yes | 409 + `{message, productId}` | no |
| duplicate idempotency key | n/a (expected) | 200 existing bill `{idempotent:true}` | debug only |
| DB/tx failure | fatal for this request | 500 `Could not complete the bill` | yes (console.error, no PII) |
| push failure | ignored | — (bill already saved) | yes, best-effort |

### 4.5 Cancel / refund reversal (acceptance g, audit)

`POST /api/pos/bills/:billNo/cancel` and `/refund` (`requireStaff('pos')`):
inside a transaction, guard that the bill is currently `completed` (idempotent:
if already `cancelled`/`refunded`, return the bill unchanged, no double
reversal). For each catalogue line: `UPDATE products SET stock = stock + qty`,
recompute `in_stock`, insert a `stock_movements` reversal row
(`reason='cancel_reversal'|'refund_reversal'`, positive `change_qty`, same
`bill_no`). Set `pos_bills.status`, `cancelled_by`, `cancel_reason`. Fire the
cancel/refund owner push after commit. Double-reversal is prevented by the status
guard + the same-transaction read.

---

## 5. Idempotency key design (summary)

- The **client generates a UUID v4 once per cart checkout attempt** (web: a
  `useRef` set when the POS cart is opened/first "Charge" tap; mobile: same) and
  reuses it for every retry of that same charge. A new sale → new key.
- Server enforces exactly-once via the `uq_pos_bills_idem` unique index + the
  pre-check in §4.4. A page refresh, a double-tap, a network retry, or the
  axios/`api.ts` 401-refresh-replay all carry the same key and therefore the same
  bill, so **stock is deducted exactly once** (acceptance d).
- Held→completed transition: the key is attached at completion time; a held bill
  reopened on two devices and completed twice is caught by the key (same key) or,
  if different keys, by the fact that completing a non-`held` bill is a no-op
  (status guard).

---

## 6. Excel import / export (Phase 3)

New router `routes/pos-import.ts` mounted at `/api/admin/pos`
(`requireStaff('inventory')`), using the existing `multer` dep for the upload
(memory storage, 5 MB limit, accept `.xlsx` / `.csv` by extension + magic bytes).

Backend dependency: **`exceljs@4.4.0`** added to `api-node/package.json`
`dependencies` (exact pin). CSV handled by a small internal parser (no dep).

### 6.1 Endpoints

- `POST /api/admin/pos/import/preview` (multipart `file`) → parse, validate every
  row, detect existing products, return
  `{ batchPreviewId, rows: [{ rowNum, action: 'insert'|'update'|'error',
  data, errors: [] }], summary }`. **No DB write to products.** A
  `pos_import_batches` row is created with `status='previewed'` and the parsed
  result cached (persisted in `error_json` for preview recall; the full parsed
  payload is also returned to the client which echoes it back on commit, so the
  server stays stateless between preview and commit).
- `POST /api/admin/pos/import/commit { batchPreviewId, rows }` → re-validate the
  rows server-side (never trust the client echo blindly), then in **one
  transaction** insert new + update existing products, writing a
  `product_change_log` row per changed field and a `stock_movements`
  (`reason='import'`) row per stock change. Update the batch counters +
  `status='committed'`. Returns the summary. (Acceptance b.)
- `GET /api/admin/pos/export/products.xlsx` → stream a workbook of the full
  product list + current inventory (`exceljs` `.xlsx.write(res)` with correct
  `Content-Disposition`). `requireStaff('inventory')`.
- `POST /api/admin/pos/bulk-update { field: 'price'|'selling_price'|'stock',
  updates: [{ id|sku, value }] }` → transactional bulk price/stock update with a
  `product_change_log` entry per change and (for stock) a `stock_movements`
  (`reason='bulk_update'`) row.
- `GET /api/admin/pos/import/history` → list `pos_import_batches` (keyset).
- `GET /api/admin/pos/change-log?productId=&limit=&cursor=` → product change log.

### 6.2 Column mapping & per-row validation

Expected headers (case-insensitive, trimmed; a header-alias map handles common
variants): `name`, `sku`, `barcode`, `category`, `purchase_price`,
`selling_price`, `stock`, `unit`, `tax_rate`, `low_stock_threshold`.

Per-field rules (row flagged `error` with a human message if violated — the row
is reported, not silently dropped, satisfying "row-wise errors + re-upload"):

| Field | Required | Rule |
|---|---|---|
| `name` | yes | 1–200 chars |
| `sku` | no | ≤64 chars; if present must be unique within the file **and** not collide with a *different* existing product |
| `barcode` | no | ≤64 chars; same uniqueness rule |
| `category` | yes | 1–120 chars (matched/looked-up against `categories`; unknown category is a warning, still importable with the raw string, mirroring the existing free-text `products.category`) |
| `purchase_price` | no | number 0–100000, ≤2 dp |
| `selling_price` | yes | number 1–100000, ≤2 dp → `products.price` |
| `stock` | no | number 0–50000, ≤3 dp (negative only allowed when global negative-stock on) |
| `unit` | no | one of the allowed unit set; default `pcs` |
| `tax_rate` | no | 0–100, ≤2 dp |
| `low_stock_threshold` | no | number ≥0, ≤3 dp |

**Duplicate detection / "prevent accidental duplicates":** a row maps to an
existing product by (1) `sku` match, else (2) `barcode` match, else (3)
case-insensitive `name` + `category` match. Matched → `action='update'`;
unmatched → `action='insert'`. If a row would create a second product with a SKU
already held by a different product, it is an `error` (not a silent insert). The
preview surfaces every insert/update/error so the owner validates before commit.

### 6.3 Transaction & safety

Commit runs in a single `prisma.$transaction`; a mid-file failure rolls back the
whole batch (no half-imported catalogue) and the batch row is marked
`status='failed'`. `in_stock` is recomputed from the new `stock` on every touched
product so the online catalog stays correct. Non-recoverable parse error (corrupt
file) → 422 with a clear message, no batch committed.

---

## 7. Owner push notifications (Phase 6) — reuse existing FCM infra

Reuse `services/push.ts` wholesale (`sendToTokens`, `tokensForStaff`,
`recordNotification`, `PushMessage`, data-only payload + colour large-icon). Add
a thin `services/posNotify.ts` with typed helpers, each resolving recipients via
`tokensForStaff('pos')` (owner/superadmin + admins holding `pos`), so delivery
goes only to authorised recipients and to **all** of an owner's registered
devices automatically (the existing multi-token multicast).

| Trigger | When | Title / body example | Channel |
|---|---|---|---|
| Sale completed | after checkout commit, if `pos_sale_notifications` | `🧾 4A Store – Sale ₹58` / `INV-000123 • 2 items • Cash` | default |
| Low stock | product new `stock <= low_stock_threshold` (and `> 0`) | `⚠️ 4A Store – Low Stock Alert` / `Maggi 70g has only 2 pieces remaining. Please restock soon.` | default |
| Out of stock | product new `stock <= 0` | `⛔ 4A Store – Out of Stock` / `<name> is out of stock.` | default |
| Bill cancelled/refunded | after reversal commit | `↩️ 4A Store – Bill Cancelled` / `INV-000123 reversed • ₹58` | default |
| Significant stock adjustment | manual_adjust / bulk_update beyond a threshold (e.g. |Δ| ≥ configurable, default large) | `🔧 4A Store – Stock Adjusted` / `<name>: 50 → 5` | default |

Each send is wrapped in `.catch(() => null)` and followed by
`recordNotification(...)` (new `type` values `pos_sale`, `pos_low_stock`,
`pos_out_of_stock`, `pos_cancel`, `pos_stock_adjust`) so history is consistent.
Low-stock dedupe: to avoid spamming on every sale while already below threshold,
`posNotify.lowStock` only fires on the **transition** into the low/out state
(compare `balance_after` with the previous `stock` read inside the same tx: fire
only when previous was above and new is at/below). The per-product threshold is
the `low_stock_threshold` column, configurable from the product edit UI and via
Excel import, exactly as requested (e.g. 2 pcs). No new native code — data-only
FCM + Notifee already draw these.

---

## 8. Invoice sharing (Phase 5) — reuse where the renderer supports it, NOT a blind reuse

**Source reality (verified, correcting iteration-1 finding 1).** The two
existing renderers are **not** equivalent:

- `web/src/lib/invoice.ts` draws with **jsPDF core (helvetica) fonts**. It
  cannot render Devanagari, the ₹ glyph or emoji: the code deliberately uses the
  literal `const rupee = 'Rs. '` ("jsPDF core fonts can't render ₹") and
  explicitly **strips** Hindi village names ("Hindi village names can't be drawn
  by jsPDF core fonts"). So the committed Hindi thank-you + ₹ + 🙏 would come out
  as blank boxes / dropped text on web. The iteration-1 claim that this template
  "already renders most" of the Hindi/₹ bill was **wrong**.
- `mobile/src/invoice.ts` renders an **HTML string via `expo-print`** (Chromium)
  with `font-family: 'Noto Sans'` and already prints `₹` directly in the markup
  — Devanagari, ₹ and emoji all render correctly there.

### 8.0 Decision — the invoice is defined by one shared HTML template; web prints/PDFs via HTML, not jsPDF core

To render the required Hindi/₹/emoji invoice **consistently on both platforms**
and avoid font-support divergence, the POS invoice is authored as **one HTML
template** (the proven `mobile/src/invoice.ts` markup, generalised). Rationale:
it already handles Unicode via a webfont, both targets have an HTML→PDF path, and
it keeps a single source of truth for the layout.

- **Mobile:** keep using the existing `expo-print` HTML path (`invoiceHtml` →
  `Print.printToFileAsync` → `expo-sharing`), extended per §8.1. **No change to
  the rendering engine.**
- **Web (finding 1, option b — CHOSEN):** render the **same HTML** and produce
  the PDF/print via the **browser's own print pipeline**, **not** via jsPDF core.
  This is Unicode-safe because the browser lays the HTML out with its own font
  stack (Noto Sans / system Devanagari), so ₹, Devanagari and emoji all render.
  - **Print AND Download PDF share one path:** write the invoice HTML into a
    hidden `<iframe>` (or a `window.open` print window) with
    `@page { size: A4; margin: 0 }` (as in the mobile template) and call
    `print()`. The browser's print dialog provides both "Print" and
    **"Save as PDF"** (acceptance 6: print where supported + download PDF). This
    needs **zero new dependencies**, which is required — the worktree
    `web/package.json` has `jspdf` but **does not have `html2canvas`**, and the
    locked decisions forbid new web deps (§1.1). (The task statement's phrase
    "reuses jspdf + html2canvas" was aspirational; `html2canvas` is absent and is
    **not** adopted.)
  - **Dependency-accurate note:** `jspdf` alone cannot be reused for the POS
    invoice because its core fonts cannot draw ₹/Devanagari/emoji (the whole
    point of finding 1); the browser-print path sidesteps that without adding a
    font or a canvas library.
  - The **legacy order-history jsPDF path (`downloadInvoice`) is left untouched**
    for online orders; the POS web invoice is a **new** `web/src/lib/posInvoice.ts`
    (the shared HTML template + the iframe-print helper + the §8.3 WhatsApp/copy
    helpers). This is an explicit **new file**, not an edit of the ASCII-only
    `downloadInvoice`, so online invoices keep their current behaviour
    (acceptance h).
- **Rejected alternatives:** (a) keep jsPDF core and print `Rs.`/ASCII only —
  rejected because the task explicitly requires ₹ + the Hindi thank-you on the
  invoice; (c) `doc.addFont()` embedding a Devanagari TTF into jsPDF — rejected as
  heavier (ship + base64 a Devanagari font, still no emoji coverage) than the
  zero-dep browser-print path; (d) adding `html2canvas` to rasterise the DOM into
  jsPDF — rejected because it violates the "no new web deps" decision and the
  browser-print path already yields a Unicode PDF via "Save as PDF".

### 8.1 One shared invoice shape + a `billToInvoice` adapter

A POS bill is mapped by a small `billToInvoice(bill, items, settings)` adapter
(one per client) into the template's input object. Correcting findings 5 and 6,
the adapter and template are **edited** (not reused verbatim):

- **Finding 5 — no "Delivery: FREE" row on a counter bill.** Both existing
  renderers unconditionally print a Delivery line and show `0`/falsy as
  `Delivery: FREE`. The shared POS template adds an invoice `kind: 'pos'` flag;
  when `kind === 'pos'` the **Delivery row is omitted entirely**, and the
  conditional block instead renders the **Tax** row (when `tax_total > 0`) and
  the **Payment method + Payment status** row. This is a documented renderer edit,
  not a pure reuse. The counter bill therefore matches the §6 example (no
  delivery line).
- **Finding 6 — show server-computed money verbatim.** The existing templates
  recompute `item.price * item.quantity` in plain JS floats, which can diverge
  by a paise from the server's rounded total for decimal weight quantities
  (0.5 kg etc.) and make the printed PDF fail to foot to `grand_total`.
  `billToInvoice` therefore passes the **server-computed** `line_total` per item
  and the server `subtotal` / `discount` / `tax_total` / `grand_total` (already
  rounded in integer paise per §4.3) into the template, and the template renders
  **those values verbatim** — it must **not** recompute `price * quantity`. The
  invoice always foots exactly to the stored `grand_total`.
- Adapter field map: `bill_no → invoice no`, `created_at → datetime`,
  `items[] → {name, unit, quantity, rate, line_total}`, `subtotal`, `discount`,
  `tax_total`, `grand_total`, `payment_method`, `payment_status`,
  `amount_paid`/`balance_due` (shown when `payment_status !== 'paid'`),
  `customer_name`/`customer_mobile` (omitted when both blank). **No
  `delivery_charge` field is passed for POS.**

### 8.2 Content, thank-you, actions

The invoice shows: store **name + logo**, address, contact, invoice no +
datetime, line items (name, qty, unit price, line total), subtotal, discount, tax
(conditional), grand total, payment method + status, optional customer, and the
bilingual thank-you `Thank you! धन्यवाद! 🙏 4A Store पर खरीदारी करने के लिए आपका धन्यवाद।`
— renderable on both platforms because both now use a Unicode HTML path.

Actions (both platforms):

| Action | Web | Mobile |
|---|---|---|
| Share on WhatsApp | `web/src/lib/whatsapp.ts` `openWhatsApp(number, text)` with the §8.3 text summary | `mobile/src/native.ts` `openWhatsApp(phone, text)` |
| Download PDF | browser print dialog → "Save as PDF" (`posInvoice.ts`, hidden-iframe `print()`) | `expo-print` `printToFileAsync` → `expo-sharing` |
| Print | hidden-iframe / print-window `print()` | `expo-print` `printAsync` |
| Native Share | `navigator.share({ text })` (text summary; no PDF-file share on web v1 — see §8.3), fallback to copy | `react-native` `Share.share` / `expo-sharing` (PDF file) |
| Copy bill text | `navigator.clipboard.writeText` | `expo-clipboard` `setStringAsync` |

### 8.3 WhatsApp text summary

Shared logic (one builder per client, mirroring the marketing/whatsapp helpers):
a plain-text summary — store name, bill no, date, item lines, grand total,
payment status, bilingual thank-you — that `openWhatsApp` prefills. Plain text in
WhatsApp is Unicode, so ₹ and Hindi render fine. "Where supported share a PDF or
secure invoice link": on **mobile** the generated PDF file is shared via the
native share sheet (`expo-sharing` returns a file URI). On **web** the
browser-print path produces no in-memory PDF Blob, so web shares the **text
summary** via WhatsApp and offers "Save as PDF" (print dialog) separately — a
file-level `navigator.share({ files })` for the PDF is **not** claimed for web
v1 (recorded limitation; the backlogged secure link §8.4 would cover a shareable
link if later needed). This keeps the web path dependency-free and honest.

### 8.4 Secure invoice link (backlogged)

A read-only `GET /api/pos/bills/:billNo/public?token=` is **out of scope for v1**
to avoid an unauthenticated bill endpoint without a hard need. Default WhatsApp
share uses the prefilled text summary + the shared PDF file (no new auth surface).

Error handling: browser print / expo-print failure → toast "Could not generate
PDF", no crash; WhatsApp not installed → the existing `wa.me`/web fallback
handles it; clipboard denied → toast fallback. All client-side, non-fatal.

---

## 9. POS UI & navigation (Phase 4) + dashboard/reports (Phase 6)

### 9.1 Web

New admin tabs added to `ADMIN_TABS` in `web/src/pages/admin/AdminApp.tsx`
(gated by `canAdmin(role, perms, key)` — the existing RBAC-driven nav filter, so
unauthorised staff never see them) and routes under `/admin` in `App.tsx`:

| Tab | path | perm key | Component |
|---|---|---|---|
| 🧾 New Bill (POS) | `pos` | `pos` | `AdminPos.tsx` |
| 📒 Billing History | `pos-history` | `pos` | `AdminPosHistory.tsx` |
| 📦 Inventory | `inventory` | `inventory` | `AdminInventory.tsx` (extends/links from existing Products) |
| ⬆️ Excel Import | `pos-import` | `inventory` | `AdminPosImport.tsx` |
| 📈 Sales Reports | `pos-reports` | `pos_reports` | `AdminPosReports.tsx` |
| 📱 POS Access | `pos-access` | owner-only | `AdminPosAccess.tsx` (phone allowlist) |

Data access via a new `web/src/lib/pos.ts` (react-query hooks over `lib/api.ts`,
following `adminData.ts`). The POS screen is a responsive two-pane layout
(search/scan + cart) that collapses to a single column on phones; large tap
targets, `+`/`−` steppers, a quantity field that accepts decimals for weight
units, minimal clicks to "Charge". Barcode: the search box treats an Enter after
a fast burst (hardware scanner) or a scanned value as an exact SKU/barcode lookup.
The existing admin dashboard (`AdminDashboard.tsx`) gets a POS summary strip
(today's POS sales, #bills, low/out-of-stock counts, recent bills, quick links)
fed by a new `GET /api/admin/pos/dashboard` (`requireStaff('dashboard')`), built
like the existing `/api/admin/stats` raw-SQL aggregate.

### 9.2 Mobile

Mobile already has `app/admin/orders.tsx`, `app/admin/roles.tsx`,
`app/admin/order/[id].tsx` guarded by `isOrderStaff`/`isOwner` + a
`router.replace('/login')` bounce. New expo-router screens follow the identical
pattern:

| Screen | file | guard |
|---|---|---|
| New Bill (POS) | `app/admin/pos.tsx` | `canAdmin(user,'pos')` |
| Billing History | `app/admin/pos-history.tsx` | `canAdmin(user,'pos')` |
| Bill detail / share | `app/admin/pos-bill/[billNo].tsx` | `canAdmin(user,'pos')` |
| Inventory | `app/admin/inventory.tsx` | `canAdmin(user,'inventory')` |
| Excel Import | `app/admin/pos-import.tsx` | `canAdmin(user,'inventory')` — upload via `expo-document-picker`? |
| Sales Reports | `app/admin/pos-reports.tsx` | `canAdmin(user,'pos_reports')` |
| POS Access (allowlist) | `app/admin/pos-access.tsx` | `isOwner` |

**Decision — mobile Excel upload uses `expo-image-picker`'s document mode is not
available; `expo-document-picker` is NOT currently a dependency.** To honour the
"no new native binary / JS-only" rule, `expo-document-picker` *is* a
JS-config-plugin-free, OTA-compatible Expo module, but adding it still changes
the native module set and would need a rebuild. **Chosen approach:** mobile does
**not** parse/upload Excel files directly in v1; instead the mobile Excel-Import
screen explains that bulk Excel import/export runs from the web admin (same
account, same DB), and provides the mobile-friendly actions that need no file
picker: **bulk stock/price edit** and **single-product add/edit** against the
same `/api/admin/pos` endpoints. This fully satisfies "owner can Excel-import and
verify in DB" (acceptance b) via web, keeps mobile JS-only with zero new native
modules, and still lets staff adjust inventory on the phone. Recorded as a
deliberate platform split. (If a later build adds `expo-document-picker`, the
mobile import screen can call the same preview/commit endpoints unchanged.)

Data access via a new `mobile/src/pos.ts` (react-query over `src/api.ts`,
following `src/queries.ts`). The mobile POS billing screen is a single-column,
thumb-reachable layout optimised for a phone/tablet at the counter.

### 9.3 Reports (both platforms)

`GET /api/admin/pos/reports?period=day|week|month&from=&to=`
(`requireStaff('pos_reports')`) — raw-SQL aggregates over `pos_bills` /
`pos_bill_items` / `stock_movements`: total sales, #bills, discounts, refunds,
payment-method summary, best-selling products (JSON-free — real
`pos_bill_items` join, cleaner than the orders `JSON_TABLE` trick), low-stock +
out-of-stock lists. Export to Excel reuses the §6 `exceljs` writer
(`GET /api/admin/pos/reports/export.xlsx`). Sensitive reports (purchase price /
profit) require `pos_reports`; a staff member without it gets 403.

---

## 10. Testing

Mobile already has a Node test runner (`npm test`, `src/__tests__/*.test.ts`).
Backend has `tsc` build. Plan:

**Unit (pure functions, no DB):**
- `services/posBilling.ts` money math: paise rounding, line/tax/grand totals,
  decimal quantities (0.5 kg, 500 g), ₹1 and ₹100000 bounds — backend unit test.
- Excel row validation + duplicate-detection (`sku`/`barcode`/`name+category`
  precedence) with fixture rows including error rows — backend unit test.
- `billToInvoice` adapter + WhatsApp text builder — can run under the mobile
  test runner (shared logic) and a web test.
- Public-catalog leakage guard: assert the response bodies of **both**
  `GET /api/products` (list) **and** `GET /api/products/:id` (single) have no
  `purchase_price`/`low_stock_threshold`/`allow_negative_stock`/`track_inventory`
  key — a shape test against `PUBLIC_PRODUCT_SELECT` (§2.1a). **Fatal if it
  regresses.**
- Invoice totals footing (finding 6): `billToInvoice` output renders the
  server-computed `line_total`/`grand_total` verbatim; a test with a 0.5 kg line
  asserts Σ(line_total) + tax − discount === grand_total (no `price*quantity`
  recompute drift). POS invoice shows no Delivery row (`kind:'pos'`, finding 5).

**Integration (need a DB — document as the manual/CI step):**
- Idempotent checkout: POST the same `idempotencyKey` twice → one bill, stock
  deducted once (acceptance d).
- Insufficient-stock block with negative-stock off → 409, no write; with the
  owner setting on → bill succeeds and stock goes negative.
- Cancel/refund reversal restores stock exactly once; second cancel is a no-op.
- Excel import insert+update+error mix; verify products + change log + stock
  movements in the DB (acceptance b, g).
- RBAC: a `customer` JWT and an unauthorised phone are rejected by every
  `/api/pos/*` and `/api/admin/pos/*` endpoint (acceptance a).

**Testability note:** the engine is split so money math, validation and the
invoice/WhatsApp builders are pure and unit-testable; only the transactional
checkout and import need a DB (integration). A design that forced DB access into
the math would be a smell — avoided here.

Verification before "done": run `tsc` in `api-node` (expect only the known
`prisma.<posModel>` delegate-missing errors until `prisma generate` runs on
deploy — not a regression), `tsc -b` / `vite build` in `web`, `npm run typecheck`
+ `npm test` in `mobile`.

---

## 11. Phase plan (document only; implementation follows later steps)

- **Phase 0** — this design.
- **Phase 1 — DB + backend foundation:** `ensureProductInventoryColumns`,
  `ensurePosSettingsColumns`, `ensurePosTables` + Prisma model mirrors + manual
  `.sql` files; wire into `server.ts`; public-catalog leakage guard on **both**
  `GET /api/products` and `GET /api/products/:id` (shared `PUBLIC_PRODUCT_SELECT`,
  §2.1a); **extract `auth/session.ts`** (`issueTokens`/`safeUser`/`toClaims`/
  `isMobileClient`) and re-point `routes/users.ts` to it (finding 2); phone
  allowlist + phone-OTP auth (`routes/pos-auth.ts`, `routes/admin-pos.ts`); RBAC
  permission keys.
- **Phase 2 — billing + stock engine:** `services/posBilling.ts`, `routes/pos.ts`
  (bills, hold, history, cancel/refund), bill-number sequence, idempotency,
  transactional stock deduction + reversal + `stock_movements`.
- **Phase 3 — Excel import/export:** `exceljs` dep, `routes/pos-import.ts`,
  preview/commit/export/bulk-update/history/change-log.
- **Phase 4 — POS UI web + mobile:** web tabs/routes + `lib/pos.ts`; mobile
  expo-router screens + `src/pos.ts`; search/scan, cart, checkout.
- **Phase 5 — invoice sharing:** `billToInvoice` adapters; reuse jsPDF /
  expo-print / WhatsApp / clipboard / native share.
- **Phase 6 — push + dashboard + reports:** `services/posNotify.ts`; dashboard
  summary + reports endpoints + export; wire pushes into checkout + reversal +
  adjustments.

---

## 12. Risks & decisions recorded (for the review)

1. **OTP delivery has no SMS gateway in the repo.** Decided: push-to-owner-device
   + dev `devOtp`, with a documented SMS drop-in point. Flag for the reviewer —
   if a production SMS requirement exists, it is an additive change to one
   function, not the API.
2. **SKU/barcode uniqueness is app-layer, not a DB unique index** (avoids a risky
   runtime ALTER over the live table). Documented invariant owner: POS service.
3. **Mobile Excel import is web-only in v1** (no new native module); mobile keeps
   bulk/single edits. Full acceptance (b) is met via web. Backlogged: add
   `expo-document-picker` later for mobile file upload.
4. **Secure public invoice link is backlogged** (default WhatsApp share uses the
   text summary / shared PDF) to avoid adding an unauthenticated bill endpoint
   without a hard need.
5. **`exceljs@4.4.0`** is the only new runtime dependency, backend-only, pinned.
6. **Prisma generate CDN block** may leave `prisma.posBill` etc. as tsc errors
   until deploy — expected per repo convention, not a regression.
7. **Web POS invoice uses the browser print pipeline (HTML→iframe `print()`→
   Print / Save-as-PDF), NOT jsPDF core and NOT html2canvas** (finding 1),
   because jsPDF core cannot draw Devanagari/₹/emoji and `html2canvas` is not a
   dependency / new web deps are forbidden. New file `web/src/lib/posInvoice.ts`;
   the legacy ASCII order invoice is untouched.
8. **`auth/session.ts` extraction** is a prerequisite of the phone-OTP router
   (finding 2) — a pure move of existing helpers, no online-auth behaviour change.

---

## 13. Responses to design review (`pos-design-review.json`, verdict CHANGES_REQUESTED)

All findings were re-verified against source before responding. Every HIGH and
MEDIUM is **addressed** (none backlogged or ignored); both NITs are addressed.

| # | Sev | Response | Where |
|---|---|---|---|
| 1 | HIGH | **Addressed (option b, dependency-corrected).** Dropped the false "jsPDF already renders most" claim. Web POS invoice renders the shared Unicode HTML and produces both Print and "Save as PDF" via the **browser print pipeline** (hidden-iframe `print()`) — Unicode-safe and **zero new deps**. Note: the fix text verified `html2canvas` is NOT in `web/package.json`, so (contrary to the task statement) it is **not** adopted; `jspdf` core cannot draw ₹/Devanagari and is kept only for the untouched legacy order invoice. Mobile keeps its working `expo-print` HTML path. Hindi/₹/emoji now render on both. | §8.0, §8.2, §1.1 stack row |
| 2 | MED | **Addressed.** Added an explicit Phase-1 refactor: extract `issueTokens`/`safeUser`/`toClaims`/`isMobileClient` into `api-node/src/auth/session.ts`, re-point `routes/users.ts`, and import the same symbols in `routes/pos-auth.ts`. Login shape stays identical to `/api/users/login`. | §3.1 (refactor note), §3.2, §11 Phase 1 |
| 3 | MED | **Addressed.** §2.1a leakage guard now covers **both** `GET /api/products` (findMany) **and** `GET /api/products/:id` (findUnique) via one shared `PUBLIC_PRODUCT_SELECT`, plus an audit of other product reads; §10 test asserts no cost/inventory-control keys on **both** payloads. | §2.1a, §10, §11 Phase 1 |
| 4 | MED | **Addressed.** `pos_bills.bill_no` is now `VARCHAR(20) UNIQUE NULL`; held bills insert with `bill_no = NULL` and are addressed by `id` (new `GET /api/pos/bills/id/:id`); `bill_no`+sequence assigned only on held→completed; `GET /api/pos/bills/:billNo` serves completed/cancelled/refunded only. | §2.2, §4.4, §4.1 |
| 5 | MED | **Addressed.** Shared template takes a `kind:'pos'` flag; for POS the Delivery row is **omitted** and Tax + Payment-status rows are rendered instead. Documented as a renderer edit, not a verbatim reuse. | §8.1 |
| 6 | NIT | **Addressed.** `billToInvoice` passes server-computed `line_total`/`subtotal`/`tax_total`/`grand_total` (integer-paise rounded, §4.3) and the template renders them verbatim — no client-side `price*quantity`. Footing test added. | §8.1, §10 |
| 7 | NIT | **Addressed.** Reworded: invoice reads the live romanized `settings.store_address` (`'Gajna Road, Chandargarh, Nabinagar, Aurangabad, Bihar - 824301'`); the Devanagari string is only the blank fallback. | §2.3 |

File written: `.agents/tasks/pos-design.md` (iteration 2).
