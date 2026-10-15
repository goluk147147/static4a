# Verification — Firebase Analytics wired into the 4A Store mobile app

Goal: the app now actually SENDS Firebase Analytics events, so the console stops showing
"No data available". Added `@react-native-firebase/analytics` on top of the existing,
working `@react-native-firebase/app` + `messaging` (push) setup. MOBILE-ONLY — nothing under
`api-node/`, `prisma/`, or `web/` was touched.

## Analytics version chosen (and why it matches)

- Added `@react-native-firebase/analytics` at **`22.4.0`** — the EXACT same major.minor.patch as
  the already-installed `@react-native-firebase/app@22.4.0` and
  `@react-native-firebase/messaging@22.4.0`. The RNFirebase packages share a single native
  `app` module; a mismatched analytics version would pull a second `@react-native-firebase/app`
  and cause a native version conflict at build time.
- `npm install` succeeded (added 2 packages, lockfile updated). `npm ls` confirms the resolution:
  ```
  ├─┬ @react-native-firebase/analytics@22.4.0
  │ └── @react-native-firebase/app@22.4.0 deduped
  ├── @react-native-firebase/app@22.4.0
  └─┬ @react-native-firebase/messaging@22.4.0
    └── @react-native-firebase/app@22.4.0 deduped
  ```
  `app` is **deduped** at 22.4.0 — single native module, no conflict. The existing `app`/`messaging`
  versions were NOT changed.

## Config-plugin decision

**No config-plugin entry was needed and none was added.** RNFirebase v22 analytics autolinks
through the already-present `'@react-native-firebase/app'` plugin (which also applies
`google-services.json`). The analytics package ships no Expo config plugin and needs no native
code change beyond the app plugin, so `app.config.ts` `plugins` and `expo-build-properties` are
unchanged. (Adding a non-existent analytics plugin string would have broken prebuild.) Verified via
`git diff app.config.ts`: the only change there is `versionCode 34 → 35` + its comment line — no
plugin additions.

## The four events wired (minimal, additive, no-throw)

New helper `mobile/src/analytics.ts` wraps `@react-native-firebase/analytics` with fire-and-forget,
never-throw helpers (`logScreenView`, `logAddToCart`, `logPurchase`, `logAppOpen`, generic
`logEvent`). Each swallows sync throws AND promise rejections via try/catch so analytics can never
crash the app. No PII in any param — only product id/name, qty, order id and numeric value.

1. **`app_open`** — `mobile/app/_layout.tsx`: one mount-once effect `logAppOpen()`. RNFirebase also
   auto-logs the native `app_open` on cold start; they share the same event name and dedupe, so the
   explicit call is safe and additionally covers JS warm starts.
2. **`screen_view`** — `mobile/app/_layout.tsx`: one effect driven by `usePathname()` from
   expo-router — on pathname change it calls `logScreenView(pathname)` (screen name = route path,
   e.g. `/products`, `/product/[id]`, `/checkout`). Routing/`<Stack>` untouched.
3. **`add_to_cart`** — `mobile/src/store/cart.ts` inside `add(p, qty)`, AFTER the qty-cap clamp.
   It logs `logAddToCart(p, added)` only when `added = next - existing.quantity > 0`, so a no-op add
   at the cap does not log a false event. The clamp math, `showToast` cap message, and returned
   state shape are unchanged.
4. **`purchase`** — `mobile/app/checkout.tsx` inside the shared `navigateToSuccess(...)` — the ONE
   success chokepoint used by both the normal confirm path and the timeout-recovery path. Fires
   `logPurchase(orderId, totals.total, orderItems)` once on real success, before `router.replace`.
   Only id/name/qty/price + numeric total — no customer name/mobile/address. The two-phase order
   POST, screenshot upload, and `clear()` are unchanged.

### Test harness
`mobile/src/__tests__/loader.mjs` gained a `@react-native-firebase/analytics` mock (default export
= `analytics()` factory returning no-op async methods) so `cart.ts` (which now imports the helper)
and the new helper test load under plain Node. New smoke test
`mobile/src/__tests__/analytics.test.ts` asserts every helper is callable and never throws.

## Verification results (all run from `c:\xampp\htdocs\static4a\4astore-v2\mobile`)

- `npm install` → OK (added analytics, updated `package-lock.json`).
- `npm ls @react-native-firebase/analytics @react-native-firebase/app @react-native-firebase/messaging`
  → analytics 22.4.0, app deduped 22.4.0 (no conflict).
- `npm run typecheck` (`tsc --noEmit`) → **0 errors**.
- `npm run typecheck:tests` (`tsc --noEmit -p tsconfig.test.json`) → **0 errors**.
- `npm test` → **94 tests pass, 0 fail** (all existing suites green, incl. the 6 qty-limit cart
  tests unchanged, plus the 5 new `analytics.test.ts` no-throw tests).

Native build (gradle `.aab`), `expo prebuild`, and Metro were NOT run — out of scope here; the
founder builds the `.aab`.

## No protected feature broke

Changed files (all under `mobile/`): `package.json`, `package-lock.json`, `app.config.ts`
(versionCode 35 only), `app/_layout.tsx`, `app/checkout.tsx`, `src/store/cart.ts`,
`src/__tests__/loader.mjs`, new `src/analytics.ts`, new `src/__tests__/analytics.test.ts`.
NOT touched: `push.ts`, `index.js`, `app/login.tsx`, `store/auth.ts`, `share.ts`, `links.ts`,
`pos.ts`, `posInvoice.ts`, `google-services.json`, the signing/native plugins, and the committed
qty-limit files beyond the single additive `add_to_cart` line in `cart.ts`. Google login, push
(FCM + Notifee), smart short-link/share, POS, and the per-order qty cap are untouched and still
covered green by the test suite.

## Founder reminders (IMPORTANT)

- **A NEW `.aab` must be built and uploaded.** This change only lands in the app once the founder
  runs `expo prebuild` + the release build at **versionCode 35** (already set in `app.config.ts`)
  and uploads it to the Play Store. The currently-installed build has NO analytics module, so it
  will keep showing "No data available" no matter how long you wait.
- **Firebase Analytics is NOT real-time.** Standard events take up to **~24 hours** to appear in the
  Firebase console reports. To see events IMMEDIATELY while testing, enable **DebugView** for a
  device in debug mode (e.g. `adb shell setprop debug.firebase.analytics.app com.store4a.app`),
  then watch Firebase console → DebugView.
