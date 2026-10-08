# Google Sign-In `DEVELOPER_ERROR` audit — 4A Store v2 Android (versionCode 23)

**Investigation type:** READ-ONLY. No source files were modified.
**Repo:** `c:\xampp\htdocs\static4a\4astore-v2` (mobile + api-node)
**Date of audit:** against the current working tree.

---

## 1. Summary answer (the single most-likely root cause)

**The installed app is signed by the Google Play App Signing key (SHA-1 `2a:0f:27:57:7e:a0:72:49:6d:4a:26:76:68:e3:42:82:21:10:22:c7`), but NO Android-type OAuth client in Google Cloud project `a-store-a924a` (707085023016) has that SHA-1 registered against package `com.store4a.app`.**

The existing Android OAuth client `707085023016-pc4gc5271kquti6recqo9juor3p44dn9` only carries the **upload** key SHA-1 (`34:45:35:DE:ED:0C:...`). Because Play Closed Testing re-signs the delivered app with the **Play App Signing** cert, the signing cert of the app actually running on the tester's device is `2a:0f:27:...`, which matches no Android OAuth client. Google's sign-in backend validates the native caller by **package name + signing-cert SHA-1**, finds no match, and rejects the request → `DEVELOPER_ERROR` (status code 10).

This is confirmed as the behavior by the library's own troubleshooting doc, which states this error is *always* a configuration mismatch between the app and the server-side (Firebase/Google Cloud) setup, and specifically that it occurs because Google re-signs the application with its own key when distributed through Play channels. ([react-native-google-signin troubleshooting](https://react-native-google-signin.github.io/docs/troubleshooting), [get-config-file](https://react-native-google-signin.github.io/docs/setting-up/get-config-file)) Content was rephrased for compliance with licensing restrictions.

**The fix is a server-side (Google Cloud) OAuth-client change, not a code change and not a new app build.** Add the Play App Signing SHA-1 to an Android OAuth client for `com.store4a.app` in the same project. (See §5.)

### Why web login works but Android does not
Web Google Sign-In is validated purely by the **web client ID (type 3)** and the authorized JavaScript origins — there is no signing-cert check. Android is validated by **package + signing-cert SHA-1** against an Android OAuth client (type 1). So web working tells you the project, the web client ID, and the server `/social-login` audience are all correct — it says nothing about the Android cert registration, which is the thing that is broken.

---

## 2. Evidence (file / symbol citations)

### 2.1 Mobile client config — webClientId is correct and of type web
- `mobile/src/config.ts` exports `GOOGLE_WEB_CLIENT_ID` / `GOOGLE_ANDROID_CLIENT_ID` from `expo-constants` `extra`.
- `mobile/app.config.ts` (`extra`): `googleWebClientId` default `707085023016-etp7au34rg3cd5eks6cdu0cs0vkj1svn.apps.googleusercontent.com` (**type 3 / web** — correct per the library's requirement that `webClientId` be of type web), `googleAndroidClientId` default `707085023016-pc4gc5271kquti6recqo9juor3p44dn9.apps.googleusercontent.com`.
- `mobile/app/login.tsx`: `useEffect` runs `GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID })`; `startGoogle()` calls `GoogleSignin.hasPlayServices()` → `GoogleSignin.signIn()` → passes `res.data.idToken` to `socialLogin(idToken)`. **The only runtime input the library needs is the web client id** — the Android caller is validated server-side by Google.
- `@react-native-google-signin/google-signin` is registered as an Expo config plugin in `mobile/app.config.ts` (`plugins` array), with `googleServicesFile: './google-services.json'` wired when the file exists.

### 2.2 `google-services.json` has NO Android (type 1) client — in BOTH copies
- `mobile/google-services.json` and `mobile/android/app/google-services.json` are byte-for-byte equivalent and each contain a single `oauth_client` entry: `707085023016-etp7au34rg3cd5eks6cdu0cs0vkj1svn...` with `"client_type": 3` (web). **There is no `client_type: 1` (Android) entry and no `certificate_hash`.** This is the stale-config symptom, but see §4 — it is not the runtime blocker for this library.
- Project identity in the file matches the brief: `project_id: a-store-a924a`, `project_number: 707085023016`, android package `com.store4a.app`. So the config is for the correct project and app.

### 2.3 Server audience accepts both web and android client IDs — so the token itself is fine
- `api-node/src/routes/users.ts`:
  - `const googleClient = new OAuth2Client();`
  - `GOOGLE_WEB_CLIENT_ID` / `GOOGLE_ANDROID_CLIENT_ID` read from env with the same defaults as the mobile app.
  - `router.post('/social-login', ...)` → `googleClient.verifyIdToken({ idToken, audience: [GOOGLE_WEB_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID] })`.
- Implication: if the device ever produces an idToken, the server will accept it (its `aud` will be the web client id, which is in the audience list). The failure happens **before** any token is produced — `GoogleSignin.signIn()` throws `DEVELOPER_ERROR` on the device because Google refuses to issue a token to an unrecognized package+SHA-1. The server is not involved and is not the problem.

### 2.4 Authoritative library behavior (external, cited)
- Library troubleshooting doc: `DEVELOPER_ERROR` / code 10 is *always* a configuration mismatch between the app and the Firebase/Google Cloud server-side setup; it explicitly calls out that distributing through Play (where Google re-signs with its own key) triggers it; and it requires `webClientId` to be of **type web, not Android**. ([troubleshooting](https://react-native-google-signin.github.io/docs/troubleshooting)) Content was rephrased for compliance with licensing restrictions.
- Config-file doc: an Android app typically has multiple signing configs (local debug/release, EAS, and **Play App Signing, where the Play Store may re-sign the app with one of its own keys**). ([get-config-file](https://react-native-google-signin.github.io/docs/setting-up/get-config-file)) Content was rephrased for compliance with licensing restrictions.

---

## 3. Answering the key questions

### Q1(a) — Must there be an Android (type 1) OAuth client with the Play App Signing SHA-1? Is that the cause?
**Yes, and yes.** For a Play-distributed build, the signing cert on-device is the Play App Signing cert (`2a:0f:27:...`). Google authorizes a native Google Sign-In caller by matching `package name + signing-cert SHA-1` to an Android OAuth client in the project. The existing Android client only has the upload SHA-1 (`34:45:...`), so the running app matches nothing → `DEVELOPER_ERROR`. **Confirmed as the root cause.**

### Q1(b) — Does `google-services.json` need a type-1 entry, or does the library only need `webClientId` at runtime?
At **runtime** the library only needs the correct **`webClientId` (type 3)** — that is literally all `GoogleSignin.configure` is given in `login.tsx`, and it is what populates the `idToken`. The Android caller is validated **server-side by Google** against the project's Android OAuth clients (package + SHA-1). So the empty/absent Android `oauth_client` in `google-services.json` is **not** the runtime blocker for `@react-native-google-signin`. (It would matter for the native Firebase Auth SDK, but this app verifies the idToken itself in `api-node`, so it does not depend on a type-1 entry being present in the JSON.)

### Q2 — Firebase SHA-1 vs the Google Cloud Android OAuth client
Adding an SHA-1 in the Firebase console is *supposed* to create/update an Android OAuth client in the underlying Google Cloud project. But the regenerated `google-services.json` baked into versionCode 23 **still shows no type-1 client**, which means one of the following is true and must be checked:
- The Android OAuth client in Cloud was **not** regenerated/linked (Firebase sometimes shows the fingerprint under the app without the OAuth client being materialized), **or**
- The SHA was added to a **different** app/fingerprint slot, **or**
- Propagation / download timing (the JSON was downloaded before the client updated).

**Do not rely on the Firebase side alone.** The reliable, deterministic fix is to add the Play App Signing SHA-1 directly to the Android OAuth client in **Google Cloud Console → APIs & Services → Credentials** (see §5), which is where Google actually checks it. That removes dependence on Firebase auto-sync.

### Q3 — Project mismatch?
**No mismatch.** `google-services.json` confirms `project_id: a-store-a924a` / `project_number: 707085023016` and package `com.store4a.app` — the same project as the web client id and the Android client `707085023016-pc4gc5271...`. The issue is **not** wrong project; it is a **missing SHA-1 on the Android OAuth client** within the correct project. Caveat: when the owner re-downloads `google-services.json`, they must download it from the `com.store4a.app` app in project `a-store-a924a` (not another app), but that only affects whether the JSON gets a type-1 entry — not the actual fix.

### Q4 — Does the stale `google-services.json` in versionCode 23 matter?
**No, it does not block this library.** The runtime only needs `webClientId` (present and correct). Android authorization is server-side by package + SHA-1. So the stale JSON (web-only) is **not** the blocker. The blocker is purely: *does a Google Cloud Android OAuth client for `com.store4a.app` carry the Play App Signing SHA-1 `2a:0f:27:...`?* Right now it does not.

---

## 4. Is the empty Android `oauth_client` in `google-services.json` a problem?
**For this library and this app: no — it is irrelevant to the DEVELOPER_ERROR.** The app uses `@react-native-google-signin` + a custom server verifier (`/social-login` with `verifyIdToken`), not the native Firebase Auth SDK. It needs the web client id at runtime and nothing from the type-1 entry. You can regenerate `google-services.json` for tidiness later (it will populate the type-1 entry once the Android OAuth client has the SHA-1), but **do not treat it as the fix and do not block on it.** No rebuild is needed just to update this file for Google Sign-In to work.

---

## 5. EXACT owner steps to fix (do these — no code change, no rebuild)

### Step A — Add the Play App Signing SHA-1 to the Android OAuth client (Google Cloud Console)
1. Go to **Google Cloud Console → APIs & Services → Credentials**, project **`a-store-a924a`** (project number `707085023016`). Confirm the project selector shows this project.
2. Under **OAuth 2.0 Client IDs**, open the Android client **`707085023016-pc4gc5271kquti6recqo9juor3p44dn9`** (Application type: Android; package `com.store4a.app`).
3. Verify **Package name** = `com.store4a.app` exactly (must equal the `applicationId` / `AndroidManifest` package).
4. In **SHA-1 certificate fingerprint**, **add** the Play App Signing SHA-1:
   `2a:0f:27:57:7e:a0:72:49:6d:4a:26:76:68:e3:42:82:21:10:22:c7`
   **Keep** the existing upload SHA-1 `34:45:35:DE:ED:0C:0B:73:1B:D1:0F:6A:07:DD:77:41:BF:84:88:72` too (so locally-signed/internal builds still work). Both can coexist.
   - If the console UI only allows one SHA-1 per Android client, create a **second** Android OAuth client, same package `com.store4a.app`, with the Play App Signing SHA-1. Multiple Android clients for one package are allowed and are matched by package+SHA-1.
5. **Save.**

> Where to get the Play App Signing SHA-1 to confirm it: **Google Play Console → (your app) → Test and release → Setup → App signing → "App signing key certificate" → SHA-1**. It must equal `2a:0f:27:...`. (The "Upload key certificate" on that same page is the `34:45:...` one.)

### Step B (recommended, belt-and-suspenders) — Confirm the SHA-1 in Firebase
1. **Firebase Console → Project settings → Your apps → Android app `com.store4a.app`** (project `a-store-a924a`).
2. Confirm **both** fingerprints are listed: Play App Signing `2a:0f:27:...` (SHA-1) and its SHA-256 `ff:c9:c1:ba:7a:ef:...`, plus the upload key `34:45:...`.
3. This keeps Firebase's auto-managed Cloud OAuth client in sync. Step A is the authoritative fix; Step B prevents Firebase from later overwriting/diverging.

### Step C — Verify an Android OAuth client exists for the package + Play SHA-1
- In **APIs & Services → Credentials**, confirm there is at least one **Android** OAuth client with:
  - Package name `com.store4a.app`, AND
  - SHA-1 `2a:0f:27:57:7e:a0:72:49:6d:4a:26:76:68:e3:42:82:21:10:22:c7`.
- Optional device-side check with the APK/AAB in hand: run `npx @react-native-google-signin/config-doctor` against the build — the library ships this diagnostic specifically to catch exactly this package+SHA mismatch. ([troubleshooting](https://react-native-google-signin.github.io/docs/troubleshooting)) Content was rephrased for compliance with licensing restrictions.

### Step D — Do you need a new app build?
**No.** OAuth client SHA registration is **server-side** at Google and takes effect **without rebuilding or re-uploading** the app. Only **propagation time** applies (typically a few minutes, occasionally up to a few hours). The existing versionCode 23 build will start working once propagation completes — the stale web-only `google-services.json` inside it does not matter (see §4).

### Step E — Test
1. Wait ~5–60 minutes after saving the SHA-1 for propagation.
2. On the **Closed Testing** install of versionCode 23 (the Play-signed build), fully close and reopen the app, tap **Continue with Google**, and complete the native sheet.
3. Expected: the native sheet returns an `idToken`; `startGoogle()` calls `socialLogin(idToken)`; the server `/social-login` verifies it (`aud` = web client id, already in the accepted audience) and returns the session. The user lands on their role's destination.
4. If it still fails immediately with `DEVELOPER_ERROR`: re-verify in Google Cloud that the SHA-1 is on an Android client for `com.store4a.app` in project `a-store-a924a` (not a different project/app), and re-check the Play App Signing SHA-1 value against Play Console. Run `config-doctor` on the exact artifact for a definitive package+SHA diff.

---

## 6. Bottom line
- **Root cause:** no Android OAuth client in project `a-store-a924a` carries the Play App Signing SHA-1 `2a:0f:27:...` for package `com.store4a.app`; the Play-re-signed install therefore fails Google's native caller validation → `DEVELOPER_ERROR`.
- **Fix:** add that SHA-1 to the Android OAuth client `707085023016-pc4gc5271...` (keep the upload SHA-1 too), in Google Cloud Console → Credentials. Mirror in Firebase.
- **No code change, no rebuild** — server-side registration, effective after propagation.
- **The empty Android `oauth_client` in `google-services.json` is irrelevant** to this library's failure; the web client id (type 3) is all the runtime needs, and it is correct.
- **Web login working is expected** and confirms the project, web client id, and server audience are all fine — the gap is solely the Android signing-cert registration.
