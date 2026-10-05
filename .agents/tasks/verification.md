# Verification — Web Login: Forgot Password + Social Login

## Scope implemented
- `4astore-v2/web/src/pages/Login.tsx` — ADDED Forgot Password flow + gated social
  login buttons. Existing login + register flows left intact (same handlers, same
  endpoints `/users/login`, `/otp/send`, `register()`), only their mode-toggle links
  now call the shared `switchMode()` helper.
- `4astore-v2/web/src/vite-env.d.ts` — added three OPTIONAL env type declarations
  (`VITE_GOOGLE_CLIENT_ID?`, `VITE_FACEBOOK_APP_ID?`, `VITE_INSTAGRAM_APP_ID?`) so the
  `import.meta.env` reads type-check. No index-signature change, no behavior change.

No server change, no mobile change, no new npm dependency.

## Commands run (in `4astore-v2/web`)
1. `npm install` — initially skipped devDependencies because the shell had
   `NODE_ENV=production` (tsc/vite are devDependencies). Re-ran as:
2. `npm install --include=dev` (with `NODE_ENV=development`) — **PASS**, 173 packages
   audited, typescript + vite present.
3. `npm run build` (= `tsc -b && vite build`) with `NODE_ENV=development` — **PASS**.
   - `tsc -b`: completed with no TypeScript errors.
   - `vite build`: `✓ 718 modules transformed`, `✓ built in ~13.9s`, exit code 0.

## New vs existing warnings
- The only build warning is the pre-existing Vite chunk-size notice ("Some chunks are
  larger than 500 kB after minification"). It is unrelated to this change (large
  vendor bundles: jspdf, html2canvas, leaflet, tesseract) and appears regardless of
  the Login.tsx edits. **No new TS errors and no new warnings introduced.**

## Manual behavior notes (not re-run by reviewer)
- Forgot link "Forgot password? / पासवर्ड भूल गए?" appears under the password field in
  login mode and switches to the reset panel via `switchMode('forgot')`.
- Reset step 1: identifier → `POST /users/forgot-password/send { identifier }` → info
  toast "Reset code ... registered email". Step 2: 6-digit OTP (digits-only via
  `replace(/\D/g,'')`, maxLength 6) + `PasswordInput` new password →
  `POST /users/reset-password { identifier, otp, newPassword }` → success toast
  "Password reset ✅ — ab login karein" and returns to login with the identifier
  prefilled. A 422 surfaces the server's "Invalid or expired code" in the `.error` box
  via `apiError`.
- Helper line "Email nahi hai? Store se contact karein: 7543888698" present.
- Social buttons (Google white+G, Facebook #1877F2, Instagram gradient) are
  `type="button"`, read `VITE_*` creds (default `''`), and `socialLogin()` always shows
  "<Provider> login setup pending — admin se contact karein" and no-ops. Comment notes
  the future `POST /users/social-login` (endpoint does not exist yet). No OAuth SDK,
  no new dep, no crash.

## Build command note for the server/CI
`tsc`/`vite` live in `devDependencies`. If the deploy shell sets `NODE_ENV=production`,
`npm install` / `npm ci` will skip them and the build will fail with
`'tsc' is not recognized`. Use `npm ci --include=dev` (or unset `NODE_ENV`) before
`npm run build`.
