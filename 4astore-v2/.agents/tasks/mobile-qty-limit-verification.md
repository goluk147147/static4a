# Verification — Port per-order quantity cap (`max_qty_per_order`) into the 4AStore mobile app

Scope: MOBILE-ONLY, purely additive. A product with a null/blank/<=0 limit behaves exactly as
before. No `api-node/`, `prisma/`, or `web/` files were touched.

## Files changed (all under `4astore-v2/mobile/`)

| File | Change |
|---|---|
| `src/types.ts` | Added `unit?: string` and `max_qty_per_order?: number \| null` to `Product`; added `maxQty?: number \| null` and `unit?: string` to `CartItem`. Doc comments mirror web. Purely additive optional fields. |
| `src/queries.ts` | In `normalizeProduct`, added `max_qty_per_order: p.max_qty_per_order == null ? null : (Number(p.max_qty_per_order) \|\| null)` — identical to web. `unit` flows through the existing `...p` spread. |
| `src/qtyLimit.ts` (new) | `qtyLimitMsg(maxQty, unit?)`, `qtyLimitCaption` alias, and `cap(v)` helper. Bilingual copy byte-identical to `web/src/lib/qtyLimit.ts`: `Max N allowed / सिर्फ N तक` (unit suffix shown only for non-`pcs` units). |
| `src/store/cart.ts` | Ported the web clamp-and-inform logic. `add`: computes `cap(p.max_qty_per_order)`, clamps `existing.quantity + qty` (or `qty` for new) to the cap, stores `maxQty`+`unit` on the item for BOTH new and existing items (refreshes from the live product so a changed cap is picked up). `setQty`: clamps to the item's stored `maxQty` (null = unlimited). Backward compat: legacy persisted items without `maxQty`/`unit` are treated as unlimited (`cap(undefined)` → null) and refresh on the next `add`; no migration, AsyncStorage key stays `4astore-cart`. |
| `src/components/ui.tsx` | `Stepper` gained an OPTIONAL `plusDisabled?: boolean` prop that disables + dims (opacity 0.4) only the `+` button and sets `accessibilityState.disabled`. Default (prop omitted) renders exactly as before, so every existing call site is unaffected. |
| `src/components/ProductCard.tsx` | Computes `max`/`atMax`; passes `plusDisabled={atMax}` to the stepper, guards `onPlus` to no-op at the cap, and renders the `Max N allowed / सिर्फ N तक` caption (`colors.accent`, 11px) below the stepper when at the cap. Non-capped products unchanged. |
| `app/product/[id].tsx` | Same cap + disabled `+` + bilingual caption (`colors.accent`, 13px) in the in-cart branch. Share/zoom/rotate logic untouched. |
| `app/(tabs)/cart.tsx` | Per-row cap resolved from the live catalog first, mirroring web: `liveProduct?.max_qty_per_order ?? i.maxQty`; `unit` from `liveProduct?.unit ?? i.unit`. Disabled `+` at the cap, `onPlus` guarded, caption shown under the name/weight line. `−`/remove unchanged. |
| `src/__tests__/cart.test.ts` (new) | Unit tests for the store clamp (new/existing clamp + maxQty/unit carry + refresh, null/0 unlimited, `setQty` clamp, `setQty(id,0)` removes, legacy item without `maxQty` doesn't throw). |
| `src/__tests__/qtyLimit.test.ts` (new) | Unit tests for `qtyLimitMsg`/`qtyLimitCaption`/`cap`. |
| `src/__tests__/loader.mjs` (test infra) | Generalized the ESM test loader to resolve any relative, extensionless `./x`/`../x` specifier to its on-disk `.ts` sibling (previously only `../api` was special-cased). Needed because `cart.ts` imports `../qtyLimit` extensionless (app-code convention; Metro/tsc resolve it, Node's strict ESM resolver does not). Test-only; does not affect the app bundle. |

## How the "max N" message is surfaced

1. **Primary (always-on caption):** when the item is at its cap, a `Max N allowed / सिर्फ N तक`
   caption renders below the stepper on the product card, the product-detail screen, and each cart
   row (unit shown only for non-`pcs` units, e.g. `Max 1 kg allowed / सिर्फ 1 kg तक`).
2. **Secondary (transient):** on tapping `+` past the cap, the cart store calls the app's EXISTING
   `showToast(qtyLimitMsg(...), 'error')` helper (`src/store/ui.ts`, rendered app-wide via `Overlays`).
   This is the mobile analogue of the web storefront's `showToast` and matches its behavior. No
   `ToastAndroid` and no new dependency were added. The `+` button is also disabled/dimmed at the cap,
   so an over-tap is blocked at the UI as well as clamped in the store.

## Verification run (from `4astore-v2/mobile`)

- `npm run typecheck` (tsc --noEmit) → **exit 0, zero errors**.
- `npm run typecheck:tests` (tsc -p tsconfig.test.json) → **exit 0, zero errors**.
- `npm test` (node:test suite, `src/__tests__/**/*.test.ts`) → **89 pass, 0 fail** (84 prior + 5 net
  new; both new test files green, all pre-existing suites still green).

No gradle/`.aab` build, `expo prebuild`, or Metro/Expo start was run (per instructions).

## Protected files — confirmed NOT modified by this change

`push.ts`, `index.js`, `app/login.tsx`, `store/auth.ts`, `share.ts`, `links.ts`, `pos.ts`,
`posInvoice.ts`, `app.config.ts`, native config, `google-services.json`, and any
Android/gradle/signing files were NOT touched by this task. Google login, push (FCM + Notifee),
smart short-link/share, and POS are unaffected.

> NOTE: `app.config.ts` shows as modified in the working tree, but that change (versionCode 34 → 35
> + a Firebase-Analytics comment) is from CONCURRENT, unrelated work and was **not** made by this
> task. It was deliberately **left unstaged** — this commit stages only the mobile qty-limit files
> plus this verification note.

## IMPORTANT — the fix reaches customers only via a NEW .aab

The web deploy does **NOT** update the installed Android app. For customers to receive this fix the
founder MUST build a **NEW Android `.aab`** with an **incremented `versionCode`** (the Play Store
rejects a build whose versionCode is not higher than the last upload) and upload it to the Play
Store. Until a new `.aab` is published and rolled out, installed apps keep ignoring the per-order cap.
