# Implementation Plan — 4A Store Mobile UI Polish (VISUAL/STYLING ONLY)

Scope: a consistency/polish sweep of the Expo SDK 54 React Native app at
`c:\xampp\htdocs\static4a\.worktrees\app-ui-polish\4astore-v2\mobile`. **No data-fetching,
caching, auth, React Query, API, or business-logic changes.** Centralize changes in the shared
primitives (`src/components/ui.tsx`, `src/components/Icon.tsx`, `src/theme.ts`) so screens inherit
polish; per-screen edits are style-only and tiny.

## Environment / verification (read first)

- Verification command is `npx tsc --noEmit` (project script: `npm run typecheck`). RN project —
  there is **no browser**; verify by code-trace + typecheck only.
- The worktree has **no `node_modules`** yet, and `tsconfig.json` extends `expo/tsconfig.base`
  (which lives in `node_modules`). So typecheck fails with hundreds of phantom errors (`Cannot
  find module 'fs'`, `global 'Promise'`, etc.) until deps are installed.
  **Prerequisite (run ONCE, from `...\4astore-v2\mobile`): `npm install`** (uses the committed
  `package-lock.json`; no new deps added). After that, `npx tsc --noEmit` is the real gate.
- Do NOT add any npm dependency. Use existing `expo-linear-gradient`, the emoji `Icon` wrapper and
  RN primitives only.
- Keep every bilingual Hindi/English string.
- Files `register.tsx` and `PaymentModal.tsx` referenced in the brief do NOT exist — login.tsx
  holds both login+register; PaymentSheet.tsx is the payment UI. Plan reflects the actual files.

## Parallel-workflow owned files (branch `app-local-first`) — MINIMIZE/FLAG

Minimize and clearly flag any edit to: `app/checkout.tsx`, `app/(tabs)/orders.tsx`,
`app/page/[slug].tsx`, `app/admin/orders.tsx`, `src/store/addresses.ts` (new), and possibly
`src/api.ts` / `src/store/auth.ts`. Prefer NOT touching these; where a visual fix is unavoidable
keep it to a one-line style prop and call it out so the merge is trivial. `app/product/[id].tsx` is
NOT owned by the other workflow — this workflow owns its layout fix fully.

---

- [ ] 1. Normalize the Icon size scale and tab/header icon weight in `src/components/Icon.tsx`.
      Bump the `SIZE` scale so inline/header/tab glyphs read evenly: `xs:14, sm:16, md:20, lg:24,
      xl:30` (before: `12/15/18/22/28`) and keep `lineHeight = fontSize + 2`. No call-site changes
      needed (every usage already passes a size key). This single change lifts header, bottom-tab
      and inline icon consistency app-wide.
      Files: `src/components/Icon.tsx`
      Verify: `npx tsc --noEmit` passes; code-trace that `TabIcon` (size `lg`) and StoreHeader icons
      (size `lg`/`sm`) still render and nothing hardcodes a numeric size that now conflicts.

- [ ] 2. Add shared font-role + layout tokens to `src/components/ui.tsx` `styles` and `src/theme.ts`.
      In `theme.ts` add a `space = { xs:4, sm:8, md:12, lg:16, xl:20 }` scale and an `iconScale`
      note comment (no behavior). In `ui.tsx` `styles`, add reusable text roles used across screens:
      `body { fontSize:14, color: colors.dark }`, `bodyStrong { fontSize:14, fontWeight:'700',
      color: colors.dark }`, `price { fontSize:16, fontWeight:'800', color: colors.primaryDark }`,
      `pill`/`pillActive`/`pillText` (hoisted from products.tsx so chips are shared). Export them via
      the existing `styles` object. Do not remove existing keys. This gives later per-screen edits a
      token to point at instead of literals.
      Files: `src/theme.ts`, `src/components/ui.tsx`
      Verify: `npx tsc --noEmit` passes; `styles.body`/`styles.pill` resolve.

- [ ] 3. Make `GradientButton` label never-wrap and height-consistent in `src/components/ui.tsx`.
      Add `numberOfLines={1}` + `adjustsFontSizeToFit` (minimumFontScale ~0.85) to the gradient
      button's `Text`, and add an optional `size?: 'sm'` prop mapping to `styles.gradBtnSm`
      (`minHeight:44, paddingHorizontal:16`). Keep default minHeight 48 / pill radius. This fixes
      long bilingual labels wrapping (used on product details, checkout, order-success).
      Files: `src/components/ui.tsx`
      Verify: `npx tsc --noEmit` passes; code-trace all `GradientButton` usages still compile (new
      prop is optional).

- [ ] 4. Make the `Stepper` height match buttons and expose an optional `height` in
      `src/components/ui.tsx`. Keep 34×34 step buttons but set the stepper's outer `minHeight:44`
      (center content) and reduce `borderWidth` 2→1.5 to match Field/pill borders, so a stepper
      placed beside a button lines up to the same 44–48px band. `stepQty` minWidth stays 34.
      Files: `src/components/ui.tsx`
      Verify: `npx tsc --noEmit` passes; code-trace Stepper usages in product details, cart.tsx,
      ProductCard.tsx — all keep working (props unchanged).

- [ ] 5. **FIX product-details add-to-cart row + zoom/rotate controls** in `app/product/[id].tsx`.
      (a) In-cart row: change the wrapper `View` from `alignItems:'center'` to `alignItems:'stretch'`
      so stepper and gradient button share one height; shorten the button label to
      `"Cart देखें →"` (keeps bilingual intent, single line on 360px) and pass `size="sm"` so its
      44px height matches the stepper's new 44px; keep `style={{ flex: 1 }}`. (b) Zoom badge: give
      it `borderRadius: radius.pill`, align its font to the shared small scale, keep the dark glass
      bg. (c) Rotate buttons row: already uses shared `Button small outline` — just set the row
      `gap` to the `space.sm` token and ensure both buttons are `flex:1` equal width (already true).
      (d) In-modal `ZoomViewer` rotate button + hint: normalize to `radius.pill` and consistent
      font sizes; no logic change (zoom/rotate state untouched).
      Files: `app/product/[id].tsx`
      Verify: `npx tsc --noEmit` passes; code-trace: on a 360px width the gradient label is one line,
      stepper + button same height, controls aligned; `useCart`/`useFeature` calls unchanged.

- [ ] 6. Polish `src/components/ProductCard.tsx` add button to use the shared button look (style-only).
      Replace the ad-hoc `addBtn` (secondary yellow, text-shadow) visual with the shared primary
      style: keep it a `Pressable` (grid perf) but set `backgroundColor: colors.primary`, `radius.sm`,
      `minHeight:34`, drop the text-shadow, use `styles.btnText`-equivalent sizing. Keep the inline
      Stepper branch. No logic/handler change.
      Files: `src/components/ProductCard.tsx`
      Verify: `npx tsc --noEmit` passes; code-trace add/stepper branches unchanged behaviorally.

- [ ] 7. Sweep `app/(tabs)/index.tsx` (home) for token consistency (style-only).
      Point the hero `shopBtn`/`shopText`, ad cards and category chips at `radius`/`space` tokens;
      ensure the "View All Products" GradientButton uses default sizing; normalize section-title
      spacing via `space`. No change to banner/ads/category data or the auto-slide effect.
      Files: `app/(tabs)/index.tsx`
      Verify: `npx tsc --noEmit` passes; code-trace slider/refresh logic untouched.

- [ ] 8. Sweep `app/(tabs)/products.tsx` to consume the shared chip/pill styles from step 2.
      Replace the local `s.pill/pillActive/pillText` with the shared `styles.pill*` (import from
      ui.tsx) so category/filter/sort/brand chips match the rest of the app; keep the filter panel
      layout and all filter LOGIC (useMemo result) exactly as-is.
      Files: `app/(tabs)/products.tsx`
      Verify: `npx tsc --noEmit` passes; code-trace `result`/filter memo and `setParam` unchanged.

- [ ] 9. Sweep `app/(tabs)/profile.tsx`, `app/(tabs)/cart.tsx`, `app/order-success.tsx` for
      spacing/button consistency (style-only). Cart: stepper now 44px aligns with the price row —
      verify spacing. Order-success: the stacked action buttons already use `gap:10`; make the
      WhatsApp/screenshot `Button`s use consistent `radius.pill` where one already has
      `borderRadius:30` and the other doesn't (unify to `radius.pill`). Profile: `Action` rows and
      Stat spacing to `space` tokens; keep all handlers/queries.
      Files: `app/(tabs)/profile.tsx`, `app/(tabs)/cart.tsx`, `app/order-success.tsx`
      Verify: `npx tsc --noEmit` passes; no handler/query edits (code-trace).

- [ ] 10. Sweep `app/login.tsx`, `src/components/PaymentSheet.tsx`, `src/components/StoreHeader.tsx`
      for off-palette hex and button radius (style-only). PaymentSheet uses several off-palette
      slate/blue hexes (`#111827`,`#64748b`,`#5f259f`,`#1a73e8` etc.) — the brand-colored
      PhonePe/GPay buttons (`#5f259f`/`#1a73e8`) are intentional payment-brand colors: KEEP those,
      but replace generic grays (`#64748b`,`#334155`) with `colors.gray`/`colors.dark` and unify
      button radii to `radius.pill` where a one-off `borderRadius:30` already appears. StoreHeader:
      confirm icon sizes from step 1 look right. Login: ensure the register OTP `Button` and submit
      `GradientButton` spacing use `space` tokens. No OCR / payment / auth logic touched.
      Files: `app/login.tsx`, `src/components/PaymentSheet.tsx`, `src/components/StoreHeader.tsx`
      Verify: `npx tsc --noEmit` passes; code-trace OCR/launch/confirm and login/register handlers
      untouched.

- [ ] 11. Sweep tracking/rider/admin-detail/roles screens for PURE visual consistency, NO behavior.
      `app/track/[orderId].tsx`: hero gradients and the status timeline are fine — only unify the
      cancelled/hero radii to `radius.lg` tokens and status-step colors already use `colors`. KEEP
      all tracking data flow and `TrackMap` usage unchanged. `app/rider.tsx`: status/action
      `Button`s already shared — only normalize row `gap` to `space.sm`; **do not touch GPS/accept/
      setStatus logic**. `app/admin/order/[id].tsx` & `app/admin/roles.tsx`: replace stray hex
      (`#f0f0f0`) with `colors.border`, point perm-chip radius at `radius.pill`; keep handlers.
      `app/admin/order/[id].tsx` and `roles.tsx` are NOT in the parallel-owned list.
      Files: `app/track/[orderId].tsx`, `app/rider.tsx`, `app/admin/order/[id].tsx`,
      `app/admin/roles.tsx`
      Verify: `npx tsc --noEmit` passes; code-trace: TrackMap/rider GPS/admin status handlers
      unchanged.

- [ ] 12. **PARALLEL-OWNED, minimize + flag:** apply only trivial token-only touches to
      `app/checkout.tsx`, `app/(tabs)/orders.tsx`, `app/admin/orders.tsx`, `app/page/[slug].tsx`
      IF needed for visual consistency. Candidates (each a single style prop): checkout inline
      `#e8f5e9`/`#555` → keep green highlight but move text to `colors.gray`; orders.tsx Track/
      Invoice button row `gap` → `space.sm`. **Prefer leaving these untouched.** For each edit made,
      add a one-line `// ui-polish: style-only` comment so the merge with `app-local-first` is
      obvious. Do NOT edit `src/api.ts` / `src/store/auth.ts`.
      Files (only if required): `app/checkout.tsx`, `app/(tabs)/orders.tsx`, `app/admin/orders.tsx`,
      `app/page/[slug].tsx`
      Verify: `npx tsc --noEmit` passes; `git -C c:\xampp\htdocs\static4a\.worktrees\app-ui-polish
      diff --stat` shows only tiny style diffs in these files (ideally zero).

- [ ] 13. Final integration pass: run the full typecheck and a diff review.
      Files: none (verification only)
      Verify: from `...\4astore-v2\mobile` run `npx tsc --noEmit` → exit 0; `git -C
      c:\xampp\htdocs\static4a\.worktrees\app-ui-polish diff --stat` shows changes concentrated in
      `src/components/ui.tsx`, `src/components/Icon.tsx`, `src/theme.ts`, `app/product/[id].tsx` with
      only small per-screen style diffs elsewhere and minimal/zero diff in parallel-owned files.
