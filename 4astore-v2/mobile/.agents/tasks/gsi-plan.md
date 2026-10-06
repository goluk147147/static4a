# Implementation Plan — Native Google Sign-In for 4A Store v2 mobile

## Problem & root cause

The mobile app signs in with `expo-auth-session`'s Google provider (`Google.useAuthRequest({ ... responseType: 'id_token' })` in `app/login.tsx`). On a standalone (non-Expo-Go) Android build this uses the custom-URI-scheme `GeneralOAuthFlow`, which current Google policy blocks on Android OAuth clients — producing **Error 400: invalid_request — Custom URI scheme is not enabled for your Android client**. The Google Cloud toggle to re-enable custom URI schemes is no longer offered for new Android clients, so this must be fixed in code.

## Decision: migrate to @react-native-google-signin/google-signin

Chosen approach: replace the `expo-auth-session` Google flow with the native library `@react-native-google-signin/google-signin`. It uses the native Android Google Sign-In / Credential Manager path (not the blocked custom-URI web flow), ships an Expo config plugin usable in the managed prebuild workflow, and returns an `idToken` whose audience is the **WEB** client id — which the existing server `/social-login` endpoint already accepts. Rationale: it is the Expo-recommended native option and is the only approach that sidesteps the Android custom-URI-scheme restriction without relying on a console toggle that no longer exists.

### Pinned version + compatibility evidence

- **Pin:** `@react-native-google-signin/google-signin` at **`16.1.5`** (exact, no caret).
- **Evidence:** npm `latest` is `16.1.5`. Its `peerDependencies` are `expo: ">=52.0.40"`, `react: "*"`, `react-native: "*"`. This project is Expo `~54.0.37` (>= 52.0.40 ✓), React `19.1.0`, React Native `0.81.5` — all satisfied. The library documents an Expo config plugin for the managed/prebuild workflow and explicitly supports the new architecture (`newArchEnabled: true` here). Sources: library install/Expo-setup docs (react-native-google-signin.github.io) and npm registry metadata. Content was rephrased for compliance with licensing restrictions.
- Because this project already has `google-services.json` wired via `app.config.ts` (`googleServicesFile`), use the **Firebase** config-plugin variant: the bare plugin string with no `iosUrlScheme` (Android-only app; iOS is not a Play target here).

## Ordered implementation items

- [ ] 1. Add the native library pinned to an exact version.
      Add `"@react-native-google-signin/google-signin": "16.1.5"` to `dependencies` in `4astore-v2/mobile/package.json` and install so the lockfile/`node_modules` resolve. Do not change any other dependency.
      Files: `4astore-v2/mobile/package.json`
      Verify: `cd 4astore-v2/mobile && npm install` completes; `npm run typecheck` (`tsc --noEmit`) passes with the new module resolvable.

- [ ] 2. Register the config plugin in app.config.ts (keep googleServicesFile wiring).
      Add the plugin entry `'@react-native-google-signin/google-signin'` (bare string — Firebase variant, no `iosUrlScheme`) to the `plugins` array in `app.config.ts`. The Android OAuth client is matched implicitly by package `com.store4a.app` + SHA-1 via `google-services.json`; the WEB client id is supplied at runtime in `configure()` (item 4), not in the plugin. Leave the existing `googleServicesFile` branch and all other plugins untouched. Keep `googleWebClientId` / `googleAndroidClientId` in `extra` (the web id is still needed by `configure()`).
      Files: `4astore-v2/mobile/app.config.ts`
      Verify: `npm run typecheck` passes; `npx expo config --type public` (or `--json`) runs without plugin-resolution errors and shows the plugin listed.

- [ ] 3. Bump the Android versionCode to 21.
      Change the `VERSION_CODE` default in `app.config.ts` from `20` to `21` (keep env override). The fix cannot work on the already-installed build; a new binary must ship.
      Files: `4astore-v2/mobile/app.config.ts`
      Verify: `npx expo config --json` shows `android.versionCode: 21`.

- [ ] 4. Rewrite the Google button handler in login.tsx to use the native library.
      Replace the `expo-auth-session` Google wiring with the native flow: import `GoogleSignin`, `isSuccessResponse`, `statusCodes` from `@react-native-google-signin/google-signin`; call `GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID })` once (e.g. in a `useEffect` guarded on a non-empty `GOOGLE_WEB_CLIENT_ID`); in `startGoogle()` keep the empty-web-id "setup pending" toast fallback, then `await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true })`, `const res = await GoogleSignin.signIn()`, and when `isSuccessResponse(res)` read `res.data.idToken` and pass it to the existing `socialLogin(idToken)` store action unchanged, then `done(user)`. Handle `statusCodes.SIGN_IN_CANCELLED` as a silent no-op and show `showToast(apiError-style message, 'error')` for other failures and for a missing token. Remove `Google.useAuthRequest`, the `googleResponse` effect, `WebBrowser.maybeCompleteAuthSession()`, and the now-unused `expo-auth-session` / `expo-web-browser` Google imports (verify `expo-web-browser` is not needed elsewhere in this file — it is only used for the OAuth session here). Update `SocialBlock`'s `googleDisabled` prop to drop the `googleReq` reference (use `busy` only). Leave login/register/forgot flows untouched.
      Files: `4astore-v2/mobile/app/login.tsx`
      Verify: `npm run typecheck` passes; `npm test` passes (existing node test suite unaffected); grep confirms no remaining `expo-auth-session` import in `login.tsx` (as a sanity check, not the primary verification).

- [ ] 5. Keep client-id config in src/config.ts.
      No code change required: `GOOGLE_WEB_CLIENT_ID` / `GOOGLE_ANDROID_CLIENT_ID` stay (web id drives `configure()`). Optionally update the stale "(expo-auth-session)" comment to reference the native library. `expo-auth-session` dependency may remain in `package.json` since removing it is out of scope and risks unrelated breakage — but it is no longer used in `login.tsx` (confirmed it is used nowhere else in `src`/`app`).
      Files: `4astore-v2/mobile/src/config.ts` (comment only)
      Verify: `npm run typecheck` passes.

- [ ] 6. Server audience: no change required.
      `api-node/src/routes/users.ts` POST `/social-login` already verifies the id_token against `audience: [GOOGLE_WEB_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID]`. The native library's `idToken` is minted for the **WEB** client id, which is already in that list, so verification succeeds with no change. Do NOT edit the server.
      Files: none
      Verify: read `users.ts` and confirm both client IDs remain in the `audience` array (web id = `707085023016-etp7au34rg3cd5eks6cdu0cs0vkj1svn...`).

- [ ] 7. Web verify-only pass (no code change expected).
      Confirm `web/src/pages/Login.tsx` GIS path is correct: the GIS script loads only when `VITE_GOOGLE_CLIENT_ID` is set, `initialize({ client_id, callback })` runs once, and `handleCredential` POSTs `{ provider:'google', idToken: resp.credential }` to `/users/social-login` then stores the session. This is correct — the web failure (if any) is Google Cloud config, not code: the WEB OAuth client needs `https://4astore.com` as an Authorized JavaScript origin, and the web build needs `VITE_GOOGLE_CLIENT_ID` = the web client id. Do NOT change web code.
      Files: none (verify only)
      Verify: read `web/src/pages/Login.tsx` and confirm the GIS flow matches the above; record findings in the owner section below.

## Build & verification commands

Run from `4astore-v2/mobile`:
- `npm install` — resolves the new dependency.
- `npm run typecheck` — `tsc --noEmit`, must pass.
- `npm test` — existing node test suite, must pass.
- `npx expo config --json` — config resolves, plugin listed, `versionCode: 21`.
- Native build (owner/CI, after prebuild): `npx expo prebuild --platform android --clean` then `npm run build:aab` (or `build:apk`) — produces the new binary. The Google button cannot be exercised in Expo Go; it requires this dev/release build.

## OWNER GOOGLE CLOUD / REBUILD REQUIREMENTS

These are config/console/build actions the code change depends on — the owner must complete them for sign-in to work end to end:

1. **Android OAuth client (Google Cloud / Firebase):** client id `707085023016-pc4gc5271kquti6recqo9juor3p44dn9.apps.googleusercontent.com`, package `com.store4a.app`.
   - Upload-key SHA-1 `34:45:35:DE:ED:0C:0B:73:1B:D1:0F:6A:07:DD:77:41:BF:84:88:72` is registered.
   - **Play App Signing SHA-1 ALSO must be registered** — the owner adds it from **Play Console → Setup → App integrity → App signing key certificate (SHA-1)**. Without it, Play-signed installs fail native sign-in with a `DEVELOPER_ERROR`/`10` status.
2. **`google-services.json` oauth_client is EMPTY.** The checked-in `mobile/google-services.json` (and `mobile/android/app/google-services.json`) has `"oauth_client": []`. After the SHA-1s are registered in the Firebase project (Project settings → Android app `com.store4a.app`), the owner must **re-download `google-services.json`** so its `oauth_client` array contains the Android client (type 1, with the certificate hash) and the WEB client (type 3). Replace both copies and rebuild. Native sign-in can fail with `DEVELOPER_ERROR` if this file lacks the matching oauth_client entries.
3. **Web OAuth client Authorized JavaScript origin:** add `https://4astore.com` to the WEB OAuth client (`707085023016-etp7au34rg3cd5eks6cdu0cs0vkj1svn.apps.googleusercontent.com`). Required for the web storefront GIS button.
4. **Web build env:** set `VITE_GOOGLE_CLIENT_ID` = `707085023016-etp7au34rg3cd5eks6cdu0cs0vkj1svn.apps.googleusercontent.com` for the web deploy (empty = button stays on "setup pending" toast).
5. **New binary required:** build and ship a NEW APK/AAB at **versionCode 21**. The fix will NOT work on the already-installed build — the device must get the rebuilt binary that contains the native library + updated `google-services.json`.
6. **google-services.json present at build:** ensure the re-downloaded file is at `mobile/google-services.json` before `expo prebuild` (app.config.ts wires it only when it exists).

## Server audience note

No server change is required: `/social-login` already accepts the WEB client id as a valid audience, and the native library mints the id_token for the WEB client id. If a future change ever moves off the WEB client id, the server `audience` list in `api-node/src/routes/users.ts` must be updated to keep one of the two accepted IDs matching — but that is not needed for this migration.

## Fallback (only if the library proves incompatible)

Compatibility is confirmed (peer dep `expo >= 52.0.40` satisfied by 54.x), so the native path stands. If a build later proves it incompatible, the minimal `expo-auth-session` alternative is to drive the flow off the **WEB** client with an `https` redirect (AuthSession proxy / `makeRedirectUri` with an https scheme) to avoid the Android custom-URI block — at the cost of a browser round-trip and proxy dependency. Prefer the native library.
