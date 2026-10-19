# Signup / Login / Checkout Failsafe — Implementation Plan

Branch: `main`, work IN-PLACE (no worktree). Base: the two read-only audits in
`api-node/.agents/tasks/signup-failsafe-audit.md` and
`api-node/.agents/tasks/auth-stuck-points-audit.md`. This plan carries their
section-5 / ranked recommendations into concrete, ordered, independently
verifiable steps. All file:line targets below were re-confirmed against the
current source before writing this plan.

## Business goal (do not lose sight of this)
Lead capture is paramount. No matter which external channel fails (email/SMTP,
Google OAuth, WhatsApp, FCM), a user must still be able to sign up / enter, and
the lead's contact info **including NAME** must be captured.

## Hard constraints (apply to EVERY item)
- NO `prisma migrate` / `prisma db push`. `deploy.sh` runs `prisma generate` +
  build only. NO schema change. If any fix seems to need a column/table, STOP
  and flag it — do not add a migration.
- Do NOT weaken, remove, or bypass any of these (all already shipped on main):
  - the checkout gate in `orders.ts` (`if (!me || !isRealMobile(me.mobile)) ... 403`, ~line 178);
  - `/users/mobile/verify` (`routes/users.ts`, ~line 440) — its key/purpose lookup must keep matching what `/mobile/send` writes;
  - `/register` uniqueness guards (`findFirst({ OR:[{username},{mobile}] })` → 409, `routes/users.ts` ~line 68);
  - the `/api/admin/data` 403 scoping fix and the pos-login no-downgrade guard;
  - enumeration-safety of `/forgot-password/send` (generic 200, never 503).
- `safeUser` must keep stripping `password` / `plain_password` (it does, `auth/session.ts`). Leads created early must never leak secrets or appear on a public list endpoint.
- Keep the admin-toggleable fallback behaviour intact: the mobile fallback OTP is gated by `settings.otp_channels` via `otpChannelPolicy.ts`; do not hardcode around it.
- Mail is currently blocked at the provider (owner's note). These fixes make email NON-fatal; they do not fix SMTP (that is the parallel ops track R5 in the audit — out of scope here).

## Test-harness note (shapes every verification below)
`api-node` tests run with `npm test`
(`node --import ./src/__tests__/register.mjs --test "src/__tests__/**/*.test.ts"`).
The worktree has **no reachable database**, so the existing tests
(`mobileSendHonesty.test.ts`, `signupEmailFallback.test.ts`,
`mobileGate.test.ts`) are **source-assertion / pure-function** tests: they
`readFileSync` the route/service source and regex-match the load-bearing lines,
plus unit-test any pure helper. New test cases in this plan MUST follow the same
pattern — do not write tests that need a live DB. Build is `npm run build` (tsc,
must be 0 errors). Web build is `cd web && npm run build`.

---

# Entry-point table (audit §2) — report NEW behaviour per entry point

The implementer must, at the end, confirm each entry point's behaviour when its
dependency is DOWN. This table is the acceptance surface.

| # | Endpoint | File (confirmed) | Dep down | REQUIRED behaviour after this plan |
|---|----------|------------------|----------|------------------------------------|
| 1 | `POST /api/users/register` | `routes/users.ts` ~49 | none | Flips the existing unverified lead to verified on OTP match; keeps 409 uniqueness guards; never deletes the lead on failure (R2) |
| 2 | `POST /api/users/login` | `routes/users.ts` ~98 | none | Unchanged — resilient universal path |
| 3 | `POST /api/users/social-login` | `routes/users.ts` ~210 | Google | Unchanged server-side; web client falls through to register tab (R4) |
| 4 | `POST /api/otp/send` (signup) | `routes/otp.ts` ~30 | SMTP/WA/FCM | Rate-limited 5/min (R3); accepts optional `name`; persists lead BEFORE verify (R2); returns `devOtp` fallback — web AND Android now auto-fill (R5) |
| 5 | `POST /api/users/mobile/send` | `routes/users.ts` ~420 | SMTP | NO MORE hard 503: multi-channel (email → FCM → fallbackOtp), returns fallbackOtp on failure so a Google user can always verify (R1) |
| 6 | `POST /api/users/mobile/verify` | `routes/users.ts` ~440 | none | UNCHANGED key/purpose lookup — still matches what `/mobile/send` writes (R1 preserves this) |
| 7 | `POST /api/users/forgot-password/send` | `routes/users.ts` ~316 | SMTP | UNCHANGED — stays enumeration-safe generic 200 |
| 9 | `POST /api/users/recovery-email/send` | `routes/users.ts` ~395 | SMTP | Honest 503 KEPT (auth-gated optional profile hardening, not an access gate) — see §Owner-sweep decision |
| 11 | `POST /api/pos/auth/otp/send` | `routes/pos-auth.ts` ~92 | FCM | NO MORE prod dead-end: when no staff device received the push, expose `devOtp` fallback in production too (allowlist-gated + rate-limited as today) (R6) |
| 3b | `POST /api/users/social-login` (APP) | `mobile/app/login.tsx` `startGoogle` | Google | On Google failure the APP routes the user to the register tab (R7), mirroring web R4, so the lead is never lost |
| 14 | `POST /api/orders` (checkout) | `routes/orders.ts` ~178 | n/a | UNCHANGED gate; now reachable because R1 unblocks set-mobile |

## Owner-sweep decision (which §2 paths get a fallback vs. stay as-is)
Per the owner clarification, EVERY §2 path was swept. Outcome:
- **Gets a new fallback:** #11 pos-auth `/otp/send` (R6 below) and #3b app Google
  failure branch (R7 below), in addition to R1–R5.
- **Deliberately UNCHANGED (documented, not a dead-end):**
  - #7 `forgot-password/send` — must stay enumeration-safe generic 200; surfacing
    a channel failure would leak account existence. The user still has
    password login + other entry points; this is a recovery flow, not an access
    gate. Keeping it is the correct call, not a gap.
  - #9 `recovery-email/send` — auth-gated OPTIONAL profile hardening (adding a
    recovery email), not a signup/entry/checkout path. Its honest 503 is an
    actionable message ("try again shortly or contact support"), not a silent
    dead-end, and the user is already logged in. Left as-is on purpose. (The
    set-mobile path #5, which DOES gate checkout, is the one that gets the
    multi-channel fallback in R1 — recovery-email does not gate anything.)
  These two are the only `sendMail`-only 503/generic paths left; both are
  justified above, satisfying "never a dead-end" (both leave the user with a
  working alternative and a clear message).

---

# Ordered implementation items

Order rationale: R3 (rate-limit) and R4/R5 (client) are independent and low
risk; R1 and R2 both touch `otpDelivery.ts` + `routes/users.ts`, so they are
sequenced R2-helper → R1 → R2-wire to keep each step buildable. Each item leaves
the tree compiling.

- [ ] 1. **(R3) Rate-limit signup `POST /otp/send`.**
      Add `rateLimit({ limit: 5, windowMs: 60_000, bucket: 'signup_otp_send' })`
      as route middleware on `/send`, importing `rateLimit` from
      `../utils/rateLimit` (same helper `pos-auth.ts` already uses with
      `bucket:'pos_otp_send'`). 5/min will not block legitimate resend/retry.
      Note: the bucket keys on `req.user?.sub ?? req.ip`; signup is unauthenticated
      so it keys on IP — acceptable for a soft abuse guard; use a distinct
      `bucket` label so it never shares pos counters.
      Files: `api-node/src/routes/otp.ts`.
      Verify: `cd api-node && npm run build` (0 errors). Add a source-assertion
      case to a new `signupOtpRateLimit.test.ts` asserting `routes/otp.ts`
      imports `rateLimit` and applies it on `/send` with `limit: 5` and
      `windowMs: 60_000`; run `npm test` — all pass.

- [ ] 2. **(R4) Web Google-login default client id + graceful fallback to register.**
      In `web/src/pages/Login.tsx`:
      (a) Replace the empty default on line 21
      (`const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''`)
      with a documented in-code default constant
      `'707085023016-etp7au34rg3cd5eks6cdu0cs0vkj1svn.apps.googleusercontent.com'`
      (the exact id the server already lists in its `verifyIdToken` audience,
      `GOOGLE_WEB_CLIENT_ID` in `routes/users.ts`). Keep the env override:
      `import.meta.env.VITE_GOOGLE_CLIENT_ID || '<default>'`, so the GIS script
      loads and the button works even when the build env var is unset.
      (b) In `onGoogleClick` (~line 230): when GIS cannot start
      (`!gisReady || !window.google?.accounts?.id`), replace the
      "setup pending" dead-end with `switchMode('register')` + a toast telling
      the user to continue with mobile/email so the lead is not lost.
      (c) In `handleCredential`'s catch (~line 200): on login failure also call
      `switchMode('register')` + the same toast (keep the error toast).
      Pure client change + one default constant. NO backend change.
      Files: `web/src/pages/Login.tsx`.
      Verify: `cd web && npm run build` (0 errors). Manual: with
      `VITE_GOOGLE_CLIENT_ID` unset the Google button loads GIS; forcing a GIS
      failure switches to the register tab with the toast.

- [ ] 3. **(R5) Android consumes the fallback OTP on signup.**
      In `mobile/app/login.tsx` `sendOtp()` (~lines 62-74), the app currently
      POSTs `{ email: email.trim() }` and deliberately drops `data.devOtp`.
      Capture the response and mirror web `Login.tsx`:
      `const { data } = await api.post('/otp/send', { email: email.trim() });`
      then `if (data?.devOtp) setOtp(String(data.devOtp));`. This value is only
      present when the server chose to expose the fallback (SMTP failed / no
      channel), so there is no behaviour change when mail works in production.
      Keep the edit minimal; do NOT also implement mobile-only Android signup
      (audit R3 is out of this task's five-fix scope).
      Files: `mobile/app/login.tsx`.
      Verify: TypeScript — `cd mobile && npx tsc --noEmit` (or the app's
      configured typecheck) passes. **FLAG:** a native Android build / QA of the
      signup OTP auto-fill is a follow-up and is NOT performed in this
      environment — record this in the item's findings; do not silently skip the
      code edit.

- [ ] 4. **(R2 helper) Add a lead-upsert helper that persists an UNVERIFIED lead at otp/send time.**
      Add an exported async helper (new file
      `api-node/src/services/leadUpsert.ts`, imported by `otpDelivery.ts`) e.g.
      `upsertUnverifiedLead({ name?, email?, mobile? })`. Behaviour:
      - Key on the SAME identifiers `register` uses: look up with
        `prisma.user.findFirst({ where: { OR: [ ...(email ? [{ email: email.toLowerCase() }, { recovery_email: email.toLowerCase() }] : []), ...(mobile ? [{ mobile }] : []) ] } })` so no duplicate lead rows and it aligns with the `findFirst({OR:[{username},{mobile}]})` uniqueness logic.
      - If no row: `create` a `users` row with `name` (when provided), `mobile`
        (when a 10-digit mobile was given; else leave NULL — `users.mobile` is
        nullable), `recovery_email` + `recovery_email_verified:false` when an
        email was given, a RANDOM bcrypt password
        (`bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10)`),
        `role:'customer'`, `registered_at: new Date()`, and crucially
        **`last_login: null`** (the UNVERIFIED signal — treat `last_login IS NULL`
        as unverified; do NOT add a column).
      - Derive a unique `username` the same defensive way `createGoogleUser`
        does (base from email/name, retry-suffix on P2002) since `username` is
        required+unique; mobile stays NULL-safe.
      - If a row exists: update only `name` when newly provided (never overwrite
        a non-null name with empty); DO NOT touch `password`, `last_login`, or
        role. Never DELETE.
      - Must be best-effort / non-fatal: wrap in try/catch and return without
        throwing so a lead-write hiccup never breaks OTP delivery.
      Files: `api-node/src/services/leadUpsert.ts`.
      Verify: `cd api-node && npm run build` (0 errors). The username-derivation
      and the unverified-signal (`last_login` null) are pure enough to assert in
      step 7's tests.

- [ ] 5. **(R2 wire) Thread an optional `name` through otp/send and call the lead upsert BEFORE sending.**
      (a) `routes/otp.ts`: add `name: z.string().min(1).max(120).optional()` to
      `sendSchema`, destructure it, and pass it into `deliverSignupOtp({ email,
      mobile, deviceToken, name })`.
      (b) `services/otpDelivery.ts`: add optional `name?: string` to
      `DeliverSignupOtpInput`; at the TOP of `deliverSignupOtp` (before either
      the email or mobile branch sends), call
      `await upsertUnverifiedLead({ name: input.name, email, mobile })` so the
      lead's NAME + contact is stored the instant a code is requested. Keep
      everything else (otp generation, `email_otps` write, channel order,
      fallbackOtp) unchanged.
      (c) Web/Android clients already send `name` in the register form state;
      update web `sendOtp` to include `name` in the `/otp/send` payload
      (`{ ...(name.trim() ? { name: name.trim() } : {}), ... }`) and Android
      `sendOtp` likewise (`{ email: email.trim(), name: name.trim() }`). These
      are additive and safe when `name` is empty.
      Files: `api-node/src/routes/otp.ts`,
      `api-node/src/services/otpDelivery.ts`, `web/src/pages/Login.tsx`,
      `mobile/app/login.tsx`.
      Verify: `cd api-node && npm run build` and `cd web && npm run build`
      (0 errors); `cd mobile && npx tsc --noEmit`. Add source-assertion cases
      (step 7) that `otp.ts` accepts `name` and `otpDelivery.ts` calls
      `upsertUnverifiedLead` before any send.

- [ ] 6. **(R2 register) Make `/register` update-if-exists → flip the lead to verified.**
      In `routes/users.ts` `/register` (~line 49-91): after the OTP row matches
      and AFTER the existing uniqueness check, instead of unconditionally
      `prisma.user.create`, look up the existing lead by the SAME identifiers
      (email lowercased / mobile). If a lead row exists:
      `prisma.user.update` it to set `name`, `username` (lowercased),
      `password` (bcrypt of the submitted password), the recovery_email fields
      when an email was given, and **`last_login: new Date()`** (this is the
      flip to verified). If no lead exists (e.g. OTP issued before this change,
      or Google path), keep the current `create` with `last_login: new Date()`.
      Preserve the current 409 uniqueness guards EXACTLY — the dup check must
      still reject a username/mobile that belongs to a DIFFERENT user id (when a
      lead row is the SAME identity being completed, that is not a dup). Mark the
      OTP row consumed as today. Keep `safeUser` on the response.
      Files: `api-node/src/routes/users.ts`.
      Verify: `cd api-node && npm run build` (0 errors). Source-assertion cases
      (step 7): register sets `last_login` on completion, still has the
      `OR:[{username},{mobile}]` dup guard returning 409, and never calls
      `prisma.user.delete`.

- [ ] 7. **(R2 tests) Add the lead-capture test file.**
      New `api-node/src/__tests__/leadCapture.test.ts` (source-assertion +
      pure-fn, mirroring `signupEmailFallback.test.ts`): assert
      (a) `routes/otp.ts` has `name` in its schema and forwards it;
      (b) `otpDelivery.ts` calls `upsertUnverifiedLead(...)` before `sendMail`
      and before the mobile channel loop;
      (c) `leadUpsert.ts` creates with `last_login: null` (unverified signal),
      `role: 'customer'`, a random password, and keys the lookup on email/mobile;
      (d) `routes/users.ts` `/register` flips `last_login` and retains the 409
      dup guard and contains no `prisma.user.delete`.
      Files: `api-node/src/__tests__/leadCapture.test.ts`.
      Verify: `cd api-node && npm test` — new + existing tests all pass.

- [ ] 8. **(R1) Give `/users/mobile/send` the same multi-channel + fallback as signup — keeping verify's key/purpose UNCHANGED.**
      Critical constraint from the brief: `/users/mobile/verify` (~line 440)
      today reads `email_otps` with
      `{ email: target.toLowerCase(), purpose: 'set_mobile' }` where
      `target = user.recovery_email || user.email`. R1 must NOT change what
      verify reads. So the new multi-channel send MUST store the OTP under that
      SAME key (`target.toLowerCase()`, `purpose:'set_mobile'`) — do NOT switch
      to a `mobile:<n>` key for set_mobile.
      Add a `deliverSetMobileOtp` variant (in `services/otpDelivery.ts`, reusing
      the existing `tryFcm` / channel-policy building blocks) that:
      - takes `{ otpKey, mobile, userId }` (otpKey = the email target key),
      - generates the OTP and writes the `email_otps` row with
        `purpose:'set_mobile'` under `otpKey` (same shape verify expects),
      - attempts delivery EMAIL first (so a working mailbox still gets it), then
        FCM to the user's device tokens (`tokensForUser(userId)`), then returns
        `fallbackOtp = otp` when no real channel delivered — INCLUDING
        production — exactly mirroring the mobile-signup tradeoff already blessed
        in `deliverSignupOtp`. Email stays ONE channel but is never the sole
        path and must NEVER hard-503.
      Rework `routes/users.ts` `/mobile/send` (~line 420) to call this variant
      and `return ok(res, { message: 'Code sent', devOtp: result.fallbackOtp })`
      instead of the current `sendMail`-only + `503`. Remove the hard
      `if (!sent.ok) return fail(..., 503)` dead-end for mobile/send ONLY.
      Keep the `target = recovery_email || email` resolution and the
      "Add a recovery email first" 400 only if genuinely no key is derivable;
      if the design can key the OTP without an email target, prefer that so a
      Google user with no recovery email is still not stuck — but if removing
      the email-target requirement would change what verify reads, STOP and keep
      the email-target key (verify-match wins). Document the choice in findings.
      Do NOT touch `/mobile/verify` and do NOT touch the checkout gate.
      Files: `api-node/src/services/otpDelivery.ts`,
      `api-node/src/routes/users.ts`.
      Verify: `cd api-node && npm run build` (0 errors). Update/extend
      `mobileSendHonesty.test.ts` (or add `setMobileFallback.test.ts`): assert
      `/mobile/send` NO LONGER returns 503 and now returns a `devOtp` fallback
      when no channel delivered, while `recovery-email/send` KEEPS its 503 and
      `forgot-password/send` keeps its generic 200. Note: the existing
      `mobileSendHonesty.test.ts` asserts `count503 === 2`; this change makes it
      1 (recovery-email only) — update that assertion to `1` and update the
      mobile/send assertions accordingly. Run `npm test` — all pass.

- [ ] 9. **(R1 client auto-fill) Consume the set-mobile fallback OTP on both clients.**
      So a Google user can self-complete set-mobile when mail is down:
      - Web `web/src/components/AddMobilePrompt.tsx` `sendCode()` — the audit
        says `if (data.devOtp) setOtp(...)` is already present; CONFIRM it reads
        the `devOtp` from the new `/mobile/send` response and keep it.
      - Android `mobile/app/complete-profile.tsx` `sendCode()` — currently
        ignores devOtp; add `if (data?.devOtp) setOtp(String(data.devOtp))`
        mirroring R5.
      Files: `web/src/components/AddMobilePrompt.tsx` (confirm only),
      `mobile/app/complete-profile.tsx` (edit).
      Verify: `cd web && npm run build` (0 errors); `cd mobile && npx tsc
      --noEmit`. **FLAG:** native Android build/QA of complete-profile is a
      follow-up (same note as R5).

- [ ] 10. **(R6) POS owner login survives FCM-down — expose fallbackOtp in production when no device got the push.**
      In `routes/pos-auth.ts` `/otp/send` (~line 92-127): today it pushes to
      `tokensForStaff('pos')` and sets `const devOtp = config.env !== 'production'
      ? otp : undefined`. Change so that when the push did NOT reach any device
      (no staff tokens, or `sendToTokens` returned 0), the OTP is ALSO returned
      as `devOtp` in production — i.e. capture the delivered count
      (`const delivered = staffTokens.length ? await sendToTokens(...).catch(() => 0) : 0;`)
      and compute `const devOtp = config.env !== 'production' || delivered < 1 ?
      otp : undefined;`. Keep it keyed/stored exactly as today
      (`email: 'pos:<mobile>'`, `purpose:'pos_login'`), keep the existing
      `rateLimit({ limit:5, windowMs:60_000, bucket:'pos_otp_send' })` and the
      enumeration-safe generic 200 and the active-allowlist gate — the fallback
      only fires AFTER the allowlist check passes, so an unauthorised number
      still never gets an OTP. Keep the pos-login no-downgrade guard untouched.
      This closes audit §5 secondary gap without a new channel.
      Files: `api-node/src/routes/pos-auth.ts`.
      Verify: `cd api-node && npm run build` (0 errors). Add
      `posOtpFallback.test.ts` (source-assertion): assert `/otp/send` exposes the
      OTP when `delivered < 1` (incl. production), still writes `pos:<mobile>` /
      `pos_login`, still returns the generic send message, and the `rateLimit`
      middleware with `bucket:'pos_otp_send'` is still applied. Run `npm test`.

- [ ] 11. **(R7) Android Google-failure routes to the register tab (parity with web R4).**
      In `mobile/app/login.tsx` `startGoogle` (~line 150-166): on the non-cancel
      failure branch (the `catch` after the `SIGN_IN_CANCELLED` early-return) and
      on the empty-`GOOGLE_WEB_CLIENT_ID` "setup pending" branch, call
      `switchMode('register')` in addition to the existing toast, so a total
      Google outage still lands the user on the email/mobile signup form and the
      lead is captured. Keep `SIGN_IN_CANCELLED` silent (user dismissed on
      purpose — not a failure, no redirect). Pure client change.
      Files: `mobile/app/login.tsx`.
      Verify: `cd mobile && npx tsc --noEmit` passes. **FLAG:** native Android
      build/QA is a follow-up (same note as R5).

- [ ] 12. **Full verification sweep + report (owner's hard test gate — MUST be green before review approves / push).**
      The owner explicitly requires unit tests to pass before anything is pushed;
      the orchestrator pushes only after review approves. Run, in order and all
      must be 0-error / all-pass:
      - `cd api-node && npx tsc --noEmit`
      - `cd api-node && npm test` (includes the new focused cases: signup rate
        limit, lead capture, set-mobile fallback, pos-otp fallback)
      - `cd web && npx tsc -b` and `cd web && npm run build`
      - `cd mobile && npx tsc --noEmit`
      Then fill the entry-point table with the OBSERVED down-dependency behaviour
      per entry point: #4 otp/send rate-limited + persists a NAMED lead + exposes
      the fallback both clients consume; #5 mobile/send no longer 503s and both
      clients auto-fill; #7 forgot-password still generic-200; #9 recovery-email
      503 kept (justified); #11 pos /otp/send exposes fallback in prod when no
      device got the push; #3b app Google failure routes to register; checkout
      gate #14 unchanged. Confirm NO migration ran (git diff shows no
      `prisma/migrations` change, no `schema.prisma` edit) and `safeUser` still
      strips secrets. List the native-build follow-ups (R5 Android signup
      auto-fill, R1 Android complete-profile auto-fill, R7 Android Google-fail
      redirect) as outstanding QA.
      Files: none (verification + report only).
      Verify: every command above green; report produced; no schema/migration diff.

---

# Decisions recorded (where this plan chose among viable options)

- **R2 persistence = audit §5c "recommended" no-migration path.** Create the
  lead at otp/send time and treat `last_login IS NULL` as "unverified" rather
  than adding a boolean column — honours the no-migration constraint. (Chosen
  over the "add a name column to email_otps" option, which the audit itself
  rejects as needing a schema change.)
- **R1 OTP key = the existing email-target key with `purpose:'set_mobile'`**, NOT
  a new `mobile:<n>` key. Rationale: the brief requires `/mobile/verify` to keep
  reading the SAME key/purpose it reads today; changing the key would force a
  verify change, which is forbidden. Multi-channel + fallback is layered on top
  of the unchanged key.
- **R1 channel order = EMAIL → FCM → fallbackOtp.** Email stays first so a
  working mailbox still proves possession; FCM reaches the Google user's
  registered device; fallbackOtp (prod included) guarantees the user is never
  trapped — matching the already-shipped mobile-signup tradeoff and staying
  admin-toggleable via `settings.otp_channels`.
- **R4 default client id in code.** The empty `VITE_GOOGLE_CLIENT_ID` is the
  confirmed root cause of "web Google is down"; hardcoding the known-good web
  client id (already in the server audience) as a default, with env override
  preserved, is the minimal durable fix.
- **R3 bucket label `signup_otp_send`** kept distinct from pos's
  `pos_otp_send` so the two never share counters; keys on IP for the
  unauthenticated signup path.
- **R6 POS fallback fires only on genuine non-delivery** (`delivered < 1`),
  AFTER the active-allowlist check — an unauthorised number never receives an
  OTP, and rate-limit + no-downgrade stay intact. Chosen over wiring an SMS
  gateway (no provider exists; that is the audit's TODO, out of scope).
- **R7 app Google-fail → register tab** mirrors web R4 so a total Google outage
  keeps the lead on both clients; `SIGN_IN_CANCELLED` stays silent (deliberate
  user dismissal is not a failure).
- **Owner sweep boundaries:** `forgot-password/send` and `recovery-email/send`
  are intentionally left unchanged (enumeration-safety / optional-auth-gated,
  neither a dead-end nor an entry/checkout path) — see §Owner-sweep decision.

# Gaps / assumptions flagged
- Native Android builds (R5 signup auto-fill, R1 complete-profile auto-fill,
  R7 Google-fail redirect) cannot be built/QA'd in this environment — code edits
  are made and the native build is explicitly a follow-up (per the brief's R5
  instruction).
- `AddMobilePrompt.tsx` is expected to already auto-fill `devOtp`; step 9 only
  CONFIRMS it (and fixes if the audit's claim no longer holds). If the field is
  missing, add it the same way as the Android edit.
- All five fixes avoid any schema/migration need; if the implementer finds a fix
  that appears to require one, STOP and flag rather than migrating.
