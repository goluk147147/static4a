# Signup / Login / Checkout Failsafe Audit — "lead capture is paramount"

Read-only audit. No code changed. All paths relative to `c:\xampp\htdocs\static4a\4astore-v2`.
Build/test commands for later use: `api-node` → `npm run build` (tsc), `npm test` (node:test).

---

## 1. SUMMARY ANSWER (read this first)

The business requirement — *"no matter which channel fails, a user must still be able to sign up / enter, and the lead must be captured"* — is **PARTIALLY met today, with two hard blockers and one data-loss gap**:

- ✅ **Email signup is NOT stuck when SMTP is down.** `otp.ts` → `deliverSignupOtp` returns the OTP as `fallbackOtp` on a failed email send, the web form auto-fills it, and `/users/register` completes. (`otpDelivery.ts:150`, `otp.ts:40`, `Login.tsx:98`). **BUT the mobile APP form deliberately ignores `devOtp`/`fallbackOtp`** (`mobile/app/login.tsx:68-70`), so an app user doing EMAIL signup while SMTP is down **IS stuck** — they never receive and cannot auto-fill the code.
- ✅ **Mobile-only signup is NOT stuck** even when WhatsApp + FCM both fail — `fallbackOtp` is returned in production too (`otpDelivery.ts:200`), web auto-fills it.
- 🔴 **BLOCKER 1 — Google users cannot reach checkout while email is down.** A Google sign-in creates a user with `mobile: null` (`users.ts:171`). The checkout gate (`orders.ts:218`) hard-requires a real mobile (403). The ONLY way to add that mobile is `/users/mobile/send` which sends by **email** and returns **503 when mail fails** (`users.ts:430`). Email is down → the Google user is permanently blocked at checkout. The lead row exists, but the user is stuck.
- 🔴 **BLOCKER 2 — Google login is "down" on WEB because `VITE_GOOGLE_CLIENT_ID` is empty.** The web GIS button no-ops to a "setup pending" toast when the build-time env var is unset (`Login.tsx:21,164,230`). The server `/social-login` and the mobile app both hardcode the real web client id, but the web bundle does not — so web Google silently never starts. (Most likely root cause of "Google login band hai" on the storefront.)
- 🟠 **LEAD GAP — No lead is persisted until verification SUCCEEDS.** On every email/mobile signup path, the `users` row is created only AFTER the OTP matches (`users.ts:76`). If a user enters name/mobile/email, requests an OTP, and then abandons (or the OTP step fails for any reason other than the fallback), **their contact info is never written to the DB** — only an `email_otps` row keyed by the email/`mobile:<n>` exists, with NO name. For Google, the lead is persisted immediately on token verify, but only if the token verifies.

Net: the shipped fallback solves the *OTP-delivery* half of the problem for the web. It does NOT solve (a) the Google→checkout email dependency, (b) the empty web client id, (c) the app ignoring the fallback OTP, or (d) capturing a lead before verification succeeds.

---

## 2. ENTRY-POINT INVENTORY (file:line → failure response → is the user blocked?)

| # | Endpoint | File:line | External dep | Response when dep is DOWN | User blocked? |
|---|----------|-----------|--------------|---------------------------|---------------|
| 1 | `POST /api/users/register` | `api-node/src/routes/users.ts:49` | none (DB only) | 403 "Verify your … before creating an account" if OTP row missing/mismatch; 409 dup; 422 bad input | Only blocked if they never got a valid OTP (see #3/#4) |
| 2 | `POST /api/users/login` | `users.ts:98` | none (DB + bcrypt) | 404 not found / 401 wrong password | No external dep → never blocked by outage |
| 3 | `POST /api/users/social-login` | `users.ts:234` | Google token verify (`verifyIdToken`, `users.ts:243`) | **401 "Invalid Google token"** on ANY throw (`users.ts:250`) or non-verified payload (`users.ts:253`) | Blocked if Google can't mint/verify a token. No fallback to another signup path. |
| 4 | `POST /api/otp/send` (signup) | `api-node/src/routes/otp.ts:30` | SMTP / WhatsApp / FCM via `deliverSignupOtp` | **Always 200.** `{ message, devOtp: fallbackOtp }`. Never 5xx on delivery failure. | NOT blocked on web (auto-fill). **Blocked on app** (app ignores `devOtp`, `login.tsx:68`). |
| 5 | `POST /api/users/mobile/send` (set mobile for Google users) | `users.ts:420` | **SMTP only** (`sendMail`, `users.ts:429`) | **503** "We couldn't send your verification code by email…" (`users.ts:430`) | 🔴 BLOCKED when email down — this is the Google→checkout trap. |
| 6 | `POST /api/users/mobile/verify` | `users.ts:440` | none (DB) | 422 bad/expired code; 409 mobile taken | Blocked only because #5 can't deliver the code. |
| 7 | `POST /api/users/forgot-password/send` | `users.ts:316` | SMTP | **Always generic 200** (enumeration-safe); failure only logged (`users.ts:342`) | Can't reset while mail down, but not a signup path. |
| 8 | `POST /api/users/reset-password` | `users.ts:356` | none (DB) | 422 invalid/expired code | n/a for new leads |
| 9 | `POST /api/users/recovery-email/send` | `users.ts:395` | SMTP | **503** on send failure (`users.ts:410`) | Auth-gated profile feature; not a signup entry |
| 10 | `POST /api/users/recovery-email/verify` | `users.ts:415` | none | 422 | n/a |
| 11 | `POST /api/pos/auth/otp/send` | `api-node/src/routes/pos-auth.ts:92` | FCM push (best-effort) | **Always generic 200**; `devOtp` only off-prod (`pos-auth.ts:125`) | Staff-only allowlist login. In prod with no FCM device + no SMS, **the owner has no way to read the code** (no fallbackOtp in prod here). |
| 12 | `POST /api/pos/auth/otp/verify` | `pos-auth.ts:129` | none | 401 invalid/expired | Blocked only if #11 couldn't deliver |
| 13 | `POST /api/users/refresh` | `users.ts:265` | none | 401 invalid/expired | n/a |
| 14 | `POST /api/orders` (checkout) | `api-node/src/routes/orders.ts:208` | none, but **gates on real mobile** (`orders.ts:218`, `isRealMobile`) | **403 "Add and verify your mobile number before placing an order."** | 🔴 Google `mobile:null` users blocked; unblock path (#5) is itself email-dependent |

Supporting predicates: `isRealMobile` / `isGooglePlaceholderMobile` — `api-node/src/auth/mobileGate.ts:12,15`. Mailer never throws, returns `{ok:false}` when unconfigured or on transport error — `api-node/src/utils/mailer.ts:60,74`.

---

## 3. GOOGLE LOGIN — web + Android trace, and the top reasons it is "down"

### Call sites / how the ID token is obtained
- **Web** (`web/src/pages/Login.tsx`): GIS script loaded at runtime only if `GOOGLE_CLIENT_ID` is truthy (`Login.tsx:21,154`); `window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleCredential })` (`Login.tsx:177`); `handleCredential` POSTs `{ provider:'google', idToken: resp.credential }` to `/users/social-login` (`Login.tsx:188`), then stores the session. `onGoogleClick` shows "setup pending" if the id/script/`window.google` is missing (`Login.tsx:230`).
- **Android app** (`mobile/app/login.tsx`): `GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID })` (`login.tsx:40`); `startGoogle()` calls `GoogleSignin.hasPlayServices()` then `GoogleSignin.signIn()`, extracts `res.data.idToken` (`login.tsx:146-149`), passes it to `socialLogin` → `/users/social-login` (`mobile/src/store/auth.ts:74`). The web client id defaults to the real project id in `app.config.ts:175` (so the app button IS live).
- **Server** (`users.ts:243`): `googleClient.verifyIdToken({ idToken, audience:[GOOGLE_WEB_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID] })`; both IDs hardcoded w/ env override (`users.ts:28,31`).

### Top 3 most likely reasons Google is "down" right now
1. **WEB: `VITE_GOOGLE_CLIENT_ID` is empty in the web build.** `const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''` (`Login.tsx:21`). When empty, the GIS script never loads (`Login.tsx:154` early-return) and the button only toasts "setup pending" (`Login.tsx:231`). This is almost certainly why web Google appears dead — it is a **build-time env/config** issue, not server. Controlled by the web build env (`web/src/vite-env.d.ts:7`), not the server defaults.
2. **ANDROID: `DEVELOPER_ERROR` from `GoogleSignin.signIn()`** — Google refuses to mint a token because the app's package `com.store4a.app` + SHA-1 (upload key AND Play App Signing key) is not registered on an Android OAuth client in the Google Cloud project, and/or `google-services.json`'s `oauth_client` is empty. The token is never produced, so the server never sees a request. (Corroborated by `.agents/tasks/google-developer-error-audit.md`.) Controlled by Google Cloud console + `mobile/google-services.json`, not code.
3. **Audience / client-id mismatch → server 401.** If the web build ever uses a client id NOT in the server's `audience` list, `verifyIdToken` throws and the server returns 401 "Invalid Google token" (`users.ts:250`). Less likely than #1/#2 because the hardcoded defaults match, but any env override that sets only one side would trigger it.

### What a code-side fallback looks like (so a lead is never lost)
Even when Google can't complete, the user already typed nothing but clicked a button, so capture must happen on the alternate path:
- Web: when `onGoogleClick` can't start GIS (`Login.tsx:230`), instead of only a toast, **switch to the register tab pre-focused** so the user falls through to email/mobile signup (which already has the OTP fallback). Non-destructive, no new backend.
- Server: `/social-login` already creates the lead the moment a token verifies (`users.ts:230` → `createGoogleUser`). The gap is only when the token NEVER verifies — there is no contact info to capture at that point (Google never returned an email), so the only recoverable fallback is the email/mobile form.

---

## 4. WHERE IS THE LEAD PERSISTED TODAY? (the crux)

| Signup path | Earliest DB write of a recoverable lead | Does name/contact survive if verification fails? |
|-------------|-----------------------------------------|--------------------------------------------------|
| **Email signup** (`otp/send` → `register`) | `email_otps` row at `otpDelivery.ts:140` holds the **email only** (no name/mobile). The `users` row with name+mobile+email is created only AFTER OTP match at `users.ts:76`. | ❌ **No.** If the user abandons after `otp/send`, only an email string exists in `email_otps`; name is never stored. If they never submit `register`, there is no `users` row. |
| **Mobile-only signup** | `email_otps` row keyed `mobile:<n>` at `otpDelivery.ts:189` — **mobile only, no name**. `users` row created only after OTP match (`users.ts:76`). | ❌ **No name captured.** Mobile string survives in `email_otps`; name/email do not. |
| **Google sign-in** | `users` row created immediately on token verify via `createGoogleUser` (`users.ts:171`), with name+email, `mobile:null`. | ✅ **Yes, IF the token verifies.** The lead (name+email) is saved before any mobile step. ❌ If the token never verifies (the "down" case), nothing is saved. |
| **POS login** | `users` row created on OTP verify (`pos-auth.ts:179`); allowlist row pre-exists in `admin_phones`. | Staff path; lead concept n/a. |

**Conclusion:** For the two self-service paths that matter most (email + mobile signup), the lead's **name is never persisted before verification**. The requirement "lead is necessary / koi bhi fail fir bhi user signup hona chahiye" is only satisfied for the happy path and the Google-token-success path.

---

## 5. CONCRETE, MINIMAL CODE CHANGES (specify only — do NOT implement)

### (a) Google login failure degrades gracefully to another signup path
- `web/src/pages/Login.tsx:230` (`onGoogleClick`) and `:200` (`handleCredential` catch): on failure/no-GIS, call `switchMode('register')` and prefill nothing destructive, plus a toast telling the user to continue with mobile/email. Pure client, no backend.
- `mobile/app/login.tsx:158` (`startGoogle` catch, non-cancel branch): same — route to the register tab instead of only an error toast.
- Fix the real web cause: ensure the web build sets `VITE_GOOGLE_CLIENT_ID` to the web client id (`707085023016-etp7au34rg3cd5eks6cdu0cs0vkj1svn.apps.googleusercontent.com`). This is a **build/env change**, not source; document in `web` env. (`Login.tsx:21` reads it.)

### (b) Email/mobile OTP failure never blocks account/lead creation
- Already shipped for web via `fallbackOtp` (`otpDelivery.ts:150,200`; `otp.ts:40`; `Login.tsx:98`). **Gap to close:** `mobile/app/login.tsx:68-70` deliberately drops `devOtp`. To honor "user never stuck" on the app during the SMTP outage, mirror the web: `if (data.devOtp) setOtp(String(data.devOtp))` in the app's `sendOtp`. (Security note: this exposes the OTP on the same device — acceptable per the documented product tradeoff in `otpDelivery.ts:193`.)

### (c) A lead (contact info) is ALWAYS persisted even when every verification channel fails
Two options; recommend the second as it needs no schema change.
- Preferred: in `services/otpDelivery.ts:deliverSignupOtp` (`otpDelivery.ts:120`), accept optional `name` and write it into the `email_otps` row (reuse an existing column — `otp` table has no name column, so this would need a column OR a side table → schema change; avoid).
- **Recommended (no migration):** create the `users` row at `otp/send` time as an **unverified lead** instead of at `register`. Change `routes/otp.ts:30` to also accept `name` and, inside `deliverSignupOtp`, upsert a `users` row (name + mobile/email, random password, `role:'customer'`) BEFORE sending the OTP, then `register` just flips it to verified. This guarantees the name+contact is saved the instant the user asks for a code. Gate the "verified" state with a flag so unverified leads are visible to sales but can't log in with a password until they complete OTP (reuse `recovery_email_verified`-style boolean, or treat `last_login IS NULL` as unverified — no new column). Touches: `routes/otp.ts:36`, `services/otpDelivery.ts:120-205`, `routes/users.ts:49-91` (register becomes an update-if-exists).
- For Google: lead is already saved on verify (`users.ts:171`); no change needed except (a) above for the no-token case.

### (d) Checkout gate still protects orders but does not erase the lead — AND unblock the Google/email trap
- The gate at `orders.ts:218` is correct to keep (orders need a reachable phone). The problem is the ONLY unblock path (`/users/mobile/send`, `users.ts:420`) is **email-only** and 503s when mail is down.
- **Minimal fix:** add a **non-email** verification channel to `/users/mobile/send` + `/users/mobile/verify` (`users.ts:420,440`) that reuses the signup multi-channel `deliverSignupOtp` (WhatsApp/FCM/fallback) keyed on `mobile:<n>` with `purpose:'set_mobile'`, so a Google user can verify a mobile even while SMTP is down. The fallback OTP already works for mobile. This keeps the checkout gate intact while removing the hard email dependency. Touches: `users.ts:420-470`, reuse `services/otpDelivery.ts`.
- Do NOT delete the `users` row on a failed mobile step — it is the lead. The current code already preserves it (no delete), so the lead is retained; only the *order* is blocked, which is the intended protection.

### Secondary gap (not required, but noted)
- `pos-auth.ts:125`: in production with no FCM device and no SMS gateway, the POS owner cannot read the login code (no `fallbackOtp` in prod). If staff login must survive FCM-down, apply the same `fallbackOtp` pattern or wire the pending SMS TODO (`pos-auth.ts:30`).

---

## 6. SECURITY / ABUSE CONSIDERATIONS of always-create-the-lead

- **Unverified-contact spam / fake leads.** Creating a `users` row at `otp/send` lets anyone seed rows with arbitrary name+mobile. Bound it by: marking the row unverified (reuse `last_login IS NULL` or a boolean) so it cannot log in by password until OTP completes; and **rate-limiting** `otp/send` the way `pos-auth.ts:92` already uses `rateLimit({ limit:5, windowMs:60000 })` (import from `utils/rateLimit`). Signup `otp/send` currently has NO rate limit (`otp.ts:30`) — add one regardless.
- **Duplicate accounts.** `register` already guards username+mobile uniqueness (`users.ts:68`); an upsert-at-send approach must key on the same identifiers (email lowercased, or `mobile`) to avoid duplicate lead rows — match the existing `findFirst({ OR:[username, mobile] })` logic.
- **Fallback OTP exposure.** Returning the OTP to the client (`otpDelivery.ts:150,200`) is a known, documented tradeoff; it defeats possession-proof of the email/number. Bound it by preferring real channels first (already done) and by making the fallback admin-toggleable via `settings.otp_channels` so it can be switched off once SMTP/WhatsApp is healthy.
- **Enumeration.** `/otp/send` returns a per-identifier message (`otp.ts:38`) — slightly more revealing than the enumeration-safe forgot/pos flows; acceptable for signup but keep messages generic if leads become auto-created.
- **PII at rest.** Unverified leads store name+mobile+email with a random password — ensure `safeUser` keeps stripping `password`/`plain_password` (it does, `session.ts:63`) and that lead rows are not exposed via any public list endpoint.

---

## 7. Verification suggestions for the implementation workflow (when fixes are built)
- Build: `cd api-node && npm run build` (tsc, must be 0 errors).
- Unit tests: `cd api-node && npm test` — add cases around `deliverSignupOtp` (SMTP-down → `fallbackOtp` present) and a new `set_mobile` multi-channel path; the pure modules `otpChannelPolicy.ts` and `mobileGate.ts` are already structured for dependency-free unit tests.
- Web: `cd web && npm run build` after any `Login.tsx` change; manually confirm the Google button starts GIS once `VITE_GOOGLE_CLIENT_ID` is set.
- Do NOT run `prisma migrate`/`db push` — the schema notes forbid it; the recommended fixes avoid migrations.
