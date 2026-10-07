# Implementation Plan — Identity + Checkout Fixes (4A Store v2)

Scope: Issues 1, 2, 3, 6 from `.agents/tasks/login-address-invoice-audit.md`.
Worktree (absolute): `c:\xampp\htdocs\static4a\.worktrees\identity-checkout-fixes\4astore-v2`.
Do NOT touch notification code or the `.worktrees/notifee-rich-push` worktree. Ignore legacy `4AStoreApp` and PHP `/api`.

Design decisions (grounded in the code read):
- Issue 1 login fix inlines the same 4-way `OR` already used by `findUserByIdentifier()` (users.ts) rather than calling that helper, so the login path stays explicit and self-contained; identifier is lowercased for username/email/recovery_email and passed as-is for mobile. Reason: matches the existing forgot-password pattern exactly, no behavior drift, 1 DB round-trip.
- Issue 6 adds two auth-gated endpoints modeled byte-for-byte on `recovery-email/send` + `recovery-email/verify`, with a NEW `EmailOtp.purpose = 'set_mobile'` (never reuse `/otp/send`'s `'signup'`). Reason: the recovery-email handlers are the proven template for "email an OTP → verify → update the user row"; a distinct purpose keeps signup/recovery/set-mobile OTPs from cross-validating.
- Issue 3 extracts the save payload/build logic so `proceed()` persists an inline-entered address exactly like `saveFromEditor` does, guarded so an already-selected saved address is never double-saved.
- Testability: the mobile test harness (`npm test`) only loads pure-TS modules under `mobile/src/__tests__/**` with `../api` + AsyncStorage mocked; it does NOT render React screens. So new testable logic for Issues 3 and 6 is placed in small pure helpers under `mobile/src/` and unit-tested there; the `.tsx` wiring is verified by `npm run typecheck`.

Verification commands (discovered during exploration):
- api-node: `npm run build` (tsc) and `npx prisma validate` — run in `api-node/`.
- mobile: `npm run typecheck` (ignore the known `usesCleartextTraffic` config-types error) and `npm test` — run in `mobile/`.

---

- [ ] 1. Issue 1 (server) — login must accept email/recovery_email.
      In `POST /users/login`, change the `prisma.user.findFirst` lookup from `OR: [{ username: username.toLowerCase() }, { mobile: username }]` to the 4-way OR `[{ username: lower }, { mobile: username }, { email: lower }, { recovery_email: lower }]` where `lower = username.toLowerCase()`. Update the `loginSchema` comment to "username OR mobile OR email". Keep the password check, rider gate, `last_login` update, and token issuance unchanged.
      Files: `api-node/src/routes/users.ts`
      Verify: `cd api-node && npm run build && npx prisma validate` — compiles clean, schema valid.

- [ ] 2. Issue 1 (mobile, cosmetic) — relabel login identifier field.
      In the `mode === 'login'` branch, change the `Field` label from `"Username or Mobile"` to `"Username, Mobile or Email"` and add `keyboardType="email-address"`. No logic change (value is already sent as-is via `useAuth().login`).
      Files: `mobile/app/login.tsx`
      Verify: `cd mobile && npm run typecheck` — no new errors (ignore the known `usesCleartextTraffic` error).

- [ ] 3. Issue 6 (server) — add email-OTP mobile-capture endpoints.
      Add two auth-gated routes to `users.ts`, modeled on `recovery-email/send` + `recovery-email/verify`:
      (a) `POST /users/mobile/send` (requireAuth): load the user, pick `recovery_email || email` as the target; if no target email, return a friendly 400; generate a 6-digit `EmailOtp` with `purpose: 'set_mobile'`, 10-min expiry, email it via `sendMail`; return `{ message, devOtp? }` (devOtp only when `config.env !== 'production'`, mirroring recovery-email/send).
      (b) `POST /users/mobile/verify` (requireAuth): zod body `{ mobile: /^[6-9]\d{9}$/, otp: /^\d{6}$/ }`; find the latest unconsumed `set_mobile` `EmailOtp` for the target email (`recovery_email || email`), reject on mismatch/expiry (422); in a try/catch call `prisma.user.update({ data: { mobile } })` and catch Prisma `P2002` → return 409 "This mobile number is already registered to another account."; mark the OTP consumed; return refreshed `safeUser`. No DB migration (columns exist; `mobile` is already `@unique`).
      Files: `api-node/src/routes/users.ts`
      Verify: `cd api-node && npm run build && npx prisma validate` — compiles clean, schema valid.

- [ ] 4. Issue 6 (mobile, pure helper + tests) — placeholder-mobile detection.
      Add `mobile/src/profileGate.ts` exporting `needsRealMobile(user)` returning `true` when the user exists and `user.mobile` fails `/^[6-9]\d{9}$/` (catches the `g<digits>` placeholder and empty), else `false`. Add `mobile/src/__tests__/profileGate.test.ts` (node:test, following `addresses.test.ts` style) covering: valid 10-digit mobile → false; `g123…` placeholder → true; empty/undefined → true/false as specified; null user → false.
      Files: `mobile/src/profileGate.ts`, `mobile/src/__tests__/profileGate.test.ts`
      Verify: `cd mobile && npm test` — new profileGate tests pass; `npm run typecheck` clean.

- [ ] 5. Issue 6 (mobile, UI) — "Complete your profile" mobile-capture gate.
      Add `mobile/app/complete-profile.tsx`: a screen that collects a 10-digit mobile, calls `POST /users/mobile/send`, shows an OTP field, calls `POST /users/mobile/verify { mobile, otp }`, and on success calls `useAuth().reloadSession()` then navigates home. Reuse the email-OTP UI pattern (`sendOtp` + OTP `Field`) and UI components from `app/login.tsx`. Trigger it from `app/_layout.tsx` after `ready`: when `needsRealMobile(user)` is true, `router.replace('/complete-profile')` once per app launch (guard with a ref so it is non-nagging and never loops once a valid mobile is set). Do not block other navigation when the mobile is already valid.
      Files: `mobile/app/complete-profile.tsx`, `mobile/app/_layout.tsx`
      Verify: `cd mobile && npm run typecheck` — no new errors; `npm test` still green.

- [ ] 6. Issue 3 (mobile, pure helper + tests) — shared address payload builder.
      Extract the payload-shaping logic from `saveFromEditor` into `mobile/src/addressPayload.ts`: a pure `buildAddressPayload(customer, label, selectedId)` returning the exact `{ action, id, label, receiver_name, phone, house_no, landmark, city, district:'Aurangabad', state:'Bihar', pincode, latitude, longitude, full_address }` object the current code posts (negative/absent `selectedId` → `action:'create', id:undefined`; positive → `action:'update', id`). Add `mobile/src/__tests__/addressPayload.test.ts` covering create vs update id handling and full_address composition.
      Files: `mobile/src/addressPayload.ts`, `mobile/src/__tests__/addressPayload.test.ts`
      Verify: `cd mobile && npm test` — new tests pass.

- [ ] 7. Issue 3 (mobile, wiring) — persist inline address on proceed().
      Refactor `saveFromEditor` to use `buildAddressPayload` (no behavior change). In `proceed()`, after validation passes and before `setPayOpen(true)`, when there is no positive `selectedId` (address came from the inline form), persist it the same way `saveFromEditor` does: optimistic `upsertLocal(userId, addr)` + background `api.post('/addresses', buildAddressPayload(...))` with the same reconcile/`queuePending` fallback. Guard so an existing selected (`selectedId > 0`) address is NOT re-saved. Keep payment opening instant (do not await the network write).
      Files: `mobile/app/checkout.tsx`
      Verify: `cd mobile && npm run typecheck` — clean; `npm test` green (addresses + addressPayload tests).

- [ ] 8. Issue 2 (mobile, optional polish) — show known email as confirmed.
      In the checkout address editor, when `user.recovery_email || user.email` exists, render it as read-only/confirmed text (with a small "change" affordance that flips it back to the editable `Field`) instead of a bare editable prompt. Keep email optional and non-blocking — do NOT add validation or make it required.
      Files: `mobile/app/checkout.tsx`
      Verify: `cd mobile && npm run typecheck` — clean; `npm test` green.

- [ ] 9. Version bump — set versionCode to 25.
      In `app.config.ts` change the `VERSION_CODE` default from `23` to `25` (`Number(process.env.STORE4A_VERSION_CODE || 25)`). NOTE FOR OWNER: the Notifee rich-push branch uses versionCode 24 on a SEPARATE worktree (`.worktrees/notifee-rich-push`); coordinate merge/build order so the final AAB contains BOTH this change set and the Notifee change — whichever merges last must keep versionCode at 25 (highest).
      Files: `mobile/app.config.ts`
      Verify: `cd mobile && npm run typecheck` — clean.

- [ ] 10. Final verification — full build + tests, both packages.
      Run the complete verification suite and confirm green.
      Files: (none)
      Verify: `cd api-node && npm run build && npx prisma validate` AND `cd mobile && npm run typecheck && npm test` — api-node builds + schema valid; mobile typecheck clean (ignore the known `usesCleartextTraffic` config-types error) and all unit tests pass.

---

## Deploy / coordination notes
- Issue 1 (login OR) and Issue 6 server endpoints require an `api-node` deploy.
- Issues 3, 6 (mobile UI), and the version bump require a mobile rebuild (`npm run prebuild && npm run build:aab`).
- Issue 2 is optional polish; no functional dependency.
- Identity stability (Issues 1 + 6) is the thread that makes saved addresses (Issue 3) reliably reappear — land them together.
- Notifee (versionCode 24) is a separate branch; the owner must coordinate the final merge so both change sets ship in one AAB at versionCode 25.
