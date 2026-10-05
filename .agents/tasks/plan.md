# Implementation Plan — Web Login: Forgot Password + Social Login

Add Forgot Password and gated social login (Google, Facebook, Instagram) to the web app's
login page, mirroring the mobile implementation. ADD only — keep existing login + register
flows working exactly as-is. No server changes, no mobile changes, no new npm dependency.

## Facts established during exploration (ground truth for the implementer)

- **Only file to edit:** `4astore-v2/web/src/pages/Login.tsx` (worktree abs path:
  `c:\xampp\htdocs\static4a\.worktrees\web-login-forgot-social\4astore-v2\web\src\pages\Login.tsx`).
  No helper file is needed — everything required already exists.
- **API/fetch helper:** `../lib/api` exports an **axios instance `api`**. Signature used
  everywhere: `api.post(url, body)` returning `{ data }` (e.g. `const { data } = await api.post('/otp/send', { email })`).
  `apiError(err)` turns an axios error into the server's `message` string for display.
  Login.tsx already imports both: `import { api, apiError } from '../lib/api';`.
- **Base URL:** handled inside the axios instance — `const BASE = import.meta.env.VITE_API_BASE || '/api'`
  (`src/lib/api.ts`). So call paths are **relative to `/api`**: use `'/users/forgot-password/send'`
  and `'/users/reset-password'` (NOT the full `/api/...`). This matches how `../store/auth.ts`
  calls `'/users/login'`. Do NOT hardcode the base.
- **Token / session:** Login.tsx does NOT touch the token itself. The `../store/auth` store
  (`useAuth`) handles it: `login()`/`register()` call `setAccessToken(data.token)` internally.
  The reset flow does NOT log the user in — it ends by returning to the login form (prefilled),
  so **no token handling is added**. Leave auth/session handling untouched.
- **Password field:** reuse `PasswordInput` (already imported) for the new-password field —
  `<PasswordInput value={...} onChange={(e)=>...} autoComplete="new-password" />`.
- **Toasts:** the web toast mechanism is `showToast(message, type)` from `../store/toast`
  (`type` is `'success' | 'error' | 'info'`), already rendered globally by `components/Toasts.tsx`
  and used by Orders.tsx / Profile.tsx. This is the web equivalent of mobile's `showToast`.
  Add `import { showToast } from '../store/toast';`.
- **Backend (confirmed in `api-node/src/routes/users.ts`, DO NOT CHANGE):**
  - `POST /users/forgot-password/send` body `{ identifier }` → always 200, generic message
    (enumeration-safe). `identifier` = username | mobile | email.
  - `POST /users/reset-password` body `{ identifier, otp, newPassword }` → 200 on success;
    **422 with message `'Invalid or expired code'`** on bad/expired OTP (surfaced via `apiError`).
    Server requires `otp` = exactly 6 digits, `newPassword` min length 4.
  - `POST /users/social-login` does **NOT** exist — social buttons must no-op (comment only).
- **Env vars (web):** read with `import.meta.env.VITE_GOOGLE_CLIENT_ID` /
  `VITE_FACEBOOK_APP_ID` / `VITE_INSTAGRAM_APP_ID`, each defaulting to `''`. (`.env.example`
  currently lists only `VITE_API_BASE`; no new dep, just read these optional vars.)
- **Mode state:** Login.tsx currently uses `const [mode, setMode] = useState<'login' | 'register'>('login')`.
  Mirror mobile by widening to `'login' | 'register' | 'forgot'`.
- **Styling conventions in Login.tsx:** className-based (`.form-card`, `.field`, `.btn`,
  `.btn-block`, `.btn-outline`, `.error`, `.muted`) plus small inline `style={{...}}` objects
  and `var(--primary)`. Match these; do NOT introduce a UI library or new CSS files (small
  inline styles for the social buttons are fine, consistent with existing inline styles).

## Items

- [ ] 1. Widen the `mode` union and add forgot-password state + a `switchMode` reset helper.
      In `Login.tsx`, change `useState<'login' | 'register'>` to
      `useState<'login' | 'register' | 'forgot'>`. Add state: `const [resetId, setResetId] = useState('')`
      and `const [resetPassword, setResetPassword] = useState('')` (reuse the existing `otp`/`setOtp`
      and `otpSent`/`setOtpSent` for the reset code, exactly as mobile does). Add
      `function switchMode(m: 'login' | 'register' | 'forgot') { setMode(m); setError('');
      setOtpSent(false); setOtp(''); setResetId(''); setResetPassword(''); }` and use it for the
      existing login⇄register link toggles too (replaces the inline `setMode(...); setError('')`).
      Add imports: `import { showToast } from '../store/toast';`.
      Files: `4astore-v2/web/src/pages/Login.tsx`
      Verify: `npm run build` (in `4astore-v2/web`) — TypeScript compiles with no errors.

- [ ] 2. Add the two reset handlers (`sendResetOtp`, `submitReset`) mirroring mobile’s logic.
      `sendResetOtp`: `await api.post('/users/forgot-password/send', { identifier: resetId.trim() })`,
      then `setOtpSent(true); setOtp('')` and
      `showToast('Reset code aapke registered email par bheja gaya. / Reset code sent to your registered email.', 'info')`.
      `submitReset`: `await api.post('/users/reset-password', { identifier: resetId.trim(), otp: otp.trim(), newPassword: resetPassword })`,
      then `showToast('Password reset ✅ — ab login karein. / Log in with your new password.', 'success')`,
      prefill login via `setUsername(resetId.trim())`, and `switchMode('login')`. Both wrap in
      `setBusy(true); setError('')` ... `catch (err) { setError(apiError(err)); } finally { setBusy(false); }`
      so the 422 `'Invalid or expired code'` server message shows in the existing `.error` box.
      Files: `4astore-v2/web/src/pages/Login.tsx`
      Verify: `npm run build` — compiles clean (handlers referenced in item 4’s JSX).

- [ ] 3. Add the gated social-login handler and env reads.
      Near the top of the component (or module), read creds:
      `const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';`
      (same for `FACEBOOK_APP_ID` ← `VITE_FACEBOOK_APP_ID`, `INSTAGRAM_APP_ID` ← `VITE_INSTAGRAM_APP_ID`).
      Add `function socialLogin(provider: 'Google' | 'Facebook' | 'Instagram', clientId: string)` that,
      for any empty-or-present cred, shows
      `showToast(`${provider} login setup pending — admin se contact karein. / ${provider} login setup pending — please contact admin.`, 'info')`
      and returns (no OAuth round-trip, no crash). Add a code comment:
      `// TODO: future — POST /users/social-login (endpoint does not exist yet); buttons no-op until then.`
      Files: `4astore-v2/web/src/pages/Login.tsx`
      Verify: `npm run build` — compiles clean.

- [ ] 4. Add the "Forgot password?" link in login mode and the full forgot-password panel.
      Under the password `<div className="field">` in the login `<form>`, add a right-aligned link:
      `<a onClick={() => switchMode('forgot')} style={{ color: 'var(--primary)', cursor: 'pointer', display:'block', textAlign:'right', marginBottom: 8 }}>Forgot password? / पासवर्ड भूल गए?</a>`.
      Add a third branch to the existing `mode === 'login' ? (...) : (...)` conditional — turn it into
      `mode === 'login' ? (...) : mode === 'register' ? (...) : (<forgot form>)`. The forgot form (a
      `<form onSubmit={(e)=>{e.preventDefault(); otpSent ? submitReset() : sendResetOtp();}}>` using
      `.field`/`.btn` classes) contains, mirroring mobile:
      - helper line: "Username, mobile ya email daalein — reset code aapke registered email par aayega. / Enter your username, mobile or email — the reset code goes to your registered email."
      - identifier `<input value={resetId} ...>` (disable when `otpSent`).
      - `<button type="button" className="btn btn-outline" onClick={sendResetOtp} disabled={busy || !resetId}>{otpSent ? 'Resend code' : 'Send reset code'}</button>`.
      - when `otpSent`: a 6-digit code `<input value={otp} onChange={(e)=>setOtp(e.target.value.replace(/\D/g,''))} maxLength={6}>`,
        a `<PasswordInput value={resetPassword} onChange={(e)=>setResetPassword(e.target.value)} autoComplete="new-password" />` labelled "New Password (4+ chars) / नया पासवर्ड",
        and `<button className="btn btn-block" disabled={busy || !otp || !resetPassword}>Reset password</button>`.
      - helper line: "Email nahi hai? Store se contact karein: 7543888698".
      - a "Back to Login" link → `switchMode('login')`.
      Also update the login-mode heading/`<title>` logic if desired to cover `'forgot'` ("Reset password").
      Files: `4astore-v2/web/src/pages/Login.tsx`
      Verify: `npm run build` — compiles clean; then `npm run dev`, open `/login`, click "Forgot password?",
      confirm the panel renders, "Send reset code" shows the info toast, a wrong OTP submit surfaces
      "Invalid or expired code" in the error box, and "Back to Login" returns to the login form.

- [ ] 5. Add the three social buttons below the login button (login mode only).
      After the Login submit button in the login `<form>`, add a divider row
      ("or continue with / या इसके साथ जारी रखें") and three full-width buttons calling
      `socialLogin('Google', GOOGLE_CLIENT_ID)` / `('Facebook', FACEBOOK_APP_ID)` / `('Instagram', INSTAGRAM_APP_ID)`
      via `type="button"`. On-brand inline styles matching mobile: Google = white bg + `1.5px` border
      + blue "G"; Facebook = `#1877F2` bg, white text; Instagram = gradient
      (`background: 'linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)'`), white text with 📷.
      Keep them inside the login branch only (not register/forgot).
      Files: `4astore-v2/web/src/pages/Login.tsx`
      Verify: `npm run build` — compiles clean; in `npm run dev` at `/login`, the three styled buttons
      render and each click (with empty env creds) shows the provider "setup pending" info toast and does
      nothing else (no navigation, no network call, no crash).

- [ ] 6. Full build gate and regression check of existing flows.
      Run the web build (`npm run build` = `tsc -b && vite build` per `package.json` — there is no
      `lint` or `test` script); manually confirm the original login and register flows are unchanged
      (login submits to `/users/login`; register’s Send-OTP → create-account path still works). Fix
      any TypeScript error introduced.
      Files: `4astore-v2/web/src/pages/Login.tsx`
      Verify: in `4astore-v2/web`, run `npm run build` → exits 0 (full TS type-check + bundle). In
      `npm run dev`, log in with a valid account and confirm redirect to `next`/home still works and
      the register flow is unchanged.

## Notes / assumptions

- The web app has no OTP auto-fill for reset (mobile deliberately ignores `devOtp`); keep it that way
  — the user types the 6-digit code from their email.
- Build/test commands are confirmed from `4astore-v2/web/package.json`: `npm run build`
  (`tsc -b && vite build`) and `npm run dev` (vite). There is **no** `lint` or `test` script and no
  component test suite for Login.tsx, so verification is a clean type-checked build plus a manual
  dev-server check (the reviewer loop will exercise the UI).
- `.env.example` may optionally be extended with the three `VITE_*` client-ID vars for discoverability,
  but this is not required and not a code change to Login.tsx; the reads default to `''` regardless.
