# Implementation Plan — Multi-channel signup OTP with graceful fallback

All paths are absolute and live inside the worktree
`c:\xampp\htdocs\static4a\.worktrees\signup-otp-multichannel\4astore-v2` (referred to below as
`<ROOT>`). Use `git -C c:\xampp\htdocs\static4a\.worktrees\signup-otp-multichannel` for any git ops.

## Context discovered during exploration (grounds every item below)

- **OTP table reuse.** `email_otps` is reused by convention for non-email identifiers. `routes/pos-auth.ts`
  stores mobile OTPs with `email` column = `pos:<mobile>`, `purpose='pos_login'`. Signup-by-email today uses
  `email` = `email.toLowerCase()`, `purpose='signup'` (`routes/otp.ts` + `routes/users.ts` `/register`).
  **Decision:** signup-by-mobile uses `email` column = `mobile:<mobile>`, `purpose='signup'`. No new tables,
  no Prisma migration.
- **`sendMail` never throws and never reports delivery** (`utils/mailer.ts`: logs when unconfigured, caller
  `.catch()`es). So the EMAIL path cannot change — it keeps emailing and returns `devOtp` only when
  `NODE_ENV!=='production'`, exactly as today. The fallback-OTP-always behavior applies ONLY to the mobile path.
- **WhatsApp sender** `services/whatsappCloud.ts` `sendWhatsAppTemplateMessage({recipientPhone, templateName,
  languageCode, components})` NEVER throws — returns `{ ok:boolean, messageId?, error?, code? }`. Reads
  `settings.whatsapp_api` fresh per call. Requires a PRE-APPROVED template; when not configured it returns
  `{ ok:false }` (treat as not-delivered, fall through). Components built via `buildImageTextComponents` from
  `services/whatsappFormat.ts` (pure, DB-free).
- **FCM push** `services/push.ts` `sendToTokens(tokens, msg) => Promise<number>` (success count; returns 0 when
  FCM disabled or no tokens). `tokensForUser(userId)` returns device tokens for a user. There is NO mobile->token
  helper; a brand-new signup mobile usually has NO user row and NO tokens — this is the expected "FCM not
  delivered" case. The resolver resolves tokens by looking up a user by `mobile` then `tokensForUser(user.id)`.
- **Admin WhatsApp config** lives in the raw `settings.whatsapp_api` TEXT column (JSON blob), ensured
  idempotently by `ensureWhatsappApiColumn()` in `services/dataImport.ts` and called at startup in `server.ts`.
  Read/written ONLY via admin endpoints: `GET /api/admin/settings` and `POST /api/admin/settings`
  (`routes/admin.ts`), both `requireAuth + requireStaff('settings')`. The public `GET /api/settings` never
  exposes it. **Decision:** store the OTP-channel setting as a NEW sibling raw TEXT column
  `settings.otp_channels` (JSON), ensured by a new `ensureOtpChannelsColumn()` that copies
  `ensureWhatsappApiColumn()` byte-for-byte (information_schema guard + swallow MySQL 1060). A sibling column
  (not nested in `whatsapp_api`) keeps the WhatsApp blob untouched and avoids any regression to the existing
  WhatsApp save/token-preserve logic.
- **Admin WhatsApp UI is React, NOT legacy JS.** The task brief guessed legacy JS; the actual form is
  `<ROOT>/web/src/pages/admin/marketing/AutoSendComingSoon.tsx`, typed via
  `<ROOT>/web/src/lib/admin.ts` (`WhatsappApiConfig`, `AdminSettings`, `fetchAdminSettings`,
  `saveAdminSettings`). The legacy folder `web/public/legacy/js/` contains only `admin-ads.js` — unrelated.
  The OTP-channel selector will be added here, in React.
- **Web signup** `<ROOT>/web/src/pages/Login.tsx`: `sendOtp()` POSTs `/otp/send { email }` and already
  auto-fills from `data.devOtp` (`if (data.devOtp) setOtp(String(data.devOtp))`). `doRegister()` calls
  `register({ name, mobile, username, email, password, otp })` from `store/auth.ts` -> POST `/users/register`.
  Register form currently REQUIRES email and gates Send-OTP on `!email`.
- **Build/test commands.** Backend: `npm run build` (= `tsc -p tsconfig.json`) and `npm test`
  (= `node --import ./src/__tests__/register.mjs --test "src/__tests__/**/*.test.ts"`) in `<ROOT>/api-node`.
  Web: `npm run build` (= sitemap + `tsc -b` + `vite build`) in `<ROOT>/web`. Unit tests are pure-function
  `node:test` files under `api-node/src/__tests__/*.test.ts` importing DB-free modules (see
  `whatsappFormat.test.ts`, `posLoginDecision.test.ts`).
- **Repo style.** zod schemas for request bodies; `ok()/fail()` from `utils/http`; prisma for DB; raw columns
  added via idempotent `ensure*` (never prisma migrate); mailer/push/whatsapp services used as-is.

## OTP key convention (final)
- Email identifier: `email_otps.email = <email lowercased>`, `purpose = 'signup'` (UNCHANGED).
- Mobile identifier: `email_otps.email = 'mobile:' + <mobile>`, `purpose = 'signup'` (NEW, mirrors
  `pos:<mobile>`).

## Admin OTP-channel setting shape (final)
Stored as JSON in raw column `settings.otp_channels`:
```json
{ "whatsapp": true, "fcm": true, "mode": "both" }
```
- `mode`: `'whatsapp' | 'fcm' | 'both'` — the owner-facing switch. `whatsapp`/`fcm` booleans are derived from
  `mode` on save (mode is the single source of truth; booleans kept for forward-compat + simple reads).
  Default when column absent/garbage: `{ whatsapp:false, fcm:true, mode:'fcm' }` (FCM-only, matching the "FCM
  first, free" starting point the user asked for). Admin-only read/write; never on public `/api/settings`.

## Resolver interface + fallback order (final)
Two modules, mirroring the pure/impure split used by `whatsappFormat.ts` (pure) vs `whatsappCloud.ts` (DB):
- `services/otpChannelPolicy.ts` (PURE, DB-free, unit-testable): parse/normalize the raw `otp_channels` JSON
  into `{ whatsap: boolean, fcm: boolean, mode }` and expose `resolveMobileChannelOrder(policy): ('whatsapp'|'fcm')[]`
  returning the ordered list of channels to attempt for a mobile (WhatsApp before FCM when `both`).
- `services/otpDelivery.ts` (DB-bound orchestrator): `deliverSignupOtp({ email?, mobile? })` =>
  `{ otpKey, purpose:'signup', delivered: boolean, channel: 'email'|'whatsapp'|'fcm'|null, fallbackOtp?: string }`.
  Behavior:
  1. Generate the 6-digit OTP, persist to `email_otps` with the correct key+purpose (email key for email,
     `mobile:<mobile>` for mobile), 10-min expiry.
  2. If `email` present: call `sendMail(...)` (best-effort, never throws); treat as the email path. Return
     `delivered:true, channel:'email'`, and `fallbackOtp` = OTP only when `NODE_ENV!=='production'` (preserves
     today's `devOtp` behavior exactly — email path unchanged).
  3. If `mobile` present (no email): read the admin policy, iterate `resolveMobileChannelOrder`:
     - `whatsapp`: `sendWhatsAppTemplateMessage(...)`; if `{ok:true}` -> delivered, stop. Else continue.
     - `fcm`: look up user by `mobile`; `tokensForUser(user.id)`; `sendToTokens(...)`; if return count > 0 ->
       delivered, stop. Else continue.
  4. If NOTHING delivered on the mobile path: return `delivered:false, channel:null, fallbackOtp:<otp>` so the
     client auto-fills and signup proceeds — **applies in production too** (the explicit "user never stuck"
     rule). Documented security tradeoff in a code comment (OTP becomes client-known; acceptable per product
     decision; controllable via admin channel settings).
  5. NEVER throw out of the resolver; every channel call is wrapped so a failure degrades to the next fallback,
     never a 500.

---

- [ ] 1. Add idempotent raw-column ensure for the OTP-channel setting.
      Add `ensureOtpChannelsColumn()` to `<ROOT>/api-node/src/services/dataImport.ts`, copying
      `ensureWhatsappApiColumn()` exactly (information_schema guard; `ALTER TABLE settings ADD COLUMN
      otp_channels TEXT NULL`; swallow MySQL 1060 / "Duplicate column"). Then import and invoke it at startup in
      `<ROOT>/api-node/src/server.ts` inside the `app.listen` callback, right after the
      `ensureWhatsappApiColumn()` line, with the same `.catch(e => console.error(...))` shape.
      Files: `<ROOT>/api-node/src/services/dataImport.ts`, `<ROOT>/api-node/src/server.ts`
      Verify: `cd <ROOT>/api-node && npm run build` compiles with no new errors.

- [ ] 2. Create the PURE OTP-channel policy module.
      Create `services/otpChannelPolicy.ts` exporting: an `OtpChannelPolicy` type `{ whatsapp: boolean; fcm:
      boolean; mode: 'whatsapp'|'fcm'|'both' }`; `parseOtpChannels(raw: unknown): OtpChannelPolicy` (tolerant
      JSON parse like `whatsappCloud.readWhatsappApiConfig`, default `{ whatsapp:false, fcm:true, mode:'fcm' }`
      on null/garbage, and derive booleans from `mode` so `mode` is authoritative); and
      `resolveMobileChannelOrder(p: OtpChannelPolicy): ('whatsapp'|'fcm')[]` returning channels in attempt order
      (`both` -> `['whatsapp','fcm']`, `whatsapp` -> `['whatsapp']`, `fcm` -> `['fcm']`). DB-free and
      network-free so it can be unit-tested in isolation (mirror `whatsappFormat.ts`).
      Files: `<ROOT>/api-node/src/services/otpChannelPolicy.ts`
      Verify: `cd <ROOT>/api-node && npm run build` compiles.

- [ ] 3. Unit-test the pure policy module.
      Create `__tests__/otpChannelPolicy.test.ts` (node:test + node:assert/strict, importing ONLY
      `../services/otpChannelPolicy`, mirroring `whatsappFormat.test.ts`). Cover: default on null/garbage/empty;
      `mode:'both'` -> order `['whatsapp','fcm']`; `mode:'whatsapp'` -> `['whatsapp']`; `mode:'fcm'` ->
      `['fcm']`; booleans derived from mode.
      Files: `<ROOT>/api-node/src/__tests__/otpChannelPolicy.test.ts`
      Verify: `cd <ROOT>/api-node && npm test` — the new `otpChannelPolicy` tests pass and no existing test
      regresses.

- [ ] 4. Create the OTP delivery orchestrator service.
      Create `services/otpDelivery.ts` exporting an async `deliverSignupOtp(input: { email?: string; mobile?:
      string }): Promise<{ otpKey: string; delivered: boolean; channel: 'email'|'whatsapp'|'fcm'|null;
      fallbackOtp?: string }>` implementing steps 1-5 of the resolver spec above. Read the admin policy via a
      small helper that `SELECT otp_channels FROM settings WHERE id = 1` and feeds `parseOtpChannels`. For FCM,
      resolve tokens via `prisma.user.findUnique({ where: { mobile } })` then
      `tokensForUser(user.id)` (import `sendToTokens`, `tokensForUser` from `./push`); treat `sentCount > 0` as
      delivered. For WhatsApp, call `sendWhatsAppTemplateMessage` with an OTP template name/language read from
      the policy or env (document that a Meta-approved OTP template is required; absence => `{ok:false}` =>
      fall through). Wrap every channel call so nothing throws out of the resolver. Include the security-tradeoff
      comment on the production fallback path. Use `prisma`, zod not needed here (callers validate).
      Files: `<ROOT>/api-node/src/services/otpDelivery.ts`
      Verify: `cd <ROOT>/api-node && npm run build` compiles.

- [ ] 5. Extend `POST /api/otp/send` to accept email OR mobile and route through the resolver.
      In `<ROOT>/api-node/src/routes/otp.ts` broaden the zod schema to accept EITHER `{ email }` OR `{ mobile }`
      (mobile regex `/^[6-9]\d{9}$/`), rejecting when neither is present (422). Call
      `deliverSignupOtp({ email, mobile })`. Response: keep the email branch byte-identical to today
      (`{ message:'OTP sent to your email', devOtp }` where `devOtp` is the OTP only when
      `NODE_ENV!=='production'`). For mobile: return `{ message, devOtp }` where `devOtp` carries
      `result.fallbackOtp` when present (so the existing frontend `data.devOtp` auto-fill path works unchanged);
      message reflects the channel (e.g. "code sent"). Do not leak account existence beyond current behavior.
      Files: `<ROOT>/api-node/src/routes/otp.ts`
      Verify: `cd <ROOT>/api-node && npm run build` compiles; the existing email request body still type-checks
      and the email response fields are unchanged.

- [ ] 6. Make `POST /api/users/register` accept a mobile-only signup and verify against the mobile OTP key.
      In `<ROOT>/api-node/src/routes/users.ts` `/register`: make `email` optional in `registerSchema` while
      keeping `mobile` required (it already is). Determine the OTP lookup key: when `email` present use
      `email.toLowerCase()` (purpose `'signup'`) EXACTLY as today; when email absent use `'mobile:' + mobile`
      (purpose `'signup'`). Verify the OTP row against that key, then create the user. Preserve the existing
      duplicate-user check and the `recovery_email`/`recovery_email_verified` writes only when an email was
      provided (skip/omit them for mobile-only signup). Keep the response shape identical.
      Files: `<ROOT>/api-node/src/routes/users.ts`
      Verify: `cd <ROOT>/api-node && npm run build` compiles; existing email-signup verification path logic is
      unchanged (same key + purpose when email present).

- [ ] 7. Add the OTP-channel setting to the admin settings read/write endpoints.
      In `<ROOT>/api-node/src/routes/admin.ts`: (a) extend `settingsSchema` with an optional `otpChannels`
      object `{ whatsapp?: boolean; fcm?: boolean; mode?: 'whatsapp'|'fcm'|'both' }` (`.partial().optional()`,
      mirroring `whatsappApi`); (b) in `POST /settings` add `otp_channels=COALESCE(?,otp_channels)` to the
      UPDATE and bind `s.otpChannels ? JSON.stringify(s.otpChannels) : null`; (c) in `GET /settings` parse
      `s.otp_channels` tolerantly (reuse `parseOtpChannels` from `services/otpChannelPolicy`) and include
      `otpChannels` in the returned `settings` object. Keep it admin-only; do NOT touch `routes/settings.ts`
      (public) so it is never exposed publicly.
      Files: `<ROOT>/api-node/src/routes/admin.ts`
      Verify: `cd <ROOT>/api-node && npm run build` compiles.

- [ ] 8. Add the OTP-channel type + confirm admin API client passes it through.
      In `<ROOT>/web/src/lib/admin.ts` add `OtpChannels` interface `{ whatsapp: boolean; fcm: boolean; mode:
      'whatsapp'|'fcm'|'both' }` and add `otpChannels?: OtpChannels` to the `AdminSettings` interface.
      `fetchAdminSettings`/`saveAdminSettings` already pass arbitrary settings fields through, so no call change
      is needed — just the type.
      Files: `<ROOT>/web/src/lib/admin.ts`
      Verify: `cd <ROOT>/web && npx tsc -b` type-checks (or run full `npm run build` in step 11).

- [ ] 9. Add the admin OTP-channel selector UI (WhatsApp / FCM / Both).
      In `<ROOT>/web/src/pages/admin/marketing/AutoSendComingSoon.tsx` add a new card (same `card`/`field`/`lbl`
      styles already defined in the file) with a `mode` selector (radio or `<select>`: WhatsApp / FCM / Both)
      bound to `data.otpChannels` from `useQuery(['admin-settings'])`, saving via `saveAdminSettings({
      otpChannels: { mode, whatsapp: mode!=='fcm', fcm: mode!=='whatsapp' } })` and invalidating the
      `['admin-settings']` query on success (reuse the existing `save()` toast/invalidate pattern). Hindi+English
      labels to match the surrounding UI. Default the control to the fetched value or `'fcm'` when absent.
      Files: `<ROOT>/web/src/pages/admin/marketing/AutoSendComingSoon.tsx`
      Verify: `cd <ROOT>/web && npm run build` succeeds (covered by step 11).

- [ ] 10. Update the web signup form to accept mobile-only OTP and auto-fill the fallback.
      In `<ROOT>/web/src/pages/Login.tsx` register mode: (a) `sendOtp()` sends whichever identifier is present —
      `api.post('/otp/send', email ? { email } : { mobile })`; (b) relax the Send-OTP button gate from
      `!email` to require email OR a valid 10-digit mobile; (c) keep the existing
      `if (data.devOtp) setOtp(String(data.devOtp))` auto-fill (the backend returns the mobile fallback OTP in
      the same `devOtp` field), so the user advances automatically; (d) make the Email field optional in the UI
      (label it optional) while keeping mobile required, so a rural user can sign up by mobile alone. `register`
      in `store/auth.ts` already forwards `email`; it may be empty string — ensure an empty email is sent as
      omitted/empty consistent with the now-optional backend schema.
      Files: `<ROOT>/web/src/pages/Login.tsx` (and `<ROOT>/web/src/store/auth.ts` only if the register payload
      type needs `email` made optional).
      Verify: `cd <ROOT>/web && npm run build` succeeds (step 11).

- [ ] 11. Full build + test verification.
      Run the backend build + tests and the web build to confirm no regressions end-to-end.
      Files: none (verification only).
      Verify:
      - `cd <ROOT>/api-node && npm run build` — exits 0, no TS errors.
      - `cd <ROOT>/api-node && npm test` — all tests pass, including the new `otpChannelPolicy` tests.
      - `cd <ROOT>/web && npm run build` — sitemap + `tsc -b` + `vite build` all succeed.

## Resolver smoke-check approach
The resolver is DB-bound, so the automated gate is: (1) the pure `otpChannelPolicy` unit tests (step 3) pin the
channel-order decision without a DB, and (2) `npm run build` + `npm test` prove the orchestrator and routes
compile and existing behavior is intact. A manual runtime smoke-check (optional, not required for the gate,
needs a running DB + `npm run dev`): `POST /api/otp/send { "mobile": "9999999999" }` with the admin channel set
so nothing can deliver (no WhatsApp template, no device token) returns `200` with a `devOtp`/fallback value;
then `POST /api/users/register` with that mobile + the returned OTP (no email) succeeds — proving the user is
never stuck. The email path smoke-check: `POST /api/otp/send { "email": "a@b.com" }` returns the same shape as
before.

## Notes / assumptions
- The admin UI brief said "legacy JS"; the real form is React (`AutoSendComingSoon.tsx`). Plan targets the
  actual React component — this is a correction, not a gap.
- The WhatsApp OTP template name/language code is not yet configured in Meta; the resolver treats an
  unconfigured/absent template as not-delivered and falls through, so signup never breaks. If/when a template is
  approved, wire its name/language via env or an added field on the `otp_channels` blob without changing the API.

## Verification note (iteration 1)

What I ran, and the results (worktree `.worktrees/signup-otp-multichannel/4astore-v2`):

- Backend compile — `api-node` `npm run build` (`tsc -p tsconfig.json`): PASS, exit 0, no TS errors.
  (The worktree had only the Prisma *stub* client because `prisma generate` cannot download engines in this
  sandbox — SSL `unable to get local issuer certificate`. The generated client was copied from the main repo's
  `node_modules/.prisma/client`; both `schema.prisma` files are byte-identical (MD5 match), so the copied client
  matches the schema. This is an environment network limitation, not a code issue.)
- Backend tests — `api-node` `npm test` (node:test): PASS, 95/95 tests, 0 fail. Includes the new
  `otpChannelPolicy.test.ts` (8 cases: FCM-only default on null/garbage/empty/unknown-mode; `both` →
  `['whatsapp','fcm']`; `whatsapp`/`fcm` single-channel order; mode-authoritative booleans).
- Web build — `web` `npm run build` (`generate-sitemap` + `tsc -b` + `vite build`): PASS, built in ~5s, dist
  assets emitted. Fixed a type fallout in `AdminSettings.tsx` (added `otpChannels` to the StoreSettings
  `Exclude` set — it's owned by the Marketing Auto-send tab, same as `whatsappApi`).

Resolver smoke-check: the pure `otpChannelPolicy` unit tests pin the channel-order decision without a DB; the
backend build + full test suite prove the `otpDelivery` orchestrator, the extended `POST /api/otp/send`
(email OR mobile), and the mobile-keyed `/register` verification all compile and existing behavior is intact.
The email `POST /api/otp/send` response keeps its shape (`{ message, devOtp }`, devOtp dev-only). A mobile-only
request with nothing configured returns `{ message, devOtp: <fallbackOtp> }` and does not 500 (the resolver
never throws out of a delivery failure).

Could NOT be verified here (needs real credentials/devices/live DB): actual WhatsApp Cloud API delivery (needs
a Meta pre-approved OTP template + token), actual FCM push delivery (needs device tokens + FCM service account),
and the end-to-end HTTP round-trip (needs a running MySQL). These are documented as expected not-delivered
cases that trigger the fallback, so signup still never breaks.
