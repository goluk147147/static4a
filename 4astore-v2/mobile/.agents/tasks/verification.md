# Verification — Two confirmed mobile bugs (NATIVE RN Expo app)

Scope: source fixes only. The Android APK/AAB was NOT rebuilt (the user rebuilds separately).
No dependencies added or bumped. No unrelated refactors.

## What changed

### BUG 1 (MAJOR): Village dropdown hidden behind keyboard on checkout
File: `app/checkout.tsx`
- Added `KeyboardAvoidingView`, `Platform`, and `useRef` to imports.
- The address-editor `<Modal>` body no longer nests inside the shared `<Screen>` component. It now
  owns its own layout — `StoreHeader` + `KeyboardAvoidingView` (`behavior='padding'` on iOS,
  `undefined` on Android, matching the existing `app/login.tsx` pattern; Android relies on
  `softwareKeyboardLayoutMode:'resize'`) + a `ScrollView` (ref `editorScroll`,
  `keyboardShouldPersistTaps="handled"`, same `padding:14 / paddingBottom:32` content style as `Screen`).
  The shared `Screen` component is untouched, so every other screen is unaffected.
- The Village field wrapper captures its `y` offset via `onLayout` (`villageY` ref). On Village
  `onFocus`, the editor ScrollView calls `scrollTo({ y })` so the focused field and its dropdown lift
  above the keyboard.
- `st.dropdown` changed from `position:'absolute', top:70` to in-flow (`marginTop:4`), so the options
  render directly under the field and move with it when the ScrollView scrolls (an absolutely
  positioned dropdown could render off-screen when the field is pushed up). Inner options `ScrollView`
  keeps `keyboardShouldPersistTaps="handled"` and `maxHeight:180`.

### BUG 2 (MAJOR): Rider 'Accept' slow response
Files: `app/rider.tsx` (client-only — the server handler `POST /orders/accept` in
`api-node/src/routes/orders.ts` is already lean: one `findUnique` + one `update`, no synchronous push
or other slow side-effect on the response path, so no server change was needed).
- Added `accepting` state (`string | null`) — the tapped Accept button now gets
  `loading={accepting === o.order_id}` and `disabled={!!accepting}`, so the tap gives instant feedback.
- `accept()` now reconciles the React Query cache in place with the server's returned row
  (`qc.setQueryData(['all-orders'], …)` via `normalizeOrder`) so the order moves to "My Deliveries"
  as soon as the fast accept call returns, instead of waiting on a full `/orders` refetch. The
  `invalidateQueries` call is kept AFTER the optimistic update as a background reconcile (no longer
  gates the visible update). `finally { setAccepting(null) }`. On error the cache is untouched, so no
  rollback is needed.

## Commands run (exact) and results

Baseline (before changes):
- `npm test` in `4astore-v2/mobile` → 27 pass, 0 fail (exit 0)
- `npm run typecheck` in `4astore-v2/mobile` → exit 0

After changes:
- `npm test` in `4astore-v2/mobile` → **27 pass, 0 fail** (exit 0)
- `npm run typecheck` in `4astore-v2/mobile` (= `tsc --noEmit`) → **exit 0**
- `npm run build` in `4astore-v2/api-node` (= `tsc -p tsconfig.json`) → **exit 0**
  (safety check only — no server change was required; the accept handler is read-only in this task.)

## Runtime check
Deferred — no Metro/emulator was run in this environment. The automated gate is the mobile
typecheck + test suite (all green) and the api-node build (green). Manual runtime acceptance:
- BUG 1: Checkout → Edit address → tap `Village (गाँव)` → field + dropdown stay visible above the
  keyboard, list scrolls, options tappable.
- BUG 2: Log in as a rider with an available order → tap Accept → button disables + spins instantly,
  success toast, order jumps to "My Deliveries" without a multi-second delay.
