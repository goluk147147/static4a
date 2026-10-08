# Order / Status / Google / Keyboard Audit — 4A Store v2

Read-only investigation of four high-priority bugs. Scope: `4astore-v2` only
(legacy `4AStoreApp`, old PHP `/api`, root `*.html` ignored). Branch `main` @
`38d825b2`. No source files were modified.

The app runs against production `https://4astore.com/api` (api-node, Express +
Prisma + MariaDB).

---

## Summary (read this first)

- **BUG 1 (order slow / "not confirmed"):** The *server* order-create handler
  (`api-node/src/routes/orders.ts` `POST /`) is already correctly fire-and-forget
  for push — `notifyStaffNewOrder()` is NOT awaited (`orders.ts:197`). So the
  classic "awaited push blocks the response" root cause is **already fixed in the
  current code**. The real remaining cause is on the **client/timeout seam**: the
  mobile `confirmOrder` **awaits `POST /orders`** (`checkout.tsx:218`) with a hard
  **15 s abort** and **no retry on POST** (`src/api.ts:111`, `:124-:135`). When the
  server is briefly slow (cold DB pool, first push init, FCM/network spike on the
  background task sharing the event loop), the POST exceeds 15 s, the client aborts
  and shows "Server slow / timeout" — **even though the order row was actually
  created**. The user reads that as "order not confirmed / slow". The fix is to make
  order placement resilient to a slow/duplicate response, not to re-order awaits.
  Secondary contributors documented below (settings read + upsert on each create;
  no idempotent client recovery).

- **BUG 2 (admin can't update order status):** The status route, the web client,
  and the mobile client are all **structurally correct and matched** — web/mobile
  both `POST /admin/orders/status { orderId, status }` (`web/src/lib/admin.ts:8`,
  `mobile/app/admin/order/[id].tsx:137`) and the handler at `admin.ts:342` accepts
  exactly that shape; `order_status` is a plain `VARCHAR(40)` (`schema.prisma`
  Order model), so no enum rejects "Confirmed"/"Packed"/etc. The failure is a
  **symptom of BUG 1's slow seam, not a broken route**: the handler `await`s a
  `tracking` raw-SQL update **before** responding (`admin.ts:351`), and
  `.update(...).catch(() => null)` **collapses every DB/connection error into a
  generic 404 "Order not found"** (`admin.ts:347-350`). On a slow/stalled DB that
  reads to the admin as "status update not working / disabled". The web select is
  not disabled in code — it only *appears* unresponsive because the mutation
  throws/times out. Fix: don't swallow the real error into 404, and make the
  tracking sync fire-and-forget.

- **BUG 3 (Google login broken, app + web):** This is **config, not code** on both
  surfaces, plus one **release-signing (SHA-1) gap** on Android. The code paths are
  complete and correct: web uses GIS gated on `VITE_GOOGLE_CLIENT_ID`
  (`web/src/pages/Login.tsx:21`, `:137`); mobile uses `expo-auth-session` with
  `webClientId`/`androidClientId` (`mobile/app/login.tsx:30-35`); the server
  verifies the ID token against **both** client IDs as audience
  (`api-node/src/routes/users.ts:112-116`). The breakages: (a) **web** — the Vite
  build almost certainly has **`VITE_GOOGLE_CLIENT_ID` unset**, so GIS never loads
  and the button falls back to the "setup pending" toast; even when set, the client
  ID's **Authorized JavaScript origins must include `https://4astore.com`** in Google
  Cloud Console. (b) **mobile** — the Android OAuth client in Google Cloud needs the
  **package `com.store4a.app` + the SHA-1 of the actual signing key** (the app signs
  releases with `4AStoreApp/4astore-key-new.jks` alias `4astore`, and if distributed
  via Play, **Play App Signing's** SHA-1 too). Until those SHA-1s are registered,
  Google rejects the Android sign-in. The hardcoded client IDs
  (`707085023016-…`) must be the ones whose consent screen + origins + SHA-1 are
  configured, or sign-in fails before any server call.

- **BUG 4 (dropdown forms don't scroll above the keyboard):** The shared `Screen`
  wrapper (`mobile/src/components/ui.tsx:114-139`) renders a plain `ScrollView`
  with **no `KeyboardAvoidingView` and no scroll-into-view on focus**. `checkout.tsx`
  was fixed by giving the address-editor Modal its *own* `KeyboardAvoidingView` +
  `scrollTo` on the Village field's `onFocus` (`checkout.tsx:296-351`), and
  `login.tsx` wraps its screen in a `KeyboardAvoidingView` (`login.tsx:179`). Every
  **other** form screen rendered inside bare `Screen` lacks this. However, the only
  screen with a *true text-triggered dropdown behind the keyboard* is checkout
  (already fixed). The remaining screens have lower-lying inputs or button-row
  selectors (not keyboard-opening dropdowns). The robust fix is to add keyboard
  avoidance **once** in the shared `Screen`, which fixes every form at the source.

- **BUG 5 (banners/background images don't show):** NOT a URL code bug — mobile
  (`absoluteUrl`, `index.tsx:106`), web (`bannerImage`, `Home.tsx:14`) and the admin
  preview all build loadable URLs correctly. The real cause is a **file-location /
  deploy / serving-origin mismatch**: every existing banner lives in
  `web/public/data/banners/` and is stored in the DB as the legacy `data/banners/<f>`
  path, which resolves to the **web origin** — but the deploy script **excludes
  `web/public/data`** from sync (`deploy.sh:28`), so on a fresh server those files are
  never populated and `/data/banners/*` 404s. Meanwhile the current upload endpoint
  writes NEW banners to `api-node/uploads/banners/` and returns
  `/api/uploads/banners/<f>` (`admin.ts:249`), a different origin that only works if
  nginx proxies `/api`. Fix is deploy/data restoration (migrate legacy banners onto
  the preserved, proxied `/api/uploads/banners/*` path), not a URL-builder change.

---

## BUG 1 (CRITICAL) — Order placement slow / "not confirmed"

### Reported symptom
Placing an order (checkout → confirm/pay) is slow or appears not to confirm.

### Order-create path (traced end to end)

Client (mobile):
- `mobile/app/checkout.tsx` `confirmOrder()` builds the payload and **awaits**
  `const d = await api.post('/orders', payload)` (`checkout.tsx:218`). Only after
  it resolves does it fire the screenshot upload **fire-and-forget**
  (`checkout.tsx:220`, `.catch(() => null)`) and navigate to `/order-success`.
- `mobile/src/api.ts`: the fetch has a **15 s `AbortController` timeout**
  (`api.ts:109-111`). On abort/network error, **GET auto-retries once but POST
  never does** (`api.ts:126-135`, comment: "Never auto-retry writes (POST) to
  avoid duplicate orders"), and it throws `ApiError('Server slow … / timeout', 0)`.
  So a slow create surfaces to the user exactly as "Server slow / timeout".

Server (`api-node/src/routes/orders.ts`, `POST /` → `router.post('/', requireAuth, …)`):
Work awaited **before** `return ok(res, …)` (the response), in order:
1. `saveSchema.safeParse` (sync) — `orders.ts:142`.
2. UTR dedupe lookup `prisma.order.findUnique({ where: { payment_reference } })`
   — indexed unique column, fast (`orders.ts:152`).
3. `getSettingsRow()` → `SELECT * FROM settings WHERE id = 1` (`orders.ts:28-31`,
   `:163`).
4. Serviceability checks — pure in-memory (`serviceability.ts`), fast.
5. `prisma.order.upsert(...)` — the single write (`orders.ts:170-192`).
6. **`notifyStaffNewOrder(...)` is NOT awaited** — called with `.catch(() => null)`
   (`orders.ts:197-203`). ✔ Correct: push does not block the response.
7. `return ok(res, { order: created })` (`orders.ts:206`).

**Conclusion:** The leading hypothesis in the brief (push/email awaited inline)
does **not** hold on current `main` — push is fire-and-forget and **no email is
sent** on order create (the only `sendMail` calls are OTP/forgot-password in
`users.ts`/`otp.ts`, never in `orders.ts`). The server path is lean.

### Actual root cause (the slow seam)
The slowness is the **interaction of a 15 s client timeout + non-retrying POST with
transient server latency**, not an inline-awaited side effect:

- **Cold / idle DB pool.** `db.ts` warms the pool and runs a 60 s keep-alive
  (`db.ts:22-33`) *precisely because* "~600 ms+ per request" cold handshakes were
  observed on the live box. If the keep-alive lapses or the process restarted, the
  first create pays reconnect latency on steps 2-5.
- **Shared event loop with the background push.** `notifyStaffNewOrder` runs after
  the response is *scheduled* but on the same single Node event loop; its first call
  lazily runs `initFirebase()` (`services/push.ts`, reads+parses the service-account
  JSON synchronously, `push.ts:54-66`) and FCM network sends. Under load this can
  delay the next request's turn enough that a *subsequent* create nears the 15 s cap.
- **No idempotent client recovery.** Because POST never retries and the client
  aborts at 15 s, a create that actually succeeded server-side still shows the user
  a timeout error → "order not confirmed", even though the row exists (and the UTR
  uniqueness means a manual retry then fails with 409 "payment reference already
  used", compounding the confusion).

### How to confirm
- Reproduce on a cold server: restart the API, place one order; watch whether the
  first request is slow (>2-3 s) while later ones are fast → confirms cold-pool
  latency, not handler logic.
- Server timing: start with `DEBUG_TIMING=1` (enables Prisma query logging,
  `db.ts:12`; `timing` middleware, `server.ts:38`) and read the per-query timings on
  a create — expect the `settings` read + `order` upsert to dominate, with push
  absent from the response critical path.
- Client side: when the user sees "Server slow / timeout", query the DB
  `SELECT order_id, created_at FROM orders ORDER BY id DESC LIMIT 5;` — if the order
  IS present, this is the timeout-vs-success seam, not a failed write.

### Recommended fix (code)
1. **Make the create idempotent + recoverable on the client.** Keep POST
   non-retrying, but on a timeout (`ApiError.status === 0`) in
   `checkout.tsx:confirmOrder`, do a bounded **GET `/orders/:orderId` by the
   client-generated `orderId`** to see whether it landed, and treat "found" as
   success. This requires the client to generate `orderId` up front and send it in
   the payload (the handler already accepts `o.orderId` and upserts on it —
   `orders.ts:168`, `saveSchema.order.orderId` optional at `orders.ts:97`), so a
   retry is a safe idempotent upsert rather than a 409.
2. **Raise the mobile POST timeout for order placement specifically** (e.g. 30 s for
   `/orders`) so a slightly slow-but-successful create isn't aborted mid-flight.
3. **Keep the server lean:** push is already fire-and-forget — leave it. Optionally
   move `initFirebase()` to app boot (`server.ts` listen callback) so the first
   order's background task doesn't pay the JSON parse + FCM init on the hot path.
4. **Pool health:** ensure the production process keeps the `db.ts` keep-alive alive
   (don't run under a supervisor that pauses idle event loops) so creates never pay a
   cold reconnect.

No server/console config needed for BUG 1 beyond ensuring the API process is
long-lived with a warm pool.

---

## BUG 2 (CRITICAL) — Admin cannot update order status

### Reported symptom
Changing an order's status in the admin panel (and/or the mobile staff screen)
"doesn't work" / the control looks disabled.

### What is correct (ruled out)
- **Web admin:** `AdminOrders.tsx` renders a `<select>` whose `onChange` calls
  `changeStatus(orderId, value)` → `updateOrderStatus(orderId, status)`
  (`AdminOrders.tsx:200`, `:159-167`), which `POST`s `/admin/orders/status` with
  `{ orderId, status }` and reads `.data` (`web/src/lib/admin.ts:7-9`). The select is
  **not** `disabled` anywhere in code.
- **Mobile staff:** `app/admin/order/[id].tsx` `setStatus()` does an **optimistic
  cache update then** `api.post('/admin/orders/status', { orderId, status })`
  (`[id].tsx:124-150`), rolling back on error. Correct shape, correct endpoint.
- **API handler** `admin.ts:342-355` (`POST /orders/status`, guarded by
  `requireAuth` + `requireStaff('orders')`): reads `req.body.orderId` /
  `req.body.status`, updates `order_status` (and `delivered_at` when "Delivered").
  Payload names match the clients exactly. `order_status` is `VARCHAR(40)` in the
  Prisma `Order` model (`schema.prisma`), **not an enum**, so any status string is
  accepted. The keyset-pagination work (72df449/d0034cc) touched only the
  `GET /orders` list, **not** this route.

### Root cause (why it still "fails")
Two code smells make a *transient* failure look like a *permanent broken button*,
and both live in the status handler:

1. **Error-swallowing collapses real failures into a misleading 404.**
   `admin.ts:347-350`:
   ```
   const updated = await prisma.order
     .update({ where: { order_id: orderId }, data: { order_status: status, … } })
     .catch(() => null);
   if (!updated) return fail(res, 'Order not found', 404);
   ```
   Any error from `.update()` — a connection drop, pool timeout, deadlock, a
   `delivered_at` type issue — is caught and turned into `null`, which the next line
   reports as **"Order not found" (404)**. The admin sees a generic failure that has
   nothing to do with the real cause, so the status "won't change" with no useful
   signal.
2. **The tracking sync is awaited before responding.** `admin.ts:351`:
   `await prisma.$executeRawUnsafe('UPDATE tracking SET status = ?, updated_at = NOW() WHERE order_id = ?', …)`.
   On a slow DB this holds the response open; combined with the web client having no
   explicit timeout (axios default) and the mobile client's 15 s abort, a slow
   tracking write makes the whole status call hang/err — i.e. the **same slow seam as
   BUG 1**. (The customer push on the next line IS fire-and-forget — `admin.ts:352`,
   `.catch(() => null)` — so push is not the blocker.)

So BUG 2 is not a wrong route or a disabled control; it is a transient
DB-latency/error being (a) masked as "Order not found" and (b) made more likely by
awaiting the tracking write.

### How to confirm
- In the browser devtools Network tab, change a status and inspect the
  `POST /api/admin/orders/status` response: a `404 {"message":"Order not found"}` on
  an order that clearly exists confirms the swallow-to-404 path (`admin.ts:349-350`).
  A pending/stalled request confirms the awaited-tracking latency.
- Server: run with `DEBUG_TIMING=1` and watch the `UPDATE tracking …` timing on a
  status change.

### Recommended fix (code)
- In `admin.ts:347-355`: **stop swallowing** the update error — let it throw to the
  async error handler (or catch and return a 500 with the real message), and only
  return 404 when the order genuinely doesn't exist (`findUnique` first, or inspect
  the Prisma `P2025` code). Make the `tracking` update **fire-and-forget**
  (`.catch(() => null)` without `await`), exactly like the push below it, so the
  status response returns immediately after the `orders` write.
- Apply the same treatment to the rider path `tracking.ts:163-181` which also awaits
  the tracking raw update before responding.
- No server/console config needed.

---

## BUG 3 (HIGH) — Google login broken on app AND web

### Reported symptom
Google Sign-In fails on both the mobile app and the website.

### What the code does (all correct)
- **Server verify** — `api-node/src/routes/users.ts` `POST /social-login`
  (`users.ts:107-139`): verifies the Google ID token with
  `googleClient.verifyIdToken({ idToken, audience: [GOOGLE_WEB_CLIENT_ID,
  GOOGLE_ANDROID_CLIENT_ID] })` (`users.ts:112-116`), requires
  `email_verified === true`, upserts the user by email, issues the normal session.
  Accepts **both** web and android audiences, so one endpoint serves both clients.
  Client IDs come from env with hardcoded defaults
  (`707085023016-…web…` / `707085023016-…android…`, `users.ts:28-31`).
- **Web** — `web/src/pages/Login.tsx`: loads GIS from `accounts.google.com/gsi/client`
  **only when `GOOGLE_CLIENT_ID` is set** (`Login.tsx:134-152`), initializes with
  `client_id` (`:156-164`), and on `onGoogleClick` opens the GIS prompt or falls back
  to a "setup pending" toast when not configured (`:177-186`). `GOOGLE_CLIENT_ID`
  comes from `import.meta.env.VITE_GOOGLE_CLIENT_ID` (`Login.tsx:21`).
- **Mobile** — `mobile/app/login.tsx`: `Google.useAuthRequest({ webClientId,
  androidClientId, responseType: 'id_token', scopes: [...] })` (`login.tsx:30-35`);
  on success reads `id_token` and calls `socialLogin(idToken)` → server
  (`login.tsx:149-171`). Client IDs come from `app.config.ts` `extra.googleWebClientId`
  / `googleAndroidClientId` (`app.config.ts` extra block) via `src/config.ts:25-26`.

### Root cause — Google Cloud / build config, not app code
1. **Web: client ID almost certainly unset in the production build.**
   `VITE_GOOGLE_CLIENT_ID` is a build-time env var. If the production web build was
   made without it, `GOOGLE_CLIENT_ID` is `''`, GIS never loads, and the button only
   shows "setup pending" — exactly "Google login not working". **Fix:** build the web
   app with `VITE_GOOGLE_CLIENT_ID=707085023016-…web….apps.googleusercontent.com`.
2. **Web: Authorized JavaScript origins.** Even with the ID set, the **web** OAuth
   client in Google Cloud Console → Credentials must list
   **`https://4astore.com`** (and any `www`/staging origin) under *Authorized
   JavaScript origins*. GIS is origin-locked; a missing origin makes
   `google.accounts.id.prompt()` fail silently.
3. **Mobile: Android client needs package + signing SHA-1.** The **Android** OAuth
   client in Google Cloud must register package **`com.store4a.app`**
   (`app.config.ts` `android.package`) plus the **SHA-1 fingerprint of the signing
   key**. The app signs releases with `4AStoreApp/4astore-key-new.jks` alias
   `4astore` (`app.config.ts` `withReleaseSigning` plugin). If the app is distributed
   through Google Play, **Play App Signing re-signs it**, so the **Play App Signing
   SHA-1** (from Play Console → Setup → App integrity) must ALSO be registered, in
   addition to the upload-key SHA-1. Until the real distributed cert's SHA-1 is in
   Google Cloud, Google rejects the Android `id_token` request before any server
   call. This is the "won't match until the new signed build's SHA-1 is added" case.
4. **Mobile: `google-services.json` presence.** `app.config.ts` only sets
   `googleServicesFile` when `google-services.json` exists next to the config
   (`app.config.ts:17-18`, `hasGoogleServices`). It must be present at build time for
   the Firebase/Google wiring (and for push). Confirm it ships in the APK build.

### Which part is code vs config
- **Code:** complete on all three surfaces — no code change required for Google
  sign-in to function once config is correct. (Optional hardening: surface a clearer
  error when GIS `prompt()` is dismissed/blocked, and log the server-side
  `verifyIdToken` failure reason instead of a flat 401 at `users.ts:117-118`.)
- **Config (the actual fix):**
  - Web OAuth client (ID `707085023016-…web…`): add Authorized JavaScript origin
    `https://4astore.com`; build web with `VITE_GOOGLE_CLIENT_ID` set to that ID.
  - Android OAuth client (ID `707085023016-…android…`): register package
    `com.store4a.app` + upload-key SHA-1 **and** Play App Signing SHA-1.
  - Ship `mobile/google-services.json` in the build; keep the server env
    `GOOGLE_WEB_CLIENT_ID` / `GOOGLE_ANDROID_CLIENT_ID` equal to the IDs whose
    consent screen/origins/SHA-1 are configured (they already default to the
    `707085023016-…` pair).

---

## BUG 4 (MEDIUM) — Dropdown forms don't scroll above the keyboard

### Reported symptom
Forms with a dropdown/picker don't scroll up when the keyboard opens, so the field
stays hidden behind the keyboard. (Checkout's village dropdown was fixed; the user
says other forms still have it.)

### Root cause
The shared `Screen` component is a bare `ScrollView` with **no keyboard handling**:
`mobile/src/components/ui.tsx:114-139` —
```
<View style={{ flex: 1, … }}>
  {header}
  <ScrollView contentContainerStyle={[{ padding: 14, paddingBottom: 32 }, …]}
    keyboardShouldPersistTaps="handled" …>
    {children}
  </ScrollView>
</View>
```
No `KeyboardAvoidingView`, no `scrollTo`/`scrollToFocusedInput` on focus. Any form
rendered inside `Screen` relies on Android's `softwareKeyboardLayoutMode: 'resize'`
(`app.config.ts`) alone, which does not reliably lift a field that sits low in a
scroll view.

The two screens that **already** handle it do so **locally**, not via `Screen`:
- `checkout.tsx:296-351` — the address-editor **Modal** owns its own
  `KeyboardAvoidingView` + `ScrollView` and calls
  `editorScroll.current?.scrollTo({ y: villageY … })` on the Village field's
  `onFocus` (`checkout.tsx:321-326`). This is the working reference pattern.
- `login.tsx:179` — wraps the whole screen in `KeyboardAvoidingView`.

### Per-screen findings (all form screens rendered inside bare `Screen`)
| Screen file | Form inputs | Has a dropdown? | Keyboard handling today | Needs fix? |
|---|---|---|---|---|
| `app/checkout.tsx` (address editor Modal) | name/mobile/email/address/landmark/**village**/pin | **Yes — village text-dropdown** | Own KAV + scroll-on-focus | **Already fixed (reference)** |
| `app/login.tsx` | username/password/register/forgot fields | No | Own `KeyboardAvoidingView` | Already handled |
| `app/(tabs)/profile.tsx:162,168` | recovery email + 6-digit code | No | Bare `Screen` only | Minor — add shared fix |
| `app/admin/roles.tsx:60` | mobile; Role = **button row**, Permissions = **chips** | No true dropdown (button selectors) | Bare `Screen` only | Minor — add shared fix |
| `app/admin/orders.tsx:54` | single search `Field` near top | No | Bare `Screen` only | Low — field is high up |
| `app/admin/order/[id].tsx` | status = **button row**; no text input | No | Bare `Screen` only | No (no keyboard field) |
| `app/track/index.tsx` / `track/[orderId].tsx:55` | single Order ID field | No | Bare `Screen` only | Low — field is high up |

**Key nuance:** the *only* screen with a true text-triggered dropdown behind the
keyboard is checkout, and it's already fixed. The other screens either have inputs
high on the page or use button-row/chip selectors (not keyboard-opening dropdowns),
so the user's "other dropdown forms" are more accurately "other forms whose low
fields hide behind the keyboard." The durable fix is at the source.

### Recommended fix (code)
- **Preferred (fixes all forms at once):** add keyboard avoidance **inside the
  shared `Screen`** (`mobile/src/components/ui.tsx:114`): wrap the `ScrollView` in a
  `KeyboardAvoidingView` (`behavior={Platform.OS === 'ios' ? 'padding' :
  undefined}`) and keep `keyboardShouldPersistTaps="handled"`. This lifts every
  `Screen`-based form (profile, roles, track, admin orders) without touching each
  screen. Verify on Android with `softwareKeyboardLayoutMode: 'resize'` already set.
- **For any future in-form text dropdown**, reuse the checkout pattern exactly:
  capture the field's `y` via `onLayout`, and in the field's `onFocus` call
  `scrollRef.current?.scrollTo({ y })` so the field + its in-flow option list sit
  above the keyboard (`checkout.tsx:314-337`).
- No server/console config.

---

## BUG 5 (MEDIUM) — Banner / background images don't show (app and/or web)

### Reported symptom
Admin-uploaded banners / background images don't display on the app home and/or
web storefront.

### How banners flow (traced end to end)
- **Store:** banners live in the `config.banners` JSON column, each with an `image`
  field. `POST /api/admin/banners` validates `image` as either an absolute
  `http(s)://` URL, the legacy `data/banners/<file>`, or the new
  `/api/uploads/banners/<file>` (`admin.ts:216`), then writes the array
  (`admin.ts:224`).
- **Upload:** `POST /api/admin/banners/upload` writes the file to
  `api-node/uploads/banners/` (`BANNER_DIR = process.cwd()/uploads/banners`,
  `admin.ts:229`, `:245-248`) and returns **`/api/uploads/banners/<name>`**
  (`admin.ts:249`). That folder is served by `express.static(BANNER_DIR)` mounted at
  `/api/uploads/banners` (`server.ts` static block).
- **Read:** `GET /api/config` returns `banners: parse(row.banners)`
  (`catalog.ts:84-94`).
- **Web render** (`web/src/pages/Home.tsx`): `bannerImage(src)` returns `src`
  unchanged if it matches `^(https?:|data:|/)` else prefixes `/`
  (`Home.tsx:14`). It then sets `background: url('<bannerImage>')`
  (`Home.tsx:76`). So `data/banners/x.webp` → `/data/banners/x.webp`;
  `/api/uploads/banners/x.webp` stays as-is.
- **Mobile render** (`mobile/app/(tabs)/index.tsx:106`):
  `<Image source={{ uri: absoluteUrl(b.image) }} …>`. `absoluteUrl` (config.ts)
  prefixes `SITE_URL` (`https://4astore.com`) for any non-`http/data/file` path
  (`src/config.ts:33-38`). So `data/banners/x.webp` →
  `https://4astore.com/data/banners/x.webp`; `/api/uploads/banners/x.webp` →
  `https://4astore.com/api/uploads/banners/x.webp`.
- **Admin preview** (`web/src/pages/admin/AdminBanners.tsx:17`): `imageSrc` prefixes
  `/` for bare paths — same rule as the storefront.

**Conclusion on code:** URL construction is **correct on all surfaces** — this is
NOT a relative-vs-absolute code bug like the push-image case. Both clients build a
loadable URL for both the legacy and new path shapes.

### Root cause — the files aren't where the resolved URL points on the new server
Local inspection shows the mismatch that breaks production:

1. **All existing banner files live in `web/public/data/banners/`** (verified:
   `banner_20260925_175645_5950908e.webp`, …, plus an Apache `.htaccess`). The DB's
   `config.banners[].image` therefore stores the **legacy `data/banners/<file>`**
   shape, which both clients resolve to the **web origin** (`/data/banners/…` on web,
   `https://4astore.com/data/banners/…` on mobile).
2. **`api-node/uploads/banners/` is EMPTY locally** — no file has been written through
   the current `/api/uploads/banners` upload path yet. So nothing depends on the API
   static mount today; everything depends on the **web origin serving
   `/data/banners/*`**.
3. **The deploy script excludes `web/public/data` from the rsync**
   (`deploy.sh:28`, `WEB_EXCLUDES=(… --exclude='public/data')`) specifically to
   *preserve* it. That protects files that are **already on the live server**, but on
   a **fresh/new server `web/public/data/banners` starts empty** and the exclude
   means `git pull` + rsync will **never populate it** → every `/data/banners/*`
   request 404s → banners render as empty/fallback gradient (mobile falls back to the
   `AnimatedGradient`; web shows the overlay with no background image).
4. **Serving-origin assumption.** The legacy files were served by **Apache**
   (hence the `.htaccess` in `web/public/data/banners`). The new deploy serves the
   web app as a built **`dist/`** under nginx (`deploy.sh:4-5`, `LIVE_WEB=/var/www/html/web`,
   `npm run build`). Vite copies `public/` into `dist/` **at build time** — but since
   the live `public/data` is empty (excluded from sync), the built `dist/data/banners`
   is also empty. And nginx must be configured to serve `/data/*` from the web root;
   if it only serves hashed Vite assets and proxies `/api`, `/data/banners/*` 404s.
   The `.htaccess` is inert under nginx.
5. **New-upload path (forward-looking):** once an admin uploads a *new* banner, the
   image returns `/api/uploads/banners/<name>` and lives in `api-node/uploads/banners`
   (preserved by the deploy via `--exclude='uploads'`, `deploy.sh:27`). That works
   **only if** nginx reverse-proxies `/api/*` to the Node API (it must, since the
   whole app calls `/api`). So new uploads are the robust path; the legacy
   `data/banners/*` files are the ones at risk.

### How to confirm (on the server)
- `curl -I https://4astore.com/data/banners/banner_20260925_175645_5950908e.webp`
  → **404** confirms the legacy files aren't served from the web origin (root cause).
  **200** means the file is present and the problem is elsewhere (e.g. CSP/mixed
  content).
- `ls -la /var/www/html/web/dist/data/banners/` on the server → empty/missing
  confirms the files never made it into the deployed web root.
- `curl -I https://4astore.com/api/uploads/banners/<any-new-upload>.webp` after
  uploading one new banner → **200** confirms the API static mount + nginx `/api`
  proxy work (so the fix is to move legacy files onto that path or into the web root).
- Check the DB: `SELECT banners FROM config WHERE id = 1;` and read each `image` —
  confirm they are `data/banners/*` (legacy) vs `/api/uploads/banners/*` (new).

### Recommended fix
This is primarily **deploy/data restoration + serving config**, with one optional
code hardening:

1. **Restore the legacy banner files to the live server** at the origin the URLs
   point to. Either:
   - Copy `web/public/data/banners/*` into the deployed web root
     (`/var/www/html/web/dist/data/banners/`) and ensure **nginx serves `/data/`**
     from the web root; OR
   - **Migrate** legacy banners to the API-served path: copy the files into
     `api-node/uploads/banners/` and update each `config.banners[].image` from
     `data/banners/<f>` to `/api/uploads/banners/<f>` (one `UPDATE config …`), so they
     ride the same preserved, proxied path as new uploads. This is the more robust
     long-term fix because `api-node/uploads` is already preserved by the deploy and
     proxied by nginx.
2. **nginx:** confirm a location block proxies `/api/` (incl. `/api/uploads/`) to the
   Node API, and — if keeping legacy paths — serves `/data/` from the web root.
3. **Optional code hardening:** have the storefront/app treat a bare `data/banners/*`
   as `/api/uploads/banners/*`-equivalent only after migration; until then, no code
   change is needed because the URL building is already correct. Do **not** change
   `absoluteUrl`/`bannerImage` — they are correct; changing them would just move the
   404 around.

No source change is required to make banners show once the files are served at the
resolved URL; the durable fix is migrating legacy banners onto the preserved,
proxied `/api/uploads/banners/*` path.

---

## Appendix — files read
- `api-node/src/routes/orders.ts` (create, accept, status none here, screenshot)
- `api-node/src/routes/admin.ts` (`POST /orders/status`, delete, create)
- `api-node/src/routes/tracking.ts` (`POST /status` rider path)
- `api-node/src/routes/users.ts` (login, register, **social-login**, refresh)
- `api-node/src/services/push.ts` (notifyStaffNewOrder/Customer, FCM init, sends)
- `api-node/src/db.ts`, `config.ts`, `server.ts`, `.env`, `prisma/schema.prisma`
- `api-node/src/auth/middleware.ts`, `utils/serviceability.ts`, `utils/mailer.ts`
- `web/src/pages/admin/AdminOrders.tsx`, `web/src/pages/admin/adminData.ts`
- `web/src/lib/admin.ts`, `web/src/lib/api.ts`, `web/src/pages/Login.tsx`
- `mobile/app/checkout.tsx`, `mobile/app/login.tsx`, `mobile/app/admin/orders.tsx`,
  `mobile/app/admin/order/[id].tsx`, `mobile/app/admin/roles.tsx`,
  `mobile/app/(tabs)/profile.tsx`, `mobile/app/track/[orderId].tsx`
- `mobile/src/api.ts`, `mobile/src/config.ts`, `mobile/src/queries.ts`,
  `mobile/src/components/ui.tsx`, `mobile/app.config.ts`
- BUG 5: `api-node/src/routes/admin.ts` (banners + upload), `catalog.ts` (`GET /config`),
  `web/src/pages/Home.tsx`, `web/src/pages/admin/AdminBanners.tsx`,
  `mobile/app/(tabs)/index.tsx`, `deploy.sh`, `web/.env.example`,
  `web/public/data/banners/` (files on disk), `api-node/uploads/banners/` (empty)
- Prior audit: `.agents/tasks/push-login-audit.md`

All citations are from `main` @ `38d825b2`. No files were modified.
