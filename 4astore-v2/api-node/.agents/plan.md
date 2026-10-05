# Implementation Plan — Real Google Sign-In (web + mobile) + hide Facebook/Instagram

All paths are absolute, inside the worktree `c:\xampp\htdocs\static4a\.worktrees\google-login-both`.
Git ops use `git -C c:\xampp\htdocs\static4a\.worktrees\google-login-both`.

## Context discovered during exploration

- **API** (`...\4astore-v2\api-node`): Express + TS + Prisma + MySQL. `src\routes\users.ts` holds `/login`, `/register`, `/refresh`, forgot/reset, and the private `issueTokens(res, user, deviceLabel?)` helper + `isMobileClient(req)` (reads `X-Client: mobile`) + `safeUser()`. Router mounted at `/api/users` in `src\server.ts`. `issueTokens` expects a user object with `{ id, role, mobile, username, name, permissions, backend_rider }` and sets access+refresh cookies; it returns `{ accessToken, refreshToken, claims }`. `/login` responds `ok(res, { user: safeUser(user), token: accessToken, ...(isMobileClient ? { refreshToken } : {}) })`. Build = `npm run build` (tsc). Prisma `User` model has nullable `email` AND `recovery_email`; `mobile` + `username` are UNIQUE NOT NULL; `plain_password` is a raw runtime column (NOT a Prisma field — never select it). Response envelope: `ok()` / `fail()` from `src\utils\http.ts`.
- **WEB** (`...\4astore-v2\web`): Vite + React. `src\pages\Login.tsx` has three gated social buttons + `socialLogin()` toast stub, reads `import.meta.env.VITE_*`. Shared axios in `src\lib\api.ts` (`api`, base `VITE_API_BASE||'/api'`, `withCredentials`). Auth store `src\store\auth.ts` `login()` does `setAccessToken(data.token); set({ user: data.user })`. `showToast` from `src\store\toast`. `index.html` has no social script tags. Build = `npm run build`.
- **MOBILE** (`...\4astore-v2\mobile`): Expo SDK 54 (`expo ~54.0.37`, RN 0.81, `newArchEnabled: true`), config-plugin build (prebuild + gradle). `app\login.tsx` has three gated social buttons + `socialLogin()` toast stub + `done(user)` (runs `registerForPush()` then routes). `src\config.ts` reads `Constants.expoConfig.extra` → `GOOGLE_CLIENT_ID` etc. `src\store\auth.ts` `login()`: `setAccessToken; saveRefreshToken(data.refreshToken); set user; return user`. `src\api.ts` `api.post` sends `X-Client: mobile`. `app.config.ts` `extra` currently exposes `googleClientId/facebookAppId/instagramAppId` from `STORE4A_*`. App `scheme: 'fourastore'` already set (required for auth-session redirect). Build/verify = `npm run typecheck` + `npm test` (node test runner).

## Design decisions

- **Reuse `issueTokens`** rather than re-implementing token issuance, so social login returns the identical `{ user, token, refreshToken? }` shape honoring `isMobileClient(req)`. (Avoids drift from `/login`.)
- **Google ID-token verification** uses the official `google-auth-library` (pinned) `OAuth2Client.verifyIdToken` with `audience: [GOOGLE_WEB_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID]` so both platforms' tokens are accepted by one endpoint.
- **Upsert key = email**: match an existing user by `email = payload.email OR recovery_email = payload.email` (register writes `recovery_email`, so both must be checked). New users get `email` set to the Google email and `recovery_email_verified = true` is NOT assumed on `email`; store the verified Google email in `recovery_email` too so forgot-password works. Rationale below in step 2.
- **Placeholder mobile** for Google-created users: a `g<digits-from-sub>` style value that can never equal a real `[6-9]\d{9}` mobile. Retry with suffix on UNIQUE collision.
- **WEB uses Google Identity Services via `<script>`** (no new web dep), per constraint.
- **MOBILE uses `expo-auth-session`** (`~7.0.11`) + `expo-web-browser` (`~15.0.11`) + `expo-crypto` (`~15.0.9`) — all official Expo SDK 54 managed/config-plugin packages, autolinked, included in Expo Go, NO bare native module. **Build-safe decision: SHIP.** See step 7 for the mandatory re-verification the coder must perform before committing; if prebuild/gradle breaks, gate mobile Google and report (do not break the APK).

---

## PART 1 — Server endpoint

- [ ] 1. Add `google-auth-library` as a pinned dependency and verify the API still builds.
      Install exact current stable (resolve the version then pin it, no `^`): run `npm install google-auth-library@<latest-stable> --save-exact` in `...\api-node`. Confirm `package.json` + `package-lock.json` updated.
      Files: `c:\xampp\htdocs\static4a\.worktrees\google-login-both\4astore-v2\api-node\package.json`, `...\api-node\package-lock.json`
      Verify: `npm run build` in `...\api-node` exits 0 (tsc clean).

- [ ] 2. Add `POST /users/social-login` to the users router, reusing `issueTokens`.
      Public route (no `requireAuth`). Zod body `{ provider: z.literal('google'), idToken: z.string().min(1) }` with a pre-check: if `req.body.provider` is present but not `'google'`, return `fail(res, 'Unsupported provider', 400)`. Verify the token with a module-level `new OAuth2Client()` → `client.verifyIdToken({ idToken, audience: [GOOGLE_WEB_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID] })`; on any throw return `fail(res, 'Invalid Google token', 401)`. Read `const p = ticket.getPayload()`; require `p?.email_verified === true && p.email` else `fail(res, 'Invalid Google token', 401)`. Upsert: `prisma.user.findFirst({ where: { OR: [{ email: p.email }, { recovery_email: p.email }] } })`. If none, create a customer via a helper `createGoogleUser(p)`: `name = p.name || p.email.split('@')[0]`; `email = p.email`; `recovery_email = p.email`; `recovery_email_verified = true`; `username` = unique handle from the email local-part (lowercased, non-alphanumerics stripped, min length enforced) with a numeric suffix if taken; `mobile` = non-colliding placeholder `'g' + <digits derived from p.sub>` truncated/padded so it is NOT a 10-digit `[6-9]...` number and is `<=15` chars; `password = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10)`; `role = 'customer'`; `registered_at = new Date()`; `last_login = new Date()`. Wrap create in a retry loop (max ~5) that re-suffixes `username`/`mobile` on Prisma P2002 UNIQUE errors so it never crashes. For an existing user, `prisma.user.update` set `last_login`. Finally `const { accessToken, refreshToken } = await issueTokens(res, user, isMobileClient(req) ? 'mobile-app' : undefined); return ok(res, { user: safeUser(user), token: accessToken, ...(isMobileClient(req) ? { refreshToken } : {}) })`.
      Env read: at top of `users.ts` add `const GOOGLE_WEB_CLIENT_ID = process.env.GOOGLE_WEB_CLIENT_ID || '707085023016-etp7au34rg3cd5eks6cdu0cs0vkj1svn.apps.googleusercontent.com'` and `const GOOGLE_ANDROID_CLIENT_ID = process.env.GOOGLE_ANDROID_CLIENT_ID || '707085023016-pc4gc5271kquti6recqo9juor3p44dn9.apps.googleusercontent.com'`. Import `OAuth2Client` from `google-auth-library` and `crypto` from `node:crypto`.
      Files: `c:\xampp\htdocs\static4a\.worktrees\google-login-both\4astore-v2\api-node\src\routes\users.ts`
      Verify: `npm run build` in `...\api-node` exits 0. Then runtime smoke: with a fake token, `POST /api/users/social-login { provider:'google', idToken:'x' }` returns 401 `Invalid Google token`; `{ provider:'facebook', idToken:'x' }` returns 400. (Dev server optional — tsc clean is the gating check.)

- [ ] 3. Document the two accepted audiences in `.env.example`.
      Append a `# ---- Google Sign-In (social login) ----` block with `GOOGLE_WEB_CLIENT_ID=707085023016-etp7au34rg3cd5eks6cdu0cs0vkj1svn.apps.googleusercontent.com` and `GOOGLE_ANDROID_CLIENT_ID=707085023016-pc4gc5271kquti6recqo9juor3p44dn9.apps.googleusercontent.com` with a comment that these are the two `aud` values the server accepts and that client IDs are not secrets.
      Files: `c:\xampp\htdocs\static4a\.worktrees\google-login-both\4astore-v2\api-node\.env.example`
      Verify: file contains both keys (visual) and `npm run build` still exits 0.

## PART 2 — WEB Google Sign-In + hide Facebook/Instagram

- [ ] 4. Add the Google Identity Services script loader (no new dep).
      Load `https://accounts.google.com/gsi/client` only when `VITE_GOOGLE_CLIENT_ID` is set. Prefer a small dynamic loader inside `Login.tsx` (append the `<script async defer>` once in a `useEffect`, resolve on load) over a static tag so the script never loads when the id is empty. Document `VITE_GOOGLE_CLIENT_ID` in `web\.env.example`.
      Files: `c:\xampp\htdocs\static4a\.worktrees\google-login-both\4astore-v2\web\src\pages\Login.tsx`, `c:\xampp\htdocs\static4a\.worktrees\google-login-both\4astore-v2\web\.env.example`
      Verify: `npm run build` in `...\web` exits 0.

- [ ] 5. Wire the real GIS flow and hide Facebook/Instagram in `Login.tsx`.
      Replace the Google button's `socialLogin('Google', ...)` stub path: when `GOOGLE_CLIENT_ID` is set, after the loader resolves call `window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback })` once, and trigger the flow on button click (`google.accounts.id.prompt()`, or render a hidden GIS button and click it; choose prompt() for minimal DOM change). The `callback` receives `{ credential }` → `await api.post('/users/social-login', { provider: 'google', idToken: credential })` → `setAccessToken(data.token); useAuth.getState().setUser(data.user)` (reuse the store's setters exactly like `login()`), then `navigate(next)`. On error `showToast(apiError(err), 'error')`. If `GOOGLE_CLIENT_ID` is empty keep the existing gated "setup pending" toast. REMOVE the Facebook and Instagram buttons from render; keep their constants/plumbing behind a `const SOCIAL_FB_IG_ENABLED = false; // Facebook/Instagram login hidden until OAuth setup complete — re-enable later`. Keep the "or continue with" divider and the Google button's existing bilingual label + styling.
      Files: `c:\xampp\htdocs\static4a\.worktrees\google-login-both\4astore-v2\web\src\pages\Login.tsx` (and a `src\types` or inline `declare global` for `window.google` typing — add a minimal `declare global { interface Window { google?: any } }` in `Login.tsx`)
      Verify: `npm run build` in `...\web` exits 0 and the bundle has no Facebook/Instagram button JSX (visual check of the diff). Login/register/forgot forms untouched.

## PART 3 — MOBILE Google Sign-In + hide Facebook/Instagram

- [ ] 6. Expose the two client IDs via `app.config.ts` `extra` and read them in `src\config.ts`.
      In `app.config.ts` `extra` add `googleWebClientId: process.env.STORE4A_GOOGLE_WEB_CLIENT_ID || '707085023016-etp7au34rg3cd5eks6cdu0cs0vkj1svn.apps.googleusercontent.com'` and `googleAndroidClientId: process.env.STORE4A_GOOGLE_ANDROID_CLIENT_ID || '707085023016-pc4gc5271kquti6recqo9juor3p44dn9.apps.googleusercontent.com'` (keep the existing `googleClientId/facebookAppId/instagramAppId`). In `src\config.ts` add to the `extra` type + export `GOOGLE_WEB_CLIENT_ID` and `GOOGLE_ANDROID_CLIENT_ID`.
      Files: `c:\xampp\htdocs\static4a\.worktrees\google-login-both\4astore-v2\mobile\app.config.ts`, `...\mobile\src\config.ts`
      Verify: `npm run typecheck` in `...\mobile` exits 0.

- [ ] 7. **BUILD-SAFETY DECISION POINT** — add expo-auth-session deps and confirm prebuild is safe.
      Install the SDK-54-pinned trio: `npx expo install expo-auth-session expo-web-browser expo-crypto` in `...\mobile` (expected: expo-auth-session `~7.0.11`, expo-web-browser `~15.0.11`, expo-crypto `~15.0.9`). These are managed/config-plugin, autolinked, no bare native module. BEFORE wiring UI, the coder MUST confirm no build risk: run `npm run typecheck` (0 errors) AND `npx expo prebuild --platform android --clean --no-install` and confirm it completes without error. If prebuild succeeds → proceed to step 8 (SHIP). If prebuild or gradle config fails, or any native-linking error appears, STOP: revert the dep additions, leave the mobile Google button gated (web Google still ships), and `send_message` severity `warning` describing the failure. Do NOT risk the APK build.
      Files: `c:\xampp\htdocs\static4a\.worktrees\google-login-both\4astore-v2\mobile\package.json`, `...\mobile\package-lock.json`
      Verify: `npm run typecheck` exits 0 AND `npx expo prebuild --platform android --clean --no-install` completes without error. (Clean up generated `android/` dir afterward if prebuild created it and it is not tracked: `git -C <worktree> status` should not show stray untracked native dirs committed.)

- [ ] 8. Wire expo-auth-session Google flow and hide Facebook/Instagram in `app\login.tsx`.
      At module top call `WebBrowser.maybeCompleteAuthSession()`. Use `Google.useAuthRequest` from `expo-auth-session/providers/google` with `{ webClientId: GOOGLE_WEB_CLIENT_ID, androidClientId: GOOGLE_ANDROID_CLIENT_ID, responseType: 'id_token', scopes: ['openid','email','profile'] }` to obtain a Google **ID token** (not access token). On a successful response read the id_token from `response.params.id_token` (or `response.authentication?.idToken`), then `const data = await api.post('/users/social-login', { provider:'google', idToken })`; set the session via the SAME path as `login()` in `src\store\auth.ts` — reuse the store (`useAuth.getState().setUser` + `setAccessToken` + `saveRefreshToken` from `src\api`), OR add a `socialLogin(idToken)` action to `src\store\auth.ts` that mirrors `login()` exactly and returns the normalized user — prefer adding the store action for parity. Then call the existing `done(user)` so `registerForPush()` + routing run unchanged. On error `showToast(apiError(e), 'error')`. REMOVE the Facebook and Instagram `<Pressable>` buttons from `SocialBlock`; gate the remaining plumbing behind `const SOCIAL_FB_IG_ENABLED = false; // Facebook/Instagram login hidden until OAuth setup complete — re-enable later`. Keep the divider and the Google button's bilingual label + styling. If step 7 chose to gate (build-unsafe), instead leave the Google button on its existing "setup pending" toast and still hide Facebook/Instagram.
      Files: `c:\xampp\htdocs\static4a\.worktrees\google-login-both\4astore-v2\mobile\app\login.tsx`, `...\mobile\src\store\auth.ts` (add `socialLogin` action)
      Verify: `npm run typecheck` in `...\mobile` exits 0 AND `npm test` passes. Login/register/forgot flows untouched.

## PART 4 — Integration & regression verification

- [ ] 9. Full cross-platform verification.
      Run API build, web build, and mobile typecheck+tests together; confirm existing login/register/forgot-password, tracking, rider, payments code is untouched (diff review — only the files listed above changed, plus deps).
      Files: none (verification only)
      Verify: `npm run build` in `...\api-node` (0), `npm run build` in `...\web` (0), `npm run typecheck` (0) and `npm test` in `...\mobile`. `git -C c:\xampp\htdocs\static4a\.worktrees\google-login-both status` shows only intended changes.

## Notes / assumptions

- The verified Google email is written to BOTH `email` and `recovery_email` (with `recovery_email_verified=true`) on new Google users so the existing forgot-password/recovery flow (which keys off `recovery_email`) works for them.
- Client IDs are embedded as documented defaults (not secrets) but read from env first, per the task.
- Mobile ships Google only if step 7's prebuild check passes; otherwise mobile Google stays gated and the coder reports via `send_message` — web Google still ships either way.
