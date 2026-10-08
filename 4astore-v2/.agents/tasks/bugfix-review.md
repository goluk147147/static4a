# Idempotent order recovery, honest admin status errors, shared keyboard avoidance

Three fixes land across the mobile client and the Node API, each targeting the behavioral root cause the audit identified rather than the surface symptom. BUG 1 makes mobile order placement survive a slow-but-successful create: the client now generates the `orderId` up front, raises only the `/orders` POST timeout to 30 s, and on a timeout does a bounded GET recovery that treats a found order as success. BUG 2 stops the admin status route from masking real DB failures as a false 404 and defers the tracking write off the response path (same treatment on the rider `tracking.ts` path). BUG 4 adds keyboard avoidance once in the shared `Screen` so every form built on it lifts low fields above the keyboard. BUG 3 (Google OAuth console config) and BUG 5 (banner deploy/data restoration) were correctly left untouched — both are out of code scope per the audit.

Watch for: nothing blocking. One behavioral nuance worth knowing (confirmed): the server's UTR-uniqueness 409 check runs before the idempotent upsert, so the client's timeout-recovery GET is what prevents a manual retry from hitting 409 — the recovery path is load-bearing, not just a nicety. The coder's verification evidence (build, prisma validate, typecheck, 27 tests) is present and green; per instructions the suites were not re-run.

**Verdict**: APPROVED

## High-level view

BUG 1's recovery hinges on three pieces lining up, and they do: the client generates `'4A' + 8 uppercase hex` (10 chars, alphanumeric), the server honors a supplied `o.orderId` and upserts on it, and the `GET /orders/:orderId` recovery route accepts that id against its `^[A-Za-z0-9_-]{1,20}$` guard. A create that succeeded server-side but timed out on the wire is recovered as success instead of surfacing a false "server slow" error. The 30 s timeout is scoped to the order POST only — every other request keeps 15 s — via an optional `timeoutMs` plumbed through `api.post`. The fast-success path is unchanged; the screenshot upload stays fire-and-forget.

BUG 2 replaces the `.catch(() => null)` + blanket 404 with a try/catch that returns 404 only on Prisma `P2025` (genuinely missing order) and surfaces any other DB/connection error as a 500 with the real message. The tracking raw-SQL `UPDATE` becomes fire-and-forget, matching the customer push already on the next line, so the status response no longer blocks on it. The route path, verb, payload shape, and auth guard (`requireAuth` + `requireStaff('orders')`) are untouched. The rider path in `tracking.ts` gets the same treatment: the order update moves ahead of the tracking write, and the tracking write is deferred with `.catch(() => null)`.

BUG 4 wraps the shared `Screen` ScrollView in a `KeyboardAvoidingView` with `behavior='padding'` on iOS and `undefined` elsewhere, keeping `keyboardShouldPersistTaps='handled'`. The two screens that already own their keyboard handling — `checkout.tsx`'s address Modal and `login.tsx` — are not in the diff and are unaffected.

<details>
<summary>Issues (1)</summary>

1. **UTR 409 precedes idempotent upsert** (informational, not blocking) — on the create path the `payment_reference` uniqueness check returns 409 before the `order_id` upsert runs, so idempotency on a *manual* retry depends entirely on the client's timeout-recovery GET catching the already-created order first. The recovery path is correct and covers this; no change needed, but anyone touching the recovery logic later should preserve the GET-before-retry ordering.

</details>

<details>
<summary>Details</summary>

### Client-generated orderId and the recovery contract

The fix makes placement idempotent by moving `orderId` generation to the client (`'4A' + genHex8()`, confirmed) and sending it as `order.orderId`. The server already honored this: `const orderId = o.orderId || '4A' + crypto.randomBytes(4)...` (orders.ts, confirmed), and the write is an `upsert` keyed on `order_id`. So a resend of the same payload is an upsert, not a duplicate row.

The recovery itself is bounded and precise (confirmed): on `ApiError.status === 0` only, a single `GET /orders/<clientOrderId>` runs; a returned `order.order_id` routes through the same `navigateToSuccess()` the fast path uses, and any failure (including a 404 for an order that genuinely never landed) falls through to the existing timeout/retry message. The id shape passes the server's `SAFE_ORDER_ID` guard (`^[A-Za-z0-9_-]{1,20}$`), so recovery reaches the lookup rather than bouncing on a 422.

```
POST /orders (30s)
   ├─ resolves ──────────────► navigateToSuccess(order_id)
   └─ ApiError.status === 0
          └─ GET /orders/<clientOrderId>
                 ├─ order found ─► navigateToSuccess(order_id)   // was created, wire timed out
                 └─ 404 / error ─► timeout/retry message         // never created
```

The one asymmetry worth recording (confirmed): the create handler runs the UTR dedupe `findUnique` → 409 *before* the upsert. If the first attempt created the row and the user manually retried with the same UTR, the server would answer 409, not re-upsert. The client recovery is what defuses this — it catches the created order on the timeout and never reaches a manual retry. The behavior is correct as shipped; the dependency is just non-obvious, so preserve the recovery-GET ordering if this code is revisited.

### Timeout scoping stays surgical

`timeoutMs` is an optional field on `RequestOpts` defaulting to 15 s, threaded through the `AbortController` and exposed on `api.post`'s third arg (confirmed). Only the `/orders` call passes `{ timeoutMs: 30000 }`; every other request — including the recovery GET and the screenshot POST — keeps the 15 s abort. The "never auto-retry writes (POST)" rule is untouched, so the longer window does not reintroduce duplicate-write risk; duplicates are instead prevented by the orderId upsert.

### Admin status: 404 only when truly missing

The behavioral change is the error taxonomy (confirmed). Before, every `.update()` rejection collapsed to `null` and reported "Order not found" (404). Now a `P2025` returns 404 (genuinely missing) and anything else returns `500` with `Status update failed: <message>`, so a pool timeout or connection drop reads as a real server error instead of a phantom missing order. The route surface — `POST /orders/status`, `{ orderId, status }`, `requireAuth` + `requireStaff('orders')`, the `delivered_at` set on "Delivered" — is unchanged.

The tracking `UPDATE` dropped its `await` and gained `.catch(() => null)`, so it no longer holds the status response open; the customer push on the next line was already fire-and-forget, so the response now returns right after the `orders` write. The rider path in `tracking.ts` mirrors this: the order `update` is reordered ahead of the tracking write, and the tracking write is deferred with the same `.catch(() => null)`. Both deferred writes swallow their errors silently — acceptable for a best-effort tracking mirror, and consistent with the push, though it does mean a persistently failing tracking table would drift from `orders` without any signal. Not in scope to fix here and consistent with the audit's recommendation.

### Shared Screen keyboard avoidance

The ScrollView is now nested in a `KeyboardAvoidingView` (`behavior={Platform.OS === 'ios' ? 'padding' : undefined}`, `keyboardShouldPersistTaps` retained), lifting low fields on every `Screen`-based form at the source rather than per-screen (confirmed). `checkout.tsx` and `login.tsx` carry their own keyboard handling and are absent from the diff, so neither is regressed — matching the audit's constraint.

### Scope: BUG 3 and BUG 5 untouched

The diff touches exactly five source files (`api-node/src/routes/admin.ts`, `tracking.ts`, `mobile/app/checkout.tsx`, `mobile/src/api.ts`, `mobile/src/components/ui.tsx`) plus the verification doc. None of the Google-OAuth surfaces (`login.tsx`, `Login.tsx`, `users.ts` social-login) or banner surfaces (`index.tsx`, `Home.tsx`, `absoluteUrl`, deploy script) appear. BUG 3 and BUG 5 are confirmed not touched, consistent with their config/deploy nature.

### Verification evidence

The coder's `bugfix-verification.md` records: api-node `npm run build` (tsc) exit 0, `prisma validate` passing, mobile `npm run typecheck` exit 0, and `npm run test` 27 passed / 0 failed. Per task instructions these suites were not re-run. Not tested: there is no automated coverage asserting the timeout-recovery branch (the GET-on-status-0 path) or the new 500-vs-404 split in the admin route — these are behavioral paths validated by reading, not by a test. Worth adding later but not a blocker for this fix.

</details>

<details>
<summary>File map</summary>

- `api-node/src/routes/admin.ts` — status update: P2025→404, other errors→500 w/ message; tracking write deferred.
- `api-node/src/routes/tracking.ts` — rider path: order update reordered ahead of a now fire-and-forget tracking write.
- `mobile/app/checkout.tsx` — client-generated orderId, 30 s order POST, timeout-recovery GET, shared `navigateToSuccess`.
- `mobile/src/api.ts` — optional per-request `timeoutMs` (default 15 s), forwarded by `api.post`.
- `mobile/src/components/ui.tsx` — shared `Screen` ScrollView wrapped in `KeyboardAvoidingView`.
- `.agents/tasks/bugfix-verification.md` — coder's build/test evidence.

Full diff: `git diff 38d825b2 HEAD`

</details>
