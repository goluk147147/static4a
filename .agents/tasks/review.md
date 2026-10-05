# Forgot Password flow + credential-gated social login on the web login page

The change adds a third `forgot` mode to the web `Login.tsx` alongside the existing login and register modes, plus three "setup pending" social-login buttons under the login form. The forgot flow is a real two-step reset against the already-deployed public endpoints `POST /users/forgot-password/send` and `POST /users/reset-password`, reusing the web's axios `api` instance, `apiError`, `showToast`, and `PasswordInput` — no new helper, no new dependency, no server change. Social buttons read optional `VITE_*` client IDs and always no-op with a bilingual toast because the `social-login` endpoint does not exist yet. The three touched files are `Login.tsx`, `vite-env.d.ts` (three optional env declarations), and the regenerated `tsconfig.tsbuildinfo`.

Watch for: nothing blocking. The reset flow correctly leaves auth/session untouched and the social buttons are inert by design (both **confirmed**). The only observation is cosmetic — the login→forgot toggle is a bare `<a>` without `href`, matching the file's existing pattern (**confirmed**, pre-existing style).

**Verdict**: APPROVED

## High-level view

The reset flow is wired to the two real server endpoints. The paths are relative (`/users/forgot-password/send`, `/users/reset-password`), which is correct: the axios instance sets `baseURL = VITE_API_BASE || '/api'` and the router is mounted at `/api/users`, so the full paths resolve to the deployed routes. Body shapes match the server's zod schemas exactly — `{ identifier }` for send, `{ identifier, otp, newPassword }` for reset — and the server's 422 `'Invalid or expired code'` surfaces through `apiError` into the existing `.error` box. No base URL is hardcoded and no new route was invented.

The social buttons are deliberately inert. They read `VITE_GOOGLE_CLIENT_ID` / `VITE_FACEBOOK_APP_ID` / `VITE_INSTAGRAM_APP_ID` (each defaulting to `''`), but `socialLogin()` voids the client ID and shows a per-provider "setup pending" toast regardless of whether creds are set, because the backend `social-login` route is not deployed. No OAuth SDK, no network call, no new npm dependency.

Existing login and register flows keep their original handlers and endpoints; the only edit to them is swapping the inline `setMode(...); setError('')` toggles for the shared `switchMode()` helper, which additionally clears the reset/OTP fields so stale values never carry across modes. Register still gates its submit on `otpSent` and hits the same `/otp/send` + `register()` path. Auth/session handling is not touched by the reset flow — it ends by returning to a prefilled login form rather than logging the user in.

Build evidence is recorded in the verification note: `tsc -b` compiled with no errors and `vite build` exited 0 (718 modules, ~13.9s), with only the pre-existing chunk-size warning. The note also flags a real deploy gotcha: `tsc`/`vite` are devDependencies, so a `NODE_ENV=production` shell must use `npm ci --include=dev` or the build fails with `'tsc' is not recognized`.

<details>
<summary>Issues (1)</summary>

1. **Social-login creds are read but never used** — `GOOGLE_CLIENT_ID` / `FACEBOOK_APP_ID` / `INSTAGRAM_APP_ID` are read and passed into `socialLogin()`, which `void`s them. This is intentional (endpoint not deployed) and documented in a TODO; non-blocking, listed only so the dead-read is tracked for the follow-up that wires the real OAuth flow.

</details>

<details>
<summary>Details</summary>

### Reset flow talks to the real endpoints

`sendResetOtp` posts `{ identifier: resetId.trim() }` to `/users/forgot-password/send`; `submitReset` posts `{ identifier: resetId.trim(), otp: otp.trim(), newPassword: resetPassword }` to `/users/reset-password`. Both paths are relative to the axios `baseURL` (`VITE_API_BASE || '/api'`), and the server mounts the router at `/api/users` with these exact routes and zod schemas (`forgotSendSchema = { identifier }`, `resetSchema = { identifier, otp: /^\d{6}$/, newPassword: min(4) }`). The body shapes line up field-for-field, so the client never sends anything the server rejects for shape reasons.

The reset code input strips non-digits (`replace(/\D/g, '')`) and caps at `maxLength={6}` with `inputMode="numeric"`, matching the server's six-digit regex before the request is even sent. On a bad or expired code the server returns 422 with `'Invalid or expired code'`, and because both handlers end with `catch (err) { setError(apiError(err)); }`, that message lands in the existing `.error` box — the same channel login and register already use.

On success the flow deliberately does not create a session: it prefills `setUsername(resetId.trim())` and calls `switchMode('login')`, so the user re-authenticates through the normal login path and token handling stays entirely inside the `useAuth` store.

### Social buttons are inert by construction

```
socialLogin(provider, clientId) {
  void clientId;                    // read, but intentionally unused
  showToast(`${provider} login setup pending …`, 'info');
}
```

All three buttons are `type="button"` (so they never submit the login form) and route through this one function. Whether or not the `VITE_*` creds are populated, the result is identical: an info toast and no side effect. There is no OAuth round-trip, no SDK import, and the diff adds no dependency — confirmed by the unchanged `package.json` (not in the changed-file set) and the env reads defaulting to `''`. The `social-login` server route genuinely does not exist (grep over `routes/users.ts` finds only the forgot/reset and recovery-email routes), so the no-op is the correct posture rather than a stub hiding a missing call.

### Existing flows: toggle helper swap only

The login and register forms keep `doLogin`/`doRegister`, their endpoints, and their field bindings. The only change is that the mode-toggle links now call `switchMode('login' | 'register' | 'forgot')` instead of inline `setMode(...); setError('')`. `switchMode` additionally clears `otpSent`, `otp`, `resetId`, and `resetPassword`, which is a strict improvement: switching out of the forgot panel can't leave a half-entered reset code to bleed into a later visit. Register's submit is still gated on `!otpSent`, preserving its send-OTP-then-create sequence.

### Env typing and build

`vite-env.d.ts` adds the three creds as optional (`?`) readonly strings, so `import.meta.env.VITE_GOOGLE_CLIENT_ID || ''` type-checks without widening the interface or adding an index signature. The verification note records `tsc -b` clean and `vite build` exit 0 with only the long-standing vendor chunk-size warning, and it is not re-run here. The note's deploy caveat is worth carrying into CI: because `tsc`/`vite` are devDependencies, a production-NODE_ENV shell needs `npm ci --include=dev` (or unset `NODE_ENV`) before `npm run build`, otherwise the build dies on a missing `tsc`.

### Not tested

There is no component/unit test for `Login.tsx` in the repo and no `lint` or `test` script in `package.json`, so verification is the type-checked build plus manual dev-server checks described in the plan. The reset flow's 422 path, the social no-op, and the mode-switch field-clearing are exercised only by eye, not by an automated test — acceptable given the existing test posture, but noted.

</details>

<details>
<summary>Files changed</summary>

- `4astore-v2/web/src/pages/Login.tsx` — adds `forgot` mode, `switchMode` helper, `sendResetOtp`/`submitReset`/`socialLogin` handlers, the forgot panel, and three gated social buttons.
- `4astore-v2/web/src/vite-env.d.ts` — three optional `VITE_*` social-cred declarations.
- `4astore-v2/web/tsconfig.tsbuildinfo` — regenerated incremental build cache (artifact).

Full diff: `git -C <worktree> diff main...web-login-forgot-social`

</details>
