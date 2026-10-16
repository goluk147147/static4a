# Verification — Guest Push (no login) + Smart-Link Play Store Fallback + versionCode

Two additive fixes to the 4AStore app + backend, plus a versionCode note. No protected feature
regressed (WhatsApp API, qty-limit, analytics, order full-screen alarm, promo image, Google login,
POS, force-update, free wa.me share all untouched). `admin-laravel/` untouched. No new dependencies.

## Commands run and results (verbatim)

### api-node (`c:\xampp\htdocs\static4a\4astore-v2\api-node`)
- `npm run build` → Exit Code: 0 (tsc clean, 0 errors). Run before AND after the change.
- `npm test` → Exit Code: 0. After the change: `tests 67 / pass 67 / fail 0`
  (baseline was 58; +6 guestPush + 3 smartLink = 9 new, one of which replaced the old inline count).
  New suites: `guestPush.test.ts` (6 cases), `smartLink.test.ts` (3 cases) — all pass.
  No stale Prisma client issue was hit, so `npx prisma generate` was NOT needed.

### web (`c:\xampp\htdocs\static4a\4astore-v2\web`)
- `npm run build` → Exit Code: 0. `✓ built in 5.47s` (0 TS errors). Baseline run also 0 errors
  (`✓ built in 14.30s`). web was not modified; this is a pure regression check.

### mobile (`c:\xampp\htdocs\static4a\4astore-v2\mobile`)
- `npm run typecheck` → Exit Code: 0 (tsc --noEmit, 0 errors).
- `npm run typecheck:tests` → Exit Code: 0 (tsc --noEmit -p tsconfig.test.json, 0 errors).
- `npm test` → Exit Code: 0. `tests 106 / pass 106 / fail 0`
  (baseline 102; +4 from the new `guestPushGate.test.ts`). Existing pushPayload / pushImage /
  qty-limit / force-update / analytics suites still green.

Did NOT run gradle/.aab build, `expo prebuild`, or Metro (per instructions).

## PART 1 — Guest push (no login required)

### Backend — `api-node/src/routes/push.ts`
- `POST /api/push/register` and `POST /api/push/unregister` now use the EXISTING `optionalAuth`
  middleware (from `src/auth/middleware.ts`) instead of `requireAuth`. `optionalAuth` populates
  `req.user` from a valid Bearer/cookie via `verifyAccessToken` but NEVER rejects — a guest is
  never 401'd. `requireAuth` is still imported and used by `/send` and the admin notifications
  router (unchanged).
- The user_id + topics decision was extracted into a pure, dependency-free module
  `api-node/src/services/pushAudience.ts` (`topicsForUser`, `registerIdentity`) so it can be unit
  tested without prisma/Express. Runtime behaviour is identical to the previous inline logic.
  - Authenticated caller → `user_id = BigInt(req.user.sub)`, topics from their role.
  - **Guest** (`req.user` undefined) → `user_id = null`, topics `['all','customers']`.
- `prisma.deviceToken.upsert` uses `user_id: userId` (null for a guest) in BOTH the `create` and
  `update` branches, and in the P2002 race-fallback `update`.
- Topic subscription: `syncTokenTopics(token, topics)` is still called for native tokens. A guest
  gets `['all','customers']` — the EXACT topics the staff customer broadcast (`POST /send` with
  `target` `all`/`customers`) targets. No new topic was invented. So a staff "all" or "customers"
  broadcast now reaches guest devices.
- `/unregister` deleteMany where-clause is now `req.user ? { token, user_id } : { token }`, so a
  guest token (user_id null) is removable by token alone. All inside the existing try/catch.

### Backend topic-audience match (how the broadcast reaches guests)
`routes/push.ts POST /send` selects its audience via `tokensForTopic(target)` where
`target ∈ {all, customers, riders, admins}` (default `all`), and `tokensForTopic` reads
`device_tokens` rows whose `topics` JSON contains that topic. A guest row has
`topics = ['all','customers']`, so it is included in both the `all` and `customers` broadcasts —
no code change to `/send` was needed.

### Later login re-associates the token
`registerForPush()` is idempotent and re-runs on login/role change (see `_layout.tsx` effect with
`[ready, userId, role]` deps). When the user logs in, the SAME FCM token is re-registered with a
valid Bearer, `optionalAuth` populates `req.user`, and the upsert's `update` branch sets
`user_id = BigInt(sub)` + the user's role topics. The guest row is thus promoted in place (same
unique `token`), so order-specific pushes (which target `tokensForUser(user_id)`) now reach it.

### Mobile — `mobile/src/push.ts` + `mobile/src/pushGate.ts` + `mobile/app/_layout.tsx`
- The registration guard no longer requires an access token. The pure decision lives in the new
  dependency-free `mobile/src/pushGate.ts` (`shouldRegisterPush({ hasPush, isDevice })`), called by
  `registerForPush()`. Old guard `!HAS_PUSH || !Device.isDevice || !getAccessToken()` →
  new `!shouldRegisterPush({ hasPush: HAS_PUSH, isDevice: Device.isDevice })`. The `getAccessToken`
  import was removed from `push.ts` as it is no longer used there.
- Notification permission gate is UNCHANGED: still asks `POST_NOTIFICATIONS`; if not granted,
  returns null (no crash). No network/crash when permission denied — the token fetch + POST only
  run after `status === 'granted'` and are wrapped in try/catch.
- The `api.post('/push/register', …)` call is header-less for a guest: `api.ts authHeaders()` only
  adds `Authorization: Bearer …` when an access token is in memory, so the guest register works.
- `_layout.tsx`: the launch registration effect is now gated on `ready` only (was `ready && userId`)
  so a guest launch registers once permission is granted; deps stay `[ready, userId, role]` so a
  later login re-runs it. The AppState "active" resume handler now calls `registerForPush()`
  regardless of login (guest re-asserts its token on resume), while `reloadSession()` + order/catalog
  invalidation stay gated on a logged-in user.
- Notifee channels / even-count-positive vibration patterns untouched. `listenTokenRotation`,
  `unregisterPush`, display paths untouched.

## PART 2 — Smart link opens the app, else Play Store

- `api-node/src/routes/link.ts` `smartRedirectHtml()` + the Android constants (`ANDROID_PACKAGE`,
  `PLAY_STORE_URL`) were moved verbatim into a new dependency-free module
  `api-node/src/services/smartRedirect.ts` (re-imported by `link.ts`). Behaviour is unchanged; the
  move only makes the builder unit-testable without prisma/Express.
- Confirmed the no-app fallback for App-Link-eligible targets (`appPath` present, e.g. `/product/5`)
  is the **Play Store**, not the website: the JS arms `setTimeout(() => location.replace(play), 1200)`
  where `play = https://play.google.com/store/apps/details?id=com.store4a.app`, then sets
  `window.location.href = intent` (`intent://…;package=com.store4a.app;…;end`). If the app is
  installed, the intent opens it and the page is backgrounded; the `pagehide`/`visibilitychange`
  handlers `clearTimeout` the fallback. If NOT installed, the ~1200ms timer fires → Play Store.
- A NON-app custom link (`appPath` null) keeps going straight to its website target
  (`location.replace(target)`), never the Play Store. No `intent://` is built for it.
- `<meta http-equiv="refresh">` and `<noscript>` both still point at the escaped website target for
  a JS-less client. Verified by `smartLink.test.ts`.

### `/link` vs autoVerify decision (NO app.config.ts intentFilters change)
`/link/<code>` short codes are opaque and NOT App-Link claimable, so `/link` deliberately relies on
the server-rendered `intent://` JS above — we did NOT add `/link` to `android.intentFilters` in
`mobile/app.config.ts`. The existing `autoVerify:true` entries (`/product`, `/products`, `/track`,
`/page`, `/orders`, `/cart`) are left exactly as-is. App Links auto-verify applies only to a build
installed with the verified signing key, so direct `/product` deep-links open the app without a
chooser once the user installs the current build; the `/link` smart page works via `intent://`
regardless of build.

### assetlinks.json / signing / package — UNTOUCHED
`assetlinks.json` (already live with both the Play App Signing SHA-256 and the upload-key SHA-256),
the release signing config, and the app package `com.store4a.app` were NOT changed.

## versionCode

Per the parent-session correction: versionCode STAYS at **36** (the vc-36 `.aab` was never uploaded,
so 36 is still unused and will be the single release carrying ALL features). `mobile/app.config.ts`
keeps `Number(process.env.STORE4A_VERSION_CODE || 36)` — the fallback was NOT changed to 37. Only
the adjacent comment was updated to record that 36 now ALSO includes "guest push (no-login token
register) + smart-link Play Store fallback". `versionName` unchanged (`2.0.0`).

## Deployment reminder
- **Guest push** is a mobile change (`push.ts`, `pushGate.ts`, `_layout.tsx`) AND a backend change
  (`push.ts`, `pushAudience.ts`). The mobile side needs a NEW `.aab` at versionCode 36 to ship. The
  backend side ships via the server (`deploy.sh`).
- The **smart-link** fix is entirely server-side (`link.ts` / `smartRedirect.ts`) and ships via
  `deploy.sh` — it needs NO app rebuild.

## Files changed
- `api-node/src/routes/push.ts` (optionalAuth + guest user_id/topics via registerIdentity)
- `api-node/src/services/pushAudience.ts` (NEW — pure: topicsForUser, registerIdentity)
- `api-node/src/routes/link.ts` (import smartRedirectHtml from the pure module)
- `api-node/src/services/smartRedirect.ts` (NEW — pure: smartRedirectHtml, constants)
- `api-node/src/__tests__/guestPush.test.ts` (NEW)
- `api-node/src/__tests__/smartLink.test.ts` (NEW)
- `mobile/src/push.ts` (guest-capable guard via shouldRegisterPush; drop getAccessToken gate)
- `mobile/src/pushGate.ts` (NEW — pure gate)
- `mobile/app/_layout.tsx` (register on launch/resume regardless of login)
- `mobile/src/__tests__/guestPushGate.test.ts` (NEW)
- `mobile/app.config.ts` (versionCode comment only — number stays 36)
- `.agents/tasks/guest-push-smartlink-verification.md` (this note)
