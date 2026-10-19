# Verification — OTP email delivery honesty + admin manual-set escape hatch (Option B)

Date: first implementation iteration (no prior review JSON present).
Branch: `main` (in-place, no worktree). Committed locally; NOT pushed.

## What each OTP SEND endpoint returns — failure vs success

| Endpoint | Auth | On delivery SUCCESS | On delivery FAILURE | Notes |
|---|---|---|---|---|
| `POST /api/users/mobile/send` (routes/users.ts) | `requireAuth` | `200 { message: 'Code sent', devOtp: <otp only when env!=='production'> }` | `503` + `"We couldn't send your verification code by email right now. Please try again shortly or contact support."` | The live blocker. Auth-gated → not enumeration-sensitive, so the honest 503 is safe. OTP row still created either way. |
| `POST /api/users/recovery-email/send` (routes/users.ts) | `requireAuth` | `200 { message: 'Code sent', devOtp: <off-prod only> }` | `503` + `"We couldn't send the verification code by email right now. Please try again shortly or contact support."` | Same honest fix. `alreadyVerified`/`taken(409)` branches unchanged. |
| `POST /api/users/forgot-password/send` (routes/users.ts) | public | `200 { message: RESET_GENERIC }` (always) | `200 { message: RESET_GENERIC }` (unchanged) + `console.warn('[forgot-password] mail send failed …')` | **Deliberately enumeration-safe** — only a real account triggers a send, so surfacing a delivery failure would leak existence. Response shape is byte-for-byte unchanged; only an ops-visibility log was added. |
| signup email branch (services/otpDelivery.ts) | n/a (orchestrator) | `delivered: true, channel: 'email'`, `fallbackOtp` only off-production | `delivered: false, channel: null`, `fallbackOtp = otp` (the OTP IS returned, incl. production) | Second live blocker, fixed per orchestrator product decision: a failed SMTP send exposes the OTP as `fallbackOtp` so an email-signup user is NOT stranded while SMTP is down. On a successful send nothing is leaked in production. Mirrors the pre-existing mobile-path "user never stuck" behavior. Multi-channel (WhatsApp/FCM) path untouched. |

## `sendMail` contract (api-node/src/utils/mailer.ts)
- New return type `MailResult = { ok: boolean; reason?: string }`. `sendMail` NEVER throws.
- `{ ok: true }` only when the configured transport accepts the message.
- `{ ok: false, reason: 'not-configured' }` when no host/user (dev `console.log` path).
- `{ ok: false, reason: <error> }` when the transport throws (caught inside, logged `console.error('[mail] send failed', err)`).
- Pure injectable helper `deliverWith(send, msg)` exported for testing without a real SMTP socket.
- Backward compatible at every call site: the previously-pointless `.catch(() => null)` wrappers were removed at the touched callers; `tsc` is clean.

### sendMail caller audit (4 call sites, all accounted for)
1. `utils/mailer.ts` — the definition (internal `t.sendMail`). Changed.
2. `routes/users.ts` forgot-password/send — captured result, log-only (enumeration-safe), response unchanged.
3. `routes/users.ts` recovery-email/send — honest 503 on failure.
4. `routes/users.ts` mobile/send — honest 503 on failure.
5. `services/otpDelivery.ts` email branch — real `ok` feeds `delivered`; failure exposes `fallbackOtp`.

## Admin manual-set mobile escape hatch — CONFIRMED (no backend change)
- `api-node/src/routes/admin.ts` `POST /users` action **`'updateUser'`** at **admin.ts:696** (the task referenced the action as `'edit'` ~line 697; the actual action name in this codebase is `'updateUser'`, same handler). It:
  - validates `mobileRe = /^[6-9]\d{9}$/` (admin.ts:675) → real 10-digit mobile enforced;
  - blocks STAFF targets with `403` (admin.ts: `if (STAFF.includes(target.role)) …`);
  - runs the duplicate pre-check `clash = findFirst({ id: { not }, OR: [{ mobile }, { username }] })` → `409 'Mobile or username already used'`;
  - then `prisma.user.update({ data: { name, mobile, username, role, … } })`.
- A NULL-mobile `role='customer'` Google user is a valid non-staff target, so this path CAN set a previously-NULL mobile to a real 10-digit number with both the regex and the duplicate check enforced. Setting it clears the checkout gate immediately. **No new endpoint added.**
- Web edit modal CONFIRMED: `web/src/pages/admin/AdminUsers.tsx` `EditUserModal` (~line 49) initializes `mobile: user.mobile || ''` (a '—'/null row starts empty), renders an editable `<label>Mobile<input …/></label>`, and submits `usersAction('updateUser', { id, name, mobile: f.mobile.trim(), username, role, password })`. No web change needed for the escape hatch.

## Web storefront honesty (web/src/components/AddMobilePrompt.tsx)
- `sendCode()` already sets `setSent(true)` ONLY after `await api.post('/users/mobile/send')` resolves, so a 503 now throws into the `catch` and the UI STAYS on the "send" step (does not advance to "enter code").
- The catch now surfaces the server's message (`apiError(e)` returns `response.data.message`) with a bilingual fallback: `'Code bhej nahi paaye — thodi der baad try karein ya support se sampark karein. / Could not send the code. Please try again shortly or contact support.'`
- Success path unchanged (`setSent(true)`, off-production `devOtp` autofill, success status).

## Files changed
- `api-node/src/utils/mailer.ts` — `MailResult`, `MailMessage`, `deliverWith`, honest `sendMail`.
- `api-node/src/routes/users.ts` — honest 503 on mobile/send + recovery-email/send; log-only forgot-password.
- `api-node/src/services/otpDelivery.ts` — real `ok` → `delivered`; failed-send `fallbackOtp` (orchestrator edit folded in); stale comments updated.
- `web/src/components/AddMobilePrompt.tsx` — honest send-failure message, stays on send step.
- `api-node/src/__tests__/mailer.test.ts` — NEW. `deliverWith` resolves/throws/rejects contract.
- `api-node/src/__tests__/mobileSendHonesty.test.ts` — NEW. SEND-endpoint 503/200 + enumeration-safety source contract.
- `api-node/src/__tests__/signupEmailFallback.test.ts` — NEW. signup email-branch `fallbackOtp` matrix.
- `.agents/tasks/otp-honesty-plan.md`, `.agents/tasks/otp-honesty-verification.md` — task artifacts.

## No schema change
CONFIRMED. Every change is to return values, HTTP status codes, and UI text. `email_otps` usage and `POST /users/mobile/verify` are unchanged. Deploy via `deploy.sh` (`prisma generate` only, NO `prisma migrate`) remains valid.

## Prisma client note (environment artifact)
On this machine the Prisma client was stale (model `mobile` nullable but `UserCreateInput.mobile` still required), causing a pre-existing `users.ts:183 mobile:null` tsc error unrelated to this change. `prisma generate` failed first because of stale engine-download env paths; it was re-run OFFLINE against the already-present local engines:
```
PRISMA_QUERY_ENGINE_LIBRARY=<api-node>/node_modules/@prisma/engines/query_engine-windows.dll.node
PRISMA_SCHEMA_ENGINE_BINARY=<api-node>/node_modules/@prisma/engines/schema-engine-windows.exe
PRISMA_CLI_QUERY_ENGINE_TYPE=library
npx prisma generate   # ✔ Generated Prisma Client (v5.22.0)
```
Production regenerates the client normally on deploy (`deploy.sh` runs `prisma generate`).

## Commands run + results
- `cd api-node && npx tsc -p tsconfig.json --noEmit` → **EXIT 0** (clean, after client regenerate).
- `cd api-node && npm test` → **125 pass / 0 fail** (incl. the 3 new focused tests + existing auth/order/otp tests). The two `[mail] send failed` lines in output are the intentional server-side logs emitted by `deliverWith` under the throw/reject tests, not failures.
- `cd web && ./node_modules/.bin/tsc -b` → **EXIT 0** (local binary, per task; `npx tsc` avoided).
- `cd web && npm run build` → **EXIT 0** (tsc + vite build clean).
- `git checkout -- web/public/sitemap.xml` → restored the build-regenerated sitemap so the git tree is clean.

## Explicit confirmations
- OTP is NOT weakened: `POST /users/mobile/verify` untouched; the checkout gate (`orders.ts`), the admin-403 auth scoping, and the pos-login no-downgrade guard are untouched. No auto-verify.
- No OTP leak in production for the EMAIL success path or the mobile-set/recovery `devOtp` (all still guarded by `config.env !== 'production'`). The signup email **failed-send** `fallbackOtp` is an explicit orchestrator product decision (user-never-stuck) mirroring the existing mobile path.
- Enumeration-safety preserved: forgot-password/send keeps its generic-200 shape; only the auth-gated mobile/send and recovery-email/send return the honest 503.

## Separate ops step (not covered by this change)
Fixing the real SMTP creds in `api-node/.env` (Gmail app-password / relay) is a SEPARATE ops task. This change only makes the delivery FAILURE visible (honest 503 + UI message), feeds the real result into the signup `delivered` flag, and confirms the admin escape hatch. It does not itself make email deliver.
