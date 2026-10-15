# Verification — Per-Product "Max Quantity Per Order" (Zepto/Blinkit style)

Feature: every product can carry an admin-set `max_qty_per_order` purchase cap that
works for BOTH piece products (soap: max 3 pcs → 4th blocked) and weight/kg products
(chini: max 1 kg → more blocked). Block-and-inform on exceed (clamp + bilingual
"Max N allowed / सिर्फ N तक"), enforced at the API level, not only client-side.
Empty/unset limit = unlimited (today's default; no existing product changes).

## 1. Schema + guarded raw ALTER (no prisma migrate)

- `api-node/prisma/schema.prisma` — added `max_qty_per_order Decimal? @db.Decimal(10,3)`
  to the `Product` model (NULL = no limit), with a comment matching the owner-added
  inventory columns' "added at runtime … Do NOT run prisma migrate/db push" style and a
  note that this is the ONE inventory column that IS public.
- `api-node/src/services/dataImport.ts` — new `ensureProductMaxQtyColumn()` mirrors
  `ensureWhatsappApiColumn()` EXACTLY: information_schema COUNT guard on
  `products.max_qty_per_order`; if present `return`; else
  `ALTER TABLE products ADD COLUMN max_qty_per_order DECIMAL(10,3) NULL` wrapped in a
  try/catch that swallows MySQL 1060 / "Duplicate column" and rethrows anything else.
- `api-node/src/server.ts` — imported `ensureProductMaxQtyColumn` and called it
  fire-and-forget in the boot block right after `ensureProductInventoryColumns()`:
  `ensureProductMaxQtyColumn().catch((e) => console.error('[seed] max_qty_per_order column failed', e));`
- `api-node/prisma/product-max-qty.sql` — manual deploy-parity equivalent
  (information_schema-guarded ALTER), mirroring `prisma/pos-inventory.sql`.
- Prisma client regenerated offline (`npx prisma generate`, local engine, no network)
  so tsc sees the new field. This was the EXPECTED stale-client step, not a code failure.

## 2. Admin backend read + write

- `api-node/src/routes/admin.ts`:
  - `productSchema` gained `maxQtyPerOrder: z.union([z.number(), z.string(), z.null()]).optional()`.
  - New `parseMaxQty(v)` helper: `null` for unset/blank/0 (NULL = unlimited), a positive
    number rounded to 3 decimals for a valid cap, `false` for an invalid (negative/non-finite)
    value → `fail(res, 'Max quantity per order must be a positive number', 422)` before the write.
  - `data.max_qty_per_order` set from the parsed value; persisted on both create and update
    (both spread `dataWithOverrides`). Admin reads products via the public catalog (`useProducts()`),
    so no separate admin read path is needed.

## 3. Admin UI

- `web/src/pages/admin/AdminProducts.tsx` — `FormState.maxQtyPerOrder: string`; `toForm()`
  seeds it from `p.max_qty_per_order`; `save()` payload adds
  `maxQtyPerOrder: f.maxQtyPerOrder.trim() === '' ? null : parseFloat(...)`. New numeric field
  in `prod-form-grid` (after Featured): label **"Max quantity per order / एक ऑर्डर में अधिकतम मात्रा"**,
  `type=number min=0 step=0.001`, placeholder "Blank = unlimited", bilingual helper text
  explaining the unit comes from the product's unit (pcs → 3 = 3 pieces, kg → 1 = 1 kg).
  Existing inline-style/design-system classes reused. `saveProduct` already accepts
  `Record<string, unknown>` — no change to `lib/admin.ts`.

## 4. Public catalog exposure

- `api-node/src/routes/catalogSelect.ts` — `max_qty_per_order: true` added to
  `PUBLIC_PRODUCT_SELECT` (near stock/unit), header comment updated to note it is a public
  purchase HINT (NOT owner-only). NOT added to `FORBIDDEN_PUBLIC_PRODUCT_FIELDS`.
- `api-node/src/__tests__/catalog-leak.test.ts` — fixture row gains `max_qty_per_order: '3.000'`;
  the public-hints test now also asserts `max_qty_per_order` IS present in the projection,
  while the forbidden owner-only fields stay absent.
- `web/src/types.ts` — `Product.max_qty_per_order?: number | null` and `Product.unit?: string`
  (public hint); `CartItem.maxQty?: number | null` and `CartItem.unit?: string` carriers.
- `web/src/lib/queries.ts` — `normalizeProduct()` coerces the Decimal string to a number
  (`"3.000" → 3`; blank/0/NaN/null → null = unlimited).

## 5. Storefront UX (instant client clamp + authoritative API confirm)

- `web/src/lib/qtyLimit.ts` (new) — shared `qtyLimitMsg()` / `qtyLimitCaption()` producing
  the SAME bilingual copy as the server (`Max N allowed / सिर्फ N तक`, unit shown for weight).
- `web/src/store/cart.ts` — threads `maxQty`/`unit` into each `CartItem`; `add()` and `setQty()`
  clamp to the item's cap (NULL = unlimited, unchanged) and fire `showToast(qtyLimitMsg(...), 'error')`
  on exceed; `add()` refreshes a persisted item's `maxQty`/`unit` from the live product.
- `web/src/components/ProductCard.tsx` — disables `+` and shows the bilingual caption at the cap.
- `web/src/pages/ProductDetails.tsx` — disables `+` + bilingual line at the cap; `Add to Cart`
  now also calls `POST /api/cart/validate` and surfaces the AUTHORITATIVE server message if over
  the cap (instant client clamp stays primary).
- `web/src/pages/Cart.tsx` — resolves each line's cap from the live catalogue (fallback to the
  persisted `i.maxQty`), disables `+` and shows the bilingual message at the cap.
- `web/src/lib/cart.ts` (new) — thin `validateCart(lines)` client for the validate endpoint.

## 6. API enforcement

- `api-node/src/utils/qtyLimit.ts` (new) — shared `qtyLimitMessage(maxQty, unit)` so admin.ts
  and cart.ts emit identical bilingual copy.
- `api-node/src/routes/admin.ts` `POST /orders/create` clean-lines loop — after the
  out-of-stock check, when `p.max_qty_per_order != null && quantity > max`, returns a structured
  HTTP 422 via `failQtyLimit()`:
  `{ success:false, code:'QTY_LIMIT', productId, name, maxQty, unit, message:"Max N allowed / सिर्फ N तक" }`.
  Keeps the `success:false` + `message` envelope so existing `apiError()` still shows the message.
- `api-node/src/routes/cart.ts` (new) — PUBLIC, no-auth, read-only `POST /api/cart/validate`.
  Body `[{ id, quantity }]` (zod validated, 1..50). Reads products by id and returns per line:
  `{ id, name, unit, maxQty, requested, ok, allowed, message }` where `maxQty` (null = unlimited),
  `ok = maxQty==null || requested<=maxQty`, `allowed = min(requested, maxQty)`, `message` = the
  bilingual string when over the cap. NEVER trusts a client-sent limit — the cap is read from the DB.
  Mounted in `server.ts` as `app.use('/api/cart', cartRouter)` (public, before `/api/admin`).

## 7. Response shapes (reference)

Order placement over cap (HTTP 422):
```json
{ "success": false, "code": "QTY_LIMIT", "productId": 12, "name": "Soap",
  "maxQty": 3, "unit": "pcs", "message": "Max 3 allowed / सिर्फ 3 तक" }
```

`POST /api/cart/validate` with `[{ "id": 12, "quantity": 5 }]` (soap, max 3):
```json
{ "success": true, "lines": [
  { "id": 12, "name": "Soap", "unit": "pcs", "maxQty": 3, "requested": 5,
    "ok": false, "allowed": 3, "message": "Max 3 allowed / सिर्फ 3 तक" } ] }
```
For chini (unit kg, max 1): `maxQty: 1, unit: "kg", message: "Max 1 kg allowed / सिर्फ 1 kg तक"`.

## 8. Build & test results (actually run)

- `api-node`: `npm run build` first failed with 5 tsc errors — ALL were the expected stale
  Prisma client missing `max_qty_per_order`. Ran `npx prisma generate` (local engine, offline);
  `npm run build` then **passed with zero errors**.
- `api-node`: `npm test` → **49 tests pass, 0 fail** — includes the new `qty-limit.test.ts`
  (pcs/weight/empty-unit message cases) and the catalog-leak suite (owner-only fields still
  absent; public hints incl. `max_qty_per_order` present).
- `web`: `npm run build` (`generate-sitemap && tsc -b && vite build`) — one TS error surfaced
  (`Product.unit` missing) and was fixed by declaring `unit?: string` on the public `Product`
  type; rebuild **passed, built in ~4.6s, zero TS errors** (only a non-fatal Vite chunk-size
  advisory remains, pre-existing).

## 9. Behaviors demonstrated

- (a) Admin can set a per-product limit for pcs and kg — AdminProducts field persists via
  `productSchema.maxQtyPerOrder` + `parseMaxQty` into `products.max_qty_per_order`.
- (b) Public catalog returns the limit — `max_qty_per_order` in `PUBLIC_PRODUCT_SELECT`,
  asserted present by the leakage test, normalized to a number in `queries.ts`.
- (c) Storefront disables `+` and shows "Max N allowed" at the cap for pcs and kg — ProductCard,
  ProductDetails, Cart; store clamps + toast; weight shows the unit.
- (d) Server rejects an over-limit order line (422 `QTY_LIMIT`) AND `/api/cart/validate` returns
  the structured `{ maxQty, unit, message }` response (shapes above). The caps are read from the
  DB; the client never sends a trusted limit.

Note: a live-DB manual smoke was NOT run (no shared dev DB touched per the task; a concurrent
Marketing/WhatsApp workflow uses this working tree). Enforcement is proven by the type-checked
build, the unit tests, and the leakage test over the exact source-of-truth projection.
