# Bugfix Verification — Order timeout / Admin status / Keyboard

First iteration (no `bugfix-review.json` present). Implemented BUG 1, BUG 2, BUG 4
per the audit (`order-status-google-audit.md`). BUG 3 (Google login — Cloud Console
config) and BUG 5 (banners — deploy/data restoration) are out of code scope and were
NOT touched.

## Changes

### BUG 1 (CRITICAL) — Order placement false timeout
- `mobile/src/api.ts`
  - Added optional per-request `timeoutMs` to `RequestOpts` (default 15 s).
  - `AbortController` now uses `opts.timeoutMs ?? 15000`.
  - `api.post(path, body, opts?)` now forwards `{ timeoutMs }`.
  - The "never auto-retry writes (POST)" rule is unchanged.
- `mobile/app/checkout.tsx` `confirmOrder()`
  - Generates `clientOrderId = '4A' + genHex8()` (8 uppercase hex, matching the
    server's `crypto.randomBytes(4).toString('hex').toUpperCase()`) and sends it as
    `order.orderId` so a retry is an idempotent upsert (no 409).
  - Order POST timeout raised to 30 s (`{ timeoutMs: 30000 }`); all other requests
    stay at 15 s.
  - On `ApiError` with `status === 0` (timeout/abort), does a bounded recovery:
    `GET /orders/<clientOrderId>`. If found → treated as SUCCESS via the shared
    `navigateToSuccess()` path (identical to the normal success path). If not found →
    falls through to the existing timeout/retry message.
  - Screenshot upload stays fire-and-forget. Normal fast path unchanged.

### BUG 2 (CRITICAL) — Admin status update masked as 404 + awaited tracking write
- `api-node/src/routes/admin.ts` (`POST /orders/status`)
  - Replaced `.update(...).catch(() => null)` + blanket 404 with a try/catch: a Prisma
    `P2025` returns 404 (genuinely missing order); any other DB/connection error now
    returns `500` with the real message (`Status update failed: <message>`) instead of
    a false 404.
  - The `UPDATE tracking ...` raw SQL is now fire-and-forget (`.catch(() => null)`, no
    `await`), like the customer push on the next line.
- `api-node/src/routes/tracking.ts` (`POST /status`, rider path)
  - Moved the order `update` ahead of the tracking write and made the
    `UPDATE tracking ...` raw SQL fire-and-forget (`.catch(() => null)`, no `await`).

### BUG 4 (MEDIUM) — Shared Screen keyboard avoidance
- `mobile/src/components/ui.tsx` `Screen`
  - Wrapped the `ScrollView` in a `KeyboardAvoidingView`
    (`behavior={Platform.OS === 'ios' ? 'padding' : undefined}`), kept
    `keyboardShouldPersistTaps="handled"`. Added `KeyboardAvoidingView` + `Platform`
    imports.
  - `checkout.tsx` (own Modal + KAV) and `login.tsx` (own KAV) are untouched and
    unaffected (verified by typecheck + test run below).

## Verification runs

### api-node (from `api-node/`)
- `npm run build` (tsc) → Exit Code 0, no errors.
- `npx prisma validate` → "The schema at prisma\schema.prisma is valid 🚀", Exit Code 0.

### mobile (from `mobile/`)
- `npm run typecheck` (tsc --noEmit) → Exit Code 0, no errors (the known
  usesCleartextTraffic warning did not surface).
- `npm run test` → 27 passed, 0 failed (Exit Code 0).

All acceptance criteria for BUG 1, BUG 2, BUG 4 are satisfied; builds/typecheck/tests
are green.
