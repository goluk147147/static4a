# Implementation Plan — 4A Store mobile: local-first & no-stuck-spinner

Scope: make the Expo SDK 54 app (`c:\xampp\htdocs\static4a\.worktrees\app-local-first\4astore-v2\mobile`)
local-first and resilient so no screen hangs on a bare spinner, and harden the 401/refresh path.
NO new npm dependency. Do NOT touch tracking (`src/components/TrackMap.tsx`, `app/track/*`) or the
rider flow (`app/rider.tsx`, `/orders/accept`, `/tracking/*`). Do NOT change the server/API or any
response shape. No visual restyle — reuse the existing `Shimmer` from `src/components/ui.tsx` only.

## Verification setup (run once before any item)

The worktree has NO `node_modules`. Install first, then every item verifies with the project's real
typecheck. There is no unit-test framework in this app; `tsc --noEmit` is the build/verification gate.

- Install: from `c:\xampp\htdocs\static4a\.worktrees\app-local-first\4astore-v2\mobile` run `npm install`.
- Verify command (used by every item below): `npm run typecheck` (i.e. `tsc --noEmit`).
- KNOWN PRE-EXISTING ERROR TO IGNORE: `app.config.ts` reports a tsc error about `usesCleartextTraffic`
  on the `android` config object (the Expo `ExpoConfig` type does not declare that key). It exists on
  the green base and is NOT introduced by this work. "Pass" = no NEW errors beyond this one. Do not
  "fix" it.

## Discrepancies between the task brief and the actual code (resolved decisions)

- The brief describes `api.ts` features that are NOT in the code: a 15s `AbortController` timeout, a
  `_netRetried` GET auto-retry, `Connection: keep-alive`, and a `setOnSessionExpired` hook; and an
  auth `reloadSession`/`/users/session`. The real `api.ts` has: Bearer header, `X-Client: mobile`, a
  single silent refresh on 401 via `_retried`, and `refreshSession()` that only clears the refresh
  token on 401/404 (not on network error). The real `auth.ts` logout is already local-first and the
  401→refresh→retry path already exists. DECISION: plan against the ACTUAL code. Do NOT invent a 15s
  AbortController or a `setOnSessionExpired` hook; the 401 work is an audit + two small guarantees
  (see item 7), not a rewrite.
- The brief lists "staff order delete with a loader" in `app/admin/orders.tsx`. There is NO delete
  feature anywhere in the mobile app (confirmed by searching `app/` and `src/`). The real staff
  loader-hang surface is the order **status-change** buttons in `app/admin/order/[id].tsx`
  (`setStatus()` sets `saving` and each button spins via `loading={saving === st}`), including the
  `Cancelled` action which is the closest thing to a "delete". DECISION: implement the optimistic
  pattern on the status change (optimistic cache update + rollback on failure) so the button never
  hangs. Note this in the code comment so a reviewer understands the mapping.
- `useMyOrders` keys on `['orders', mobile]` (the user's mobile), not `user.id`. DECISION: the
  per-user orders cache key uses the mobile string that is already the query key, keeping cache and
  query aligned.

---

- [ ] 1. Create the local-first address store `src/store/addresses.ts`, following `src/persistCache.ts`
      conventions exactly: `import AsyncStorage from '@react-native-async-storage/async-storage'`,
      per-user versioned key ``4astore:addresses:v1:${userId}`` and a pending-queue key
      ``4astore:addresses:pending:v1:${userId}``, `try/catch` around every storage/network call, NO
      new dependency. Export: `loadLocal(userId): Promise<SavedAddress[]>` (instant read, `[]` on
      missing/corrupt); `saveLocal(userId, list): Promise<void>`; `upsertLocal(userId, addr):
      Promise<SavedAddress[]>` (replace by `id`, else prepend; return the new list);
      `syncFromServer(userId): Promise<SavedAddress[] | null>` (`api.get('/addresses')`, read
      `d.addresses`, `saveLocal`, return list; `null` on failure, error swallowed);
      `queuePending(userId, payload): Promise<void>` and `flushPending(userId): Promise<SavedAddress[]
      | null>` (POST each queued payload via `api.post('/addresses', payload)`, reconcile the
      server-returned `address.id` over any negative temp id in local storage, clear the queue on
      success; keep the queue and return `null` on failure). Use NEGATIVE temp ids (`-Date.now()`) for
      optimistic local-only rows; a create payload must send `id: undefined` (never a temp id) exactly
      like today's `id: selectedId ?? undefined`. Reuse the `SavedAddress` type from `src/types.ts`.
      Files: src/store/addresses.ts
      Verify: `npm run typecheck` — no new errors beyond the known `app.config.ts` one.

- [ ] 2. Rewire `app/checkout.tsx` address GET to be local-first on mount. Add a `loadingAddr`
      state (default `true`). In the mount effect keyed on `user?.id`: `await loadLocal(user.id)`
      FIRST, then `setSaved(list)`, select default (`Number(is_default)===1`) or first via the existing
      `fill()`, and `setLoadingAddr(false)` with NO network await. Only if local is empty open the
      editor (`setEditorOpen(true)`) as today. Then, NOT awaited: `syncFromServer(user.id)` — if it
      returns a list, merge into state preserving `selectedId` when that address still exists; and
      `flushPending(user.id)` once. Remove the old `loadAddresses()` network-on-mount await (keep a thin
      helper only if still referenced). Show a spinner only while `loadingAddr && !saved.length`
      (first-ever use); otherwise render the saved UI immediately.
      Files: app/checkout.tsx
      Verify: `npm run typecheck` — no new errors.

- [ ] 3. Rewire `app/checkout.tsx` `saveFromEditor()` to be optimistic (Save button must never hang on
      the network). Keep ALL existing validation unchanged: name / `/^[6-9]\d{9}$/` mobile / address /
      city / `pincode === '824301'`, `verifyVillage`, `setCity(v.match)`, and
      `resolveDeliveryCoordinates` via the existing `buildCustomer()`. Then build a `SavedAddress`
      optimistically (`id: selectedId ?? -Date.now()`, mapping `buildCustomer` fields to
      `receiver_name/phone/house_no/landmark/city/pincode/latitude/longitude/full_address/label`),
      `await upsertLocal(user.id, addr)`, then synchronously `setSaved(list)`, `setSelectedId(addr.id)`,
      `setEditorOpen(false)`, success toast — WITHOUT awaiting the network, and WITHOUT leaving
      `savingAddr` true (do not block the Save button on the POST). Fire the server write in the
      background: build the same payload the current `saveAddress()` builds (`action`, `id: selectedId
      ?? undefined`, …), `api.post('/addresses', payload)` then reconcile the real `address.id` into
      local + state (replace the temp negative id); on failure `queuePending(user.id, payload)` and let
      the next mount flush. The `GradientButton` `loading={savingAddr}` must reflect only the brief
      synchronous validation, never the network.
      Files: app/checkout.tsx
      Verify: `npm run typecheck` — no new errors.

- [ ] 4. Remove the blocking save API call from `app/checkout.tsx` `proceed()`. Today `proceed()` calls
      `await saveAddress(c, label)` before opening the payment sheet; delete that network call so
      proceed-to-payment does NO save API call (the address is already persisted locally by item 3 and
      synced in the background). Keep ALL validation, age-restricted confirm, `buildCustomer`,
      `setCustomer`, and `setPayOpen(true)` exactly as-is.
      Files: app/checkout.tsx
      Verify: `npm run typecheck` — no new errors; manual read-through confirms no `/addresses` POST on
      the proceed path.

- [ ] 5. Add per-user orders cache + skeleton to `app/(tabs)/orders.tsx` so My Orders shows the last
      list instantly and never a bare infinite spinner. In `src/persistCache.ts`, add a small helper
      pair for per-user order lists keyed ``4astore:orders:v1:${mobile}`` (own key, same AsyncStorage +
      try/catch style, NOT in `PERSIST_KEYS`): `loadOrdersCache(mobile)` and `saveOrdersCache(mobile,
      orders)`. In `orders.tsx`: seed `useMyOrders` from the cache via `initialData` (read synchronously
      is not possible, so use a local `cached` state hydrated in an effect, or set `queryClient`'s data
      for `['orders', mobile]` on mount) and persist on success. Replace the bare `<Loading/>` first-load
      branch with a `Shimmer` skeleton list (3–4 `Card`-shaped shimmer rows reusing `Shimmer`) shown
      only when there is no cached data; on `isError` keep showing cached rows if any plus the existing
      "pull down to refresh" line (small retry), never a permanent spinner. Do not change the
      `useAllOrders` 7s poll.
      Files: src/persistCache.ts, app/(tabs)/orders.tsx
      Verify: `npm run typecheck` — no new errors.

- [ ] 6. Cache CMS pages + skeleton in `app/page/[slug].tsx` so Help/Legal open instantly from cache and
      never hang. The `pages` top-key is already in `persistCache.ts` `PERSIST_KEYS`, but `usePage(slug)`
      is a separate `['page', slug]` query. Add a per-slug cache helper in `src/persistCache.ts`
      (``4astore:page:v1:${slug}``) `loadPageCache(slug)` / `savePageCache(slug, page)`, OR seed
      `['page', slug]` from the already-persisted `['pages']` list when present (prefer this: look up the
      slug in the `pages` cache and use it as `initialData`/placeholder). In `[slug].tsx` show a
      `Shimmer` block layout instead of the bare `<Loading/>` only on true first load (no cached
      content), render cached content immediately when present, and on `isError` show cached content if
      any else the existing friendly `EmptyState`. Persist the fetched page on success.
      Files: src/persistCache.ts, app/page/[slug].tsx
      Verify: `npm run typecheck` — no new errors.

- [ ] 7. Make the staff order status change optimistic in `app/admin/order/[id].tsx` so the status
      buttons never hang (this is the real "staff delete loader" surface — see discrepancies note). In
      `setStatus(status)`: optimistically update the React Query caches BEFORE the network — set
      `['order', o.order_id]` to `{...o, order_status: status}` and update the matching row in
      `['all-orders']` — clear `saving` quickly; call `api.post('/admin/orders/status', …)` in the
      background; on success invalidate as today; on failure roll back both caches to the previous
      values and show the existing error toast. Keep the Bearer/auth path and all copy unchanged. Add a
      short comment explaining the staff-delete→status-change mapping.
      Files: app/admin/order/[id].tsx
      Verify: `npm run typecheck` — no new errors.

- [ ] 8. Audit + harden the 401/refresh/session path in `src/api.ts` and `src/store/auth.ts` WITHOUT
      weakening security (keep Bearer, keep the refresh token in SecureStore, keep `X-Client: mobile`).
      Confirm and, where missing, guarantee: (a) a 401 on a non-auth call triggers exactly ONE silent
      `refreshSession()` + retry (the `_retried` flag already enforces this — add a test-read comment,
      change only if a path can loop); (b) `refreshSession()` on its own 401/404 clears the refresh
      token and returns null and is NOT retried (the `isAuthCall` guard covers `/users/refresh`, and the
      single-flight `refreshing` promise prevents a storm — verify, do not duplicate); (c) when a
      refresh fails for a request, the caller gets a thrown `ApiError`, NOT an unresolved promise, so no
      screen spins forever. If, and only if, you find a genuine infinite-loader path (e.g. a query with
      no error branch), add a bounded outcome at the call site (the per-screen error/empty/retry
      branches from items 5–7 already cover the targeted screens). Do NOT add a `setOnSessionExpired`
      hook that the code never defines — if auto-logout-to-login on hard refresh failure is wanted,
      wire it minimally through the existing `useAuth.logout` + router, and only if a real gap exists;
      otherwise document that the existing OfflineGate + per-screen error branches already bound every
      targeted screen.
      Files: src/api.ts, src/store/auth.ts (comments/guards only; no behavior change unless a real
      loop/hang is found)
      Verify: `npm run typecheck` — no new errors; read-through confirms the 401 path cannot loop and
      every targeted screen has data | empty | error-retry (never an unresolved spinner).

- [ ] 9. Final integration pass: run the full typecheck once more and read the checkout → save →
      proceed → pay flow end to end to confirm the Save button and Proceed button are both free of
      network-blocked spinners, My Orders / CMS pages / admin status all resolve to a bounded state, and
      nothing in `app/track/*`, `app/rider.tsx`, or the server contract was touched.
      Files: (none — verification only)
      Verify: `npm run typecheck` — only the known `app.config.ts` `usesCleartextTraffic` error remains.
