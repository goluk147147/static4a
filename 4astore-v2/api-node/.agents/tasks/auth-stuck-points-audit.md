# Auth / Signup / Login Stuck-Point Audit (Google OAuth + Gmail SMTP down)

Read-only investigation. No code was changed. All paths absolute (Windows).
Base commit at audit time: `183dbe56` (HEAD -> main).

---

## 1. Summary answer (read this first)

**The requirement — "no user stuck from ANY entry point when Google OAuth and/or SMTP is down" — is NOT yet met. Two hard single-points-of-failure remain, both email-only:**

1. **Add/verify mobile (`/users/mobile/send`) is email-OTP ONLY, with NO fallback.** When Gmail SMTP is down, `sendMail` returns `{ok:false}` and the route returns **503**. This blocks:
   - every **Google sign-in user** (created with `mobile: null`) from clearing the **checkout gate** — on web (`AddMobilePrompt.tsx`) and on Android (`complete-profile.tsx`, which is a forced full-screen gate at launch).
   - This is the exact "user got in but cannot place an order and has no self-serve escape" gap. Admin manual-set-mobile is currently the ONLY escape.
2. **Android email signup has no mobile fallback.** `mobile/app/login.tsx` `sendOtp()` sends `{ email }` ONLY and **ignores `devOtp`/`fallbackOtp`**, and the email field is **required** (`Send OTP` is `disabled={!email}`). So on Android, when SMTP is down, email signup is dead AND there is no mobile-only signup path — unlike web. Password reset / recovery-email are email-only everywhere (acceptable, they are recovery flows, but worth noting).

**Good news (already resilient):**
- **Username/password login** (`/users/login`) touches no external service → never stuck. This is the universal fallback for *returning* users even if both Google and SMTP are down.
- **Web signup** already degrades: email optional, mobile-only path returns `fallbackOtp` in prod and the web form auto-fills it (`Login.tsx` `sendOtp`). So a web user can finish signup with SMTP down.
- **Google button failure degrades gracefully to the email/mobile forms** on both clients — the button failing never blocks the rest of the login screen (details in §2).

**If Google login is down, can a user still get in by email/mobile?** Yes, on both clients — the Google button is independent of the username/password + OTP forms. Google being down is therefore NOT a stuck point by itself; the stuck points are all driven by **SMTP being down + an email-only step**.

---

## 2. Google login "band" — every failure mode of `/social-login` and the Google button

Server: `api-node/src/routes/users.ts` `POST /social-login` (approx L160–L205).

| # | Failure mode | Where | What the user sees | Fallback exists? |
|---|---|---|---|---|
| G1 | `provider` sent and != 'google' | users.ts, `if (req.body?.provider !== 'google') return fail(...,400)` | 400 "Unsupported provider" | Email/mobile forms unaffected ✔ |
| G2 | Missing/short idToken | `socialLoginSchema` + `if(!parsed.success) 422` | 422 "A valid Google idToken is required" | ✔ |
| G3 | `verifyIdToken` throws (expired token, **audience/client-ID mismatch**, bad signature, **network to Google unreachable**) | `try{...}catch{ return fail('Invalid Google token',401) }` | 401 "Invalid Google token" | ✔ forms still work |
| G4 | `email_verified !== true` or no email in payload | `if(!p||p.email_verified!==true||!p.email) 401` | 401 "Invalid Google token" | ✔ |
| G5 | **Client-ID/origin misconfig on the CLIENT** (web: GIS `prompt()` fails / wrong `VITE_GOOGLE_CLIENT_ID` / origin not in Google Cloud authorized origins; Android: wrong `webClientId`, SHA mismatch, Play Services) | `web/src/pages/Login.tsx` `onGoogleClick`/`handleCredential`; `mobile/app/login.tsx` `startGoogle` | Web: either the GIS prompt silently no-shows, or `handleCredential` catch → error toast `apiError(err)`. If `VITE_GOOGLE_CLIENT_ID` empty → "Google login setup pending" info toast. Android: `startGoogle` catch → error toast; `SIGN_IN_CANCELLED` is swallowed (no toast); empty `GOOGLE_WEB_CLIENT_ID` → "setup pending" toast | ✔ The rest of the login/register screen (username/password, OTP) is fully usable. The Google button failing NEVER blocks other entry points. |

**Important config note (ops, not code):** `/social-login` verifies audience against `GOOGLE_WEB_CLIENT_ID` / `GOOGLE_ANDROID_CLIENT_ID` (defaulted in-code at `users.ts` top, overridable via env). The "Google band" symptom is almost certainly a **config/ops issue** (OAuth authorized JavaScript origins / redirect URIs in Google Cloud, consent-screen publishing status, or client-ID mismatch between the deployed web `VITE_GOOGLE_CLIENT_ID` and the server audience), NOT a code bug. Code-side, every Google failure already degrades to a 401/toast and leaves the email/mobile forms working.

**Conclusion for Q1/Q3:** Google being down is self-contained. No code change is strictly required to keep users un-stuck when Google is down, because username/password login and email/mobile signup are independent. The real exposure is SMTP (below).

---

## 3. Per-entry-point stuck analysis (Q2 + Q3 + Q4)

Legend: **STUCK** = user cannot proceed when the named service is down and has no self-serve alternative.

### 3.1 Username / password login — `POST /users/login` (users.ts ~L95)
- External deps: **none** (bcrypt + DB only; master-password fallback is DB-only).
- SMTP down / Google down → **NOT stuck.** This is the resilient universal path for returning users.
- Evidence: `const valid = bcrypt.compareSync(...)` then `issueTokens`. No mail/Google call.

### 3.2 Google login — `POST /users/social-login`
- Google down → **NOT stuck** (user uses password login or email/mobile signup instead). See §2.
- Note: a *new* Google user is created with `mobile: null` (`createGoogleUser`), which then forces them into the mobile-verify step (3.7) to checkout — that is where SMTP bites.

### 3.3 Email signup — `POST /otp/send` (email branch) + `POST /users/register`
- **Web:** `otpDelivery.deliverSignupOtp` email branch returns `fallbackOtp = otp` when `sent.ok === false` (SMTP down). `otp.ts` returns it as `devOtp`; `web/Login.tsx sendOtp` auto-fills `setOtp(data.devOtp)`. → **NOT stuck on web.**
  - Evidence: `otpDelivery.ts` `const fallbackOtp = sent.ok ? (NODE_ENV!=='production'?otp:undefined) : otp;`
- **Android:** `mobile/app/login.tsx sendOtp()` posts `{ email }`, then the comment deliberately **ignores devOtp** ("we deliberately ignore it"). With SMTP down the code is generated and stored but never reaches the user. → **STUCK on Android** (email signup only, no auto-fill, and email is required so no mobile fallback either).

### 3.4 Mobile-only signup — `POST /otp/send` (mobile branch) + `/users/register`
- **Web:** supported. Email field optional; when blank the form sends `{ mobile }`. Mobile branch tries WhatsApp→FCM, else returns `fallbackOtp` **in production** (explicit product decision in `otpDelivery.ts`). Web auto-fills. → **NOT stuck on web** regardless of SMTP/Google.
- **Android:** **not offered.** The register form requires `email` (`disabled={!email}`) and never sends `{ mobile }` to `/otp/send`. → mobile-only signup is a web-only capability today.

### 3.5 Password reset — `POST /users/forgot-password/send` + `/users/reset-password` (users.ts)
- External dep: **SMTP only** (sends 6-digit code to recovery/primary email).
- SMTP down → code never arrives; endpoint stays enumeration-safe 200 (`if(!sent.ok) console.warn(...)` only). User cannot reset. → **STUCK while SMTP down**, but this is a *recovery* flow and the user can still log in with their existing password or use a different entry point. Acceptable as a degraded state; UI already shows a support phone (`7543888698`).

### 3.6 Recovery-email add/verify — `POST /users/recovery-email/send|verify` (requireAuth)
- External dep: **SMTP only.** `if(!sent.ok) return fail(..., 503)`. → **STUCK while SMTP down**, but this is optional profile hardening, not an access gate. Acceptable.

### 3.7 Add-mobile prompt / set-mobile — `POST /users/mobile/send|verify` (requireAuth) ⚠️ CRITICAL
- External dep: **SMTP ONLY. No WhatsApp/FCM/fallback.**
- `users.ts /mobile/send`: `const sent = await sendMail(...); if(!sent.ok) return fail(..., 503)`.
- Clients: web `AddMobilePrompt.tsx` (`/users/mobile/send`, surfaces 503, stays on send step); Android `complete-profile.tsx` (same, forced gate from `app/_layout.tsx` `needsRealMobile`).
- SMTP down → **STUCK.** This is the single worst gap because it combines with the checkout gate (3.8): a Google user literally cannot shop.

### 3.8 Checkout gate — `POST /orders` (orders.ts ~L190)
- `const me = ...; if(!me || !isRealMobile(me.mobile)) return fail('Add and verify your mobile number before placing an order.',403)`.
- Not an external dep itself, but it REQUIRES 3.7 to have succeeded. For a user who got in (Google or any null-mobile account) but cannot receive an email OTP, with no WhatsApp/FCM, **admin manual-set-mobile is the ONLY escape** today. Self-serve path does NOT exist. → **This is the gap the user is asking to close.**

### 3.9 POS phone login — `POST /pos/auth/otp/send|verify` (pos-auth.ts)
- Delivery is FCM-push-only to already-registered staff devices (+ dev devOtp). No SMTP, no Google. Staff-only allowlist.
- If a POS staffer has no registered device and it's production, they can't get the code → effectively stuck, but this is a narrow staff path, not a customer entry point, and is out of scope for "user never stuck." Flag as minor.

---

## 4. Single points of failure (direct answer to Q3/Q4)

| Entry point | Google down | SMTP down | Self-serve escape when SMTP down? |
|---|---|---|---|
| Password login | OK | OK | n/a (no external dep) |
| Google login | n/a | OK | use password / email-or-mobile signup |
| Email signup (web) | OK | OK (fallbackOtp auto-fill) | ✔ |
| Email signup (**Android**) | OK | **STUCK** | ✘ (ignores fallback, email required) |
| Mobile signup (web) | OK | OK (fallbackOtp) | ✔ |
| Mobile signup (Android) | — not offered — | — | ✘ (not implemented) |
| Add/verify mobile (**web + Android**) | OK | **STUCK (503)** | ✘ — admin only |
| Checkout gate | OK | **STUCK** (depends on add-mobile) | ✘ — admin only |
| Password reset | OK | STUCK (recovery flow) | acceptable |
| Recovery email | OK | STUCK (optional) | acceptable |

**Answer to Q4:** For a logged-in user who cannot receive an OTP (SMTP down) and has no WhatsApp/FCM, **admin manual-set-mobile is currently the ONLY escape** for the checkout gate. There is **no self-serve path**. Given the user's explicit "lead is necessary / no user should drop off" requirement, this is a **gap**, not acceptable as-is.

---

## 5. Ranked recommendations (minimal changes, with file:line targets)

Ranked by impact on "no user stuck." Prefer graceful fallbacks that keep security; do NOT disable OTP verification or the checkout gate wholesale.

### R1 — [CODE, HIGHEST] Give `/users/mobile/send` the same multi-channel + fallback as signup
**Why:** Closes the biggest gap (§3.7 + §3.8). Today it is email-only and 503s when SMTP is down, trapping every Google user behind the checkout gate.
**What:** Route the set-mobile OTP through the existing resilient orchestrator instead of raw `sendMail`. Reuse `deliverSignupOtp`-style logic (WhatsApp→FCM→fallbackOtp) keyed to the mobile the user is adding, OR extend `otpDelivery.ts` with a `deliverSetMobileOtp` that, when email send fails, tries FCM to the user's device tokens (`services/push.tokensForUser`) and finally returns a `fallbackOtp` the client auto-fills — exactly mirroring the production decision already blessed in `otpDelivery.ts`.
**Files:** `api-node/src/routes/users.ts` (`/mobile/send` ~L300 and the `/mobile/verify` key lookup — keep `purpose='set_mobile'`); `api-node/src/services/otpDelivery.ts` (add the set-mobile variant); client auto-fill in `web/src/components/AddMobilePrompt.tsx` `sendCode()` (`if(data.devOtp) setOtp(...)` — already present) and `mobile/app/complete-profile.tsx` `sendCode()` (currently ignores devOtp — must consume it).
**Security note:** The OTP goes to the number being added, so the fallback-OTP self-fill is the same weak-but-controlled tradeoff already accepted for mobile signup; the checkout gate itself stays intact.
**Verify:** `cd api-node && npm test` (node --test) — add/extend a test alongside `src/__tests__/mobileSendHonesty.test.ts` asserting that on `sendMail {ok:false}` the handler returns a fallback OTP (not 503) when no channel delivered. Build: `npm run build`.

### R2 — [CODE, HIGH] Android email signup must consume the signup fallback OTP
**Why:** §3.3 — Android email signup is dead with SMTP down because it ignores `devOtp`/`fallbackOtp`.
**What:** In `mobile/app/login.tsx` `sendOtp()`, when `data.devOtp` is present, auto-fill `setOtp(String(data.devOtp))` (mirror web `Login.tsx`). This only ever carries a value when the server decided to expose the fallback (SMTP failed / no channel), so no behavior change when mail works in prod.
**Files:** `mobile/app/login.tsx` (`sendOtp`, ~L62).
**Verify:** `cd mobile && npm test` (profileGate-style node tests) + a manual/build check; TypeScript compile via the app's `tsc`/expo typecheck.

### R3 — [CODE, HIGH] Offer mobile-only signup on Android (parity with web)
**Why:** §3.4 — Android forces email at signup; a rural/SMTP-down user has no path. Web already supports mobile-only.
**What:** Make the Android register email field optional, enable "Send OTP" when a valid 10-digit mobile OR an email is present, and send `{ mobile }` when email is blank (mirror `web/src/pages/Login.tsx` `sendOtp` payload choice). Combined with R2's auto-fill, Android signup then survives both Google-down and SMTP-down.
**Files:** `mobile/app/login.tsx` (register form `Field label="Email"`, the `Send OTP` `disabled={!email}`, and `sendOtp` payload).
**Verify:** app typecheck/build; manual signup with email blank hitting `/otp/send` mobile branch.

### R4 — [CODE, MEDIUM] Graceful "Google unavailable" messaging + ensure button never hides the forms
**Why:** §2 — behavior is already acceptable, but the web `onGoogleClick` can silently no-show the GIS prompt on origin misconfig. Make the degraded state explicit so users immediately fall back to email/mobile instead of retrying Google.
**What:** On GIS `prompt()` notification being dismissed/not-displayed, show the same "use email/mobile below" toast; keep forms always rendered (they already are). No change to server verification.
**Files:** `web/src/pages/Login.tsx` (`onGoogleClick`), optionally `mobile/app/login.tsx` (`startGoogle`).
**Verify:** manual; no server test needed.

### R5 — [OPS/CONFIG, parallel track — not code] Restore the two external services
These are the root cause of the incident and should be fixed in parallel; they are NOT code changes:
- **Gmail SMTP:** fix `MAIL_HOST/MAIL_USER/MAIL_PASS` (Gmail app-password / "less secure"/OAuth change, or quota/block). Config in `api-node/src/config.ts` `mail.*` from env. Once restored, every email path (reset, recovery, set-mobile) and `delivered=true` resume and no fallback OTP is exposed.
- **Google OAuth "band":** verify in Google Cloud Console — authorized JavaScript origins / redirect URIs for the deployed web origin, OAuth consent screen publishing status, and that the deployed web `VITE_GOOGLE_CLIENT_ID` matches the server audience `GOOGLE_WEB_CLIENT_ID` (and the Android `webClientId` + SHA-1). No code change; purely console/env.
- **Optional durability:** configure `WHATSAPP_OTP_TEMPLATE` (+ lang) so the mobile branch (and R1) can truly deliver via WhatsApp — turns the fallback-OTP self-fill into a real out-of-band channel. Config-only, already wired in `otpDelivery.ts`.

### Priority order to satisfy "no user stuck from any entry point"
1. **R1** (unblocks checkout for every Google/null-mobile user when SMTP is down — the headline fix).
2. **R2** (Android email signup survives SMTP outage).
3. **R3** (Android gains the mobile-only escape web already has).
4. **R5 ops** in parallel (actually ends the incident).
5. **R4** polish.

After R1–R3, every customer entry point has a working path with BOTH Google and SMTP down: returning users → password login; new users → email or mobile signup with fallback auto-fill (web + Android); null-mobile users → set-mobile with fallback → checkout gate clears. No remaining customer-facing single point of failure; the checkout gate and OTP verification stay in force (security preserved).

---

## 6. Evidence index (file : symbol)

- `api-node/src/routes/users.ts` — `/register`, `/login` (no external dep + master-password), `/social-login` (G1–G4), `/forgot-password/send` (enumeration-safe, mail best-effort), `/reset-password`, `/recovery-email/send` (503 on fail), `/mobile/send` (**503 on fail, email-only — critical gap**), `/mobile/verify`, `createGoogleUser` (mobile: null).
- `api-node/src/services/otpDelivery.ts` — email branch `fallbackOtp = sent.ok ? ... : otp`; mobile branch WhatsApp→FCM→`fallbackOtp` (prod).
- `api-node/src/routes/otp.ts` — returns `devOtp: result.fallbackOtp`.
- `api-node/src/utils/mailer.ts` — `sendMail` returns `{ok:false}` (never throws) when not configured or transport throws.
- `api-node/src/routes/orders.ts` — `POST /orders` checkout gate `isRealMobile(me.mobile)` → 403.
- `api-node/src/auth/mobileGate.ts` — `isRealMobile`.
- `api-node/src/routes/pos-auth.ts` — FCM-only staff OTP.
- `web/src/pages/Login.tsx` — email optional + mobile fallback auto-fill (`setOtp(data.devOtp)`); Google GIS graceful degrade (`onGoogleClick`, empty client-id "setup pending").
- `web/src/components/AddMobilePrompt.tsx` — set-mobile via email OTP; surfaces 503, stays on send step.
- `mobile/app/login.tsx` — `sendOtp` email-only + **ignores devOtp**; register email required; `startGoogle` graceful degrade.
- `mobile/app/complete-profile.tsx` — forced set-mobile gate via email OTP, **ignores devOtp**.
- `mobile/app/_layout.tsx` + `mobile/src/profileGate.ts` — `needsRealMobile` forces Google users to complete-profile.

Build/test commands discovered: API `cd api-node && npm run build` (tsc) and `npm test` (`node --import ./src/__tests__/register.mjs --test "src/__tests__/**/*.test.ts"`). Existing relevant tests: `src/__tests__/mailer.test.ts`, `mobileSendHonesty.test.ts`, `signupEmailFallback.test.ts`; mobile `src/__tests__/profileGate.test.ts`.
