# Implementation Plan — OTP email delivery honesty + admin manual-set escape hatch (Option B)

URGENT production blocker. Google sign-in users have `mobile = NULL` and must verify a real
mobile via an EMAIL OTP before checkout (`orders.ts` gate at line 178:
`if (!me || !isRealMobile(me.mobile)) return fail(res, 'Add and verify your mobile number before placing an order.', 403)`).
Outbound SMTP is NOT delivering on production, but every OTP SEND endpoint returns a 200
`'Code sent'` anyway, so the user never gets a code and is stuck.

Scope: make mail-delivery failures HONEST at the user-facing SEND endpoints, feed the real
delivery result into `otpDelivery.ts`'s existing `delivered` flag, confirm the admin manual
mobile-set path, and surface the honest error in the web UI. Do NOT weaken the OTP verify
step, the checkout gate, or enumeration-safety. No schema change.

Work in-place in `c:\xampp\htdocs\static4a\4astore-v2`. Build/test commands (verified in
`api-node/package.json`):
- API build: `npm run build` (tsc) in `api-node`
- API tests: `npm test` in `api-node` → `node --import ./src/__tests__/register.mjs --test "src/__tests__/**/*.test.ts"` (Node 24, custom TS ESM loader, node:test + node:assert/strict, pure-import style — NO DB, NO live network)
- Web build: `npm run build` (tsc + vite) in `web`

---

## Design decisions (made here, grounded in the code)

- **Return type of `sendMail`:** return a small result object `{ ok: boolean; reason?: string }`,
  not a bare boolean. Rationale: callers only need `.ok` for the honesty branch, and `reason`
  gives server logs a cause without ever reaching the client. `sendMail` NEVER throws. All four
  current callers ignore the return value and three wrap it in `.catch(() => null)`; a returned
  object is backward-compatible (the `.catch` becomes dead but still type-checks because the
  function still returns a Promise). We will remove the now-pointless `.catch(() => null)` at the
  callers we touch, and confirm `tsc` stays green.
- **Failure status for auth-gated SEND endpoints:** HTTP **503** (Service Unavailable) with a
  clear message. Rationale: 503 reads as "mail service temporarily down, try again", which matches
  the transient SMTP outage. MUST NOT be 401/403 — `web/src/lib/api.ts` axios interceptor silently
  refreshes the token and REPLAYS the request on 401 OR 403, which would mask the error and
  double-send. 502/503 are outside that retry path (verified in `api.ts` interceptor).
- **Testability of `sendMail`:** the repo's node:test harness only imports pure modules (no DB,
  no real sockets). To test the three branches (not configured → false; transport throws → false;
  transport resolves → true) WITHOUT opening a real SMTP socket or adding a mocking dependency, we
  refactor `sendMail` to delegate the actual send to an **injectable** inner function and export a
  pure helper `deliverWith(transport, msg)` that the test drives with a fake transport object. This
  matches the repo's "import a pure function" convention (e.g. `posLoginDecision`, `otpChannelPolicy`).
- **No schema change:** CONFIRMED. Every change is to return values, HTTP status, and UI text. The
  `email_otps` rows are still created exactly as today; `mobile/verify` is unchanged. Deploy is
  `tsc + vite + pm2` with `prisma generate` only — nothing here needs a migration.

---

## sendMail caller audit (grep `sendMail(` across api-node/src — 4 call sites, all enumerated)

1. `api-node/src/utils/mailer.ts:27` — the definition's internal `t.sendMail(...)`. CHANGED (see item 1).
2. `api-node/src/routes/users.ts:312` — forgot-password/send, wrapped `.catch(() => null)`. Kept
   enumeration-safe; see item 4 (response shape UNCHANGED).
3. `api-node/src/routes/users.ts:390` — recovery-email/send (requireAuth), wrapped `.catch(() => null)`.
   CHANGED to honest 503 on failure (item 3).
4. `api-node/src/routes/users.ts:436` — mobile/send (requireAuth), wrapped `.catch(() => null)`.
   CHANGED to honest 503 on failure (item 2) — this is the live blocker.
5. `api-node/src/services/otpDelivery.ts:149` — signup email branch, wrapped `.catch(() => null)`.
   CHANGED to feed the real `ok` into the existing `delivered` flag (item 5); multi-channel behavior
   otherwise unchanged.

Each site stays backward-compatible: the new return value is simply consumed (or the dead
`.catch` removed) and `tsc` must pass with no `any`/unused errors.

---

## Plan items

- [ ] 1. Refactor `sendMail` to report delivery and never throw.
      In `api-node/src/utils/mailer.ts`: define `export type MailResult = { ok: boolean; reason?: string }`.
      Add a pure, exported, injectable helper
      `export async function deliverWith(send: (msg: MailMessage) => Promise<unknown>, msg: MailMessage): Promise<MailResult>`
      that `await send(msg)` → `{ ok: true }`, and on throw logs the error server-side
      (`console.error('[mail] send failed', ...)`) and returns `{ ok: false, reason: String(err) }`.
      Rewrite `sendMail(to, subject, text, html?)` to: when no transporter (`getTransporter()` null,
      i.e. `MAIL_HOST`/`MAIL_USER` unset) keep the existing dev `console.log` and return
      `{ ok: false, reason: 'not-configured' }`; otherwise call
      `deliverWith((m) => t.sendMail(m), { from: config.mail.from, to, subject, text, html })` and
      return its result. `sendMail` NEVER throws. Keep the signature's positional args so no caller
      breaks. Export a `MailMessage` type for the args object.
      Files: `api-node/src/utils/mailer.ts`
      Verify: `npm run build` in `api-node` exits 0; `npm test` in `api-node` passes (incl. the new
      mailer tests from item 7).

- [ ] 2. Make `POST /users/mobile/send` tell the truth (the live blocker).
      In `api-node/src/routes/users.ts` (~lines 425-439): capture `const sent = await sendMail(...)`
      (drop the `.catch(() => null)` — `sendMail` no longer throws). The OTP row is still created
      first (unchanged). After the send: `if (!sent.ok) return fail(res, "We couldn't send your
      verification code by email right now. Please try again shortly or contact support.", 503);`
      On success keep `return ok(res, { message: 'Code sent', devOtp: config.env !== 'production' ? otp : undefined })`.
      Keep `devOtp` guarded by `config.env !== 'production'` exactly as now. This endpoint is
      `requireAuth`, so it is NOT enumeration-sensitive — the honest 503 is safe.
      Files: `api-node/src/routes/users.ts`
      Verify: `npm run build` in `api-node` exits 0; `npm test` passes (mobile/send mapping test, item 7).

- [ ] 3. Apply the same honesty fix to `POST /users/recovery-email/send`.
      In `api-node/src/routes/users.ts` (~lines 380-392): capture `const sent = await sendMail(...)`
      (drop `.catch(() => null)`). Keep the `alreadyVerified` and `taken`-409 branches unchanged and
      the OTP row creation unchanged. After send: `if (!sent.ok) return fail(res, "We couldn't send
      the verification code by email right now. Please try again shortly or contact support.", 503);`
      else keep the existing 200 `{ message: 'Code sent', devOtp: ... }`. This endpoint is
      `requireAuth` (not enumeration-sensitive), so the honest 503 is appropriate.
      Files: `api-node/src/routes/users.ts`
      Verify: `npm run build` in `api-node` exits 0.

- [ ] 4. Leave `POST /users/forgot-password/send` response shape UNCHANGED (enumeration-safe) — with reason noted in code.
      In `api-node/src/routes/users.ts` (~lines 300-320): this endpoint is deliberately
      enumeration-safe (always returns the generic 200 `RESET_GENERIC` so it never reveals whether an
      account/email exists). A delivery-failure status here cannot be surfaced without leaking that a
      matching account exists (only a real account triggers a send attempt), so the response shape
      stays as-is. Make ONLY the mechanical, non-observable change: capture
      `const sent = await sendMail(...)` and, when `!sent.ok`, `console.warn('[forgot-password] mail
      send failed (not surfaced to keep enumeration-safety)')` for ops visibility. The HTTP response
      is byte-for-byte identical to today (still generic 200). Add a one-line code comment stating why
      it stays unchanged.
      Files: `api-node/src/routes/users.ts`
      Verify: `npm run build` in `api-node` exits 0; forgot-password still returns generic 200 in all
      cases (no response-shape change — nothing to assert differently).

- [ ] 5. Feed the real send result into `otpDelivery.ts`'s existing `delivered` flag (email branch only).
      In `api-node/src/services/otpDelivery.ts` (~lines 145-158, the `if (email)` branch): change
      `await sendMail(...).catch(() => null)` to `const sent = await sendMail(...)` and return
      `{ otpKey, delivered: sent.ok, channel: sent.ok ? 'email' : null, fallbackOtp }`. Keep
      `fallbackOtp = process.env.NODE_ENV !== 'production' ? otp : undefined` UNCHANGED (still only
      off-production for the email path — do NOT leak the OTP in production). Do NOT touch the
      WhatsApp/FCM mobile path or the mobile-path production `fallbackOtp` security tradeoff. Update
      the stale comment that claims the email send "never reports delivery".
      Files: `api-node/src/services/otpDelivery.ts`
      Verify: `npm run build` in `api-node` exits 0.

- [ ] 6. Confirm the admin manual-set mobile escape hatch already works; no backend change needed.
      Confirmed by reading `api-node/src/routes/admin.ts` `POST /users` action `'updateUser'`
      (line 696 — NOTE: the task referenced action `'edit'` ~line 697; the actual action name in this
      codebase is `'updateUser'` at line 696, same handler). It takes `id`, validates `mobileRe`
      (`/^[6-9]\d{9}$/`), blocks STAFF targets (403), runs a uniqueness pre-check
      `clash = findFirst({ id: { not }, OR: [{ mobile }, { username }] })` → 409 'Mobile or username
      already used', then `prisma.user.update({ data: { name, mobile, username, role, ... } })`. A
      NULL-mobile `role=customer` Google user is a valid non-staff target, so this path CAN set its
      previously-NULL mobile to a real 10-digit number and enforces both the real-mobile regex and the
      duplicate check. Setting the mobile this way clears the checkout gate immediately (the gate reads
      `me.mobile` live). CONCLUSION: do NOT add a new endpoint. This item is a confirmation only — no
      code change in admin.ts.
      Files: none (confirmation).
      Verify: re-read `admin.ts` lines 696-717 and confirm the three properties above hold.

- [ ] 7. Add focused tests for the mailer and the mobile/send status mapping (repo node:test style).
      Create `api-node/src/__tests__/mailer.test.ts` using `import { test } from 'node:test'` +
      `import assert from 'node:assert/strict'`, importing `{ deliverWith }` (and the `MailResult`
      type) from `../utils/mailer`. Cover, via a fake transport passed to `deliverWith` (no real
      nodemailer, no socket):
        - transport resolves → `{ ok: true }` (true when it accepts the message);
        - transport throws → `{ ok: false }` with a `reason` (never throws out);
      and assert the not-configured branch returns `{ ok: false }` by driving `deliverWith` with a
      send fn that rejects (documents the "not configured = not delivered" contract; the real
      not-configured path in `sendMail` returns the same shape). Add a second file
      `api-node/src/__tests__/mobileSendHonesty.test.ts` that pins the SEND-endpoint contract WITHOUT
      a DB by reading `routes/users.ts` source (same source-assertion technique as
      `posBilling.test.ts`): assert the `/mobile/send` handler returns status `503` with the
      support-contact message when `!sent.ok`, returns 200 `'Code sent'` on success, and still guards
      `devOtp` behind `config.env !== 'production'`. Keep tests dependency-free so they run under the
      existing loader.
      Files: `api-node/src/__tests__/mailer.test.ts`, `api-node/src/__tests__/mobileSendHonesty.test.ts`
      Verify: `npm test` in `api-node` — all tests pass, including the new ones.

- [ ] 8. Surface the honest delivery-failure message in the storefront AddMobilePrompt.
      In `web/src/components/AddMobilePrompt.tsx` `sendCode()`: it already only sets `setSent(true)`
      AFTER `await api.post('/users/mobile/send')` resolves, so a 503 now correctly throws into the
      `catch` and the UI STAYS on the "send" step (does not advance to "enter code"). Improve the
      catch to show the server's message when present with a bilingual fallback:
      `setStatus({ text: apiError(e) || 'Code bhej nahi paaye — thodi der baad try karein ya support se sampark karein. / Could not send the code. Please try again shortly or contact support.', color: '#b42318' })`.
      `apiError` already returns `response.data.message` (verified in `web/src/lib/api.ts`), so the
      503 message text from the server is surfaced. Keep the success path (`setSent(true)`, devOtp
      autofill off-production, success status) UNCHANGED.
      Files: `web/src/components/AddMobilePrompt.tsx`
      Verify: `npm run build` in `web` exits 0.

- [ ] 9. Confirm the admin Users edit modal exposes an editable mobile field for a null-mobile ('—') row.
      Confirmed by reading `web/src/pages/admin/AdminUsers.tsx` `EditUserModal` (~line 49): it
      initializes `mobile: user.mobile || ''` and renders
      `<label>Mobile<input ... value={f.mobile} onChange=... /></label>`, then submits
      `usersAction('updateUser', { id, name, mobile: f.mobile.trim(), username, role, password })`.
      So staff opening the edit modal on a '—' (null-mobile) customer row can type a 10-digit number
      and save it through the item-6 backend path. The delivery-fee cell showing '—' for null mobile
      (DeliveryCell) is a separate, unrelated control and needs no change. CONCLUSION: no web change
      needed for the escape hatch UI — confirmation only.
      Files: none (confirmation).
      Verify: re-read `AdminUsers.tsx` lines 49-91 and confirm the Mobile input is present, editable,
      and submitted via `updateUser`.

---

## Verification summary (whole task)

1. `cd api-node && npm run build` → tsc exits 0 (no caller broke on the new `MailResult` type).
2. `cd api-node && npm test` → all node:test files pass, including `mailer.test.ts` and
   `mobileSendHonesty.test.ts`.
3. `cd web && npm run build` → tsc + vite exit 0.
4. Manual contract check (no live SMTP): with mail unconfigured, `/users/mobile/send` now returns
   503 + support message instead of a false 200; with a working transport it returns 200 'Code sent'.

## Explicit confirmations required by the task

- **No schema change is required.** Every change is to return values, HTTP status codes, and UI
  text. `email_otps` usage and `mobile/verify` are unchanged. Deploy via `deploy.sh`
  (`prisma generate` only, no `prisma migrate`) remains valid.
- **OTP is NOT weakened.** `POST /users/mobile/verify` is untouched; the checkout gate
  (`orders.ts:178`), the admin-403 auth scoping, and the pos-login no-downgrade guard are untouched.
  No auto-verify, no OTP leak in production (dev-only `devOtp`/`fallbackOtp` guards preserved).
- **Enumeration-safety preserved.** `forgot-password/send` keeps its generic-200 response shape
  (item 4); only the auth-gated `mobile/send` and `recovery-email/send` return the honest 503.
- **Admin escape hatch already exists** (items 6 + 9): `admin.ts` action `'updateUser'` (line 696,
  the task's `'edit'`) can set a null-mobile customer's mobile with regex + duplicate checks, and
  the AdminUsers `EditUserModal` already exposes an editable, submitted Mobile field. No new endpoint.

## Notes / assumptions

- The task referenced the admin action as `'edit'` ~line 697; the actual action name is
  `'updateUser'` at `admin.ts:696`. Same handler, same capability — noted so the implementer does
  not add a redundant `'edit'` branch.
- Failure status chosen as **503** (over 502) because the SMTP outage is a transient
  service-unavailable condition; 502/503 both avoid the axios 401/403 refresh-replay path, which is
  the hard requirement. Either is acceptable per the task; 503 is the single chosen value.
