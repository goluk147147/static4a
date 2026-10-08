# Notification Appearance Audit — 4A Store v2 (Rapido/Zepto-style push)

Read-only investigation. No source files were modified. All paths are in
`c:\xampp\htdocs\static4a\4astore-v2`. Scope: `api-node` + `mobile` + `web` only.
Legacy `4AStoreApp` / old PHP ignored.

---

## 1. Summary answer (TL;DR)

Two separate problems, two different root causes:

- **(A) No colour logo on the RIGHT (large icon) on real pushes.**
  The config plugin `withNotificationLargeIcon.js` *is* installed, *is* registered, and
  *did* run at prebuild (manifest meta-data + drawable both present). But the mechanism
  it relies on — the `expo.modules.notifications.large_notification_icon` manifest key —
  is only honored by expo-notifications' **own** notification builder
  (`ExpoNotificationBuilder.build()`), which runs **only when the app itself draws the
  notification**: i.e. foreground, or data-only FCM messages. For a **`notification`-type
  FCM message delivered while the app is backgrounded or killed, Android/Firebase draws
  the tray notification directly and never calls Expo's builder**, so the large-icon
  meta-data is ignored. The server currently sends a `notification`-type message, so on a
  real device (app in background) the large icon never appears. This is a **code/design
  gap** (wrong assumption about what the plugin can do), not a deploy gap.

- **(B) The 4A logo appearing as a BIG-PICTURE banner on every push.**
  This is **NOT** produced by the current `main` source. The current server code only
  sets an image when the admin supplies one (`api-node/src/services/push.ts` and
  `routes/push.ts`), and the web admin only sends an image when the field is filled
  (`web/.../AdminNotify.tsx`). So a banner on a text-only "now" push means the **running
  production server is older than commit `25b5c88c`** (the clean-text fix) — a **deploy
  gap**. The 4A-logo thumbnails you see in the admin Notification Log on `—` rows are
  **old DB rows** written by that same pre-fix code; they are history, not current output.

**Net:** (B) is fixed in code and just needs a server redeploy. (A) was never actually
achievable with the chosen plugin approach for background notifications and needs a
different mechanism (details in §5).

---

## 2. Reported vs desired

| | Desired (Rapido/Zepto) | Actual on device now |
|---|---|---|
| Left small icon | monochrome tinted app icon | ✅ correct (monochrome) |
| Right large icon | small **colour** logo (like Rapido "Captain") | ❌ absent |
| Body text | title + body | ✅ |
| Big-picture banner | **only** when a real image is attached | ❌ full 4A logo shown as banner on **every** push |
| Admin log thumbnail | only on rows with an image | ❌ 4A logo thumbnail on `—` (no-image) rows |

---

## 3. Evidence — server (api-node)

Current `main` source is the **clean** version. The logo is never put into the image
field unless the admin supplied an image.

- `api-node/src/services/push.ts`
  - `NOTIFICATION_LOGO_URL` is defined (line ~34) and is used **only** via
    `withLargeIcon()` as `data.largeIcon` — a plain data string:
    - `withLargeIcon()` (lines ~86–88): `return { largeIcon: NOTIFICATION_LOGO_URL, ...(data||{}) }`.
  - `androidConfig()` (lines ~90–103): sets `notification.imageUrl` **only** `if (msg.image)`.
  - `sendToTopic()` (lines ~118–121): `notification` spreads image **only** `...(msg.image ? { image: … } : {})`; `data: withLargeIcon(msg.data)`.
  - `sendToTokens()` (lines ~170–177): same guarded `...(msg.image ? { image } : {})`; `data: withLargeIcon(...)`.
  - **Conclusion:** no code path puts the logo into `notification.image` /
    `android.notification.imageUrl`. The logo only ever leaves as `data.largeIcon`.

- `api-node/src/routes/push.ts`
  - `POST /send` (lines ~79–96): `const image = parsed.data.image?.trim() || undefined;`
    then `const msg = { title, body, data: link ? { link } : {}, image };`. Image is
    `undefined` unless the admin typed/uploaded one. No logo default anywhere.
  - History write `recordNotification({ …, image, … })` stores whatever `image` was —
    so pre-fix rows that defaulted the logo keep showing it in the admin log (see §4).

- `git log` for these files:
  - `25b5c88c fix: clean text-only pushes + colour large icon for notifications` — the fix.
  - It is present in `main`'s history (HEAD = `a71c41dc`). So **source is fixed; the
    question is purely whether production was rebuilt/restarted after it**.

**Deploy gap confirmation.** `api-node/package.json`: `"start": "node dist/server.js"`,
`"build": "tsc"`. The server runs **compiled `dist/`**, and there is **no `dist/` checked
into the repo**, so production must be rebuilt (`npm run build`) and the process restarted
for `25b5c88c` to take effect. If that rebuild/restart did not happen after Oct-6, the
old banner-logo code is still live — which exactly matches the "banner on every push now"
symptom. **This single gap explains observation (B).**

---

## 4. Evidence — web admin (clean; old rows are historical)

`web/src/pages/admin/AdminNotify.tsx`:
- Compose form sends `image.trim() || undefined` — nothing is sent when empty.
- No default-logo prefill (removed in `25b5c88c`).
- Notification Log renders a thumbnail only `{n.image ? <img …/> : null}` and
  `targetLink()` shows `—` when there's no product/order/link.
- Therefore a row with Link/Product `—` **and** a 4A-logo thumbnail must have a non-null
  `image` column — i.e. it was written by the **pre-fix** server that defaulted the logo
  into `image`. These rows are old history; they are not evidence of current sending.
  (The `Success=0/Fail=0` on those rows is a separate, older accounting concern.)

---

## 5. Evidence — mobile large-icon mechanism (why A can't work in background)

The plugin is correctly wired, but the underlying assumption is wrong for background.

### 5.1 Plugin is installed and ran
- `mobile/app.config.ts` plugins array (end of list): `'./plugins/withNotificationLargeIcon'` — **registered**.
- `mobile/plugins/withNotificationLargeIcon.js`: copies
  `assets/images/notification-large-icon.png` → `res/drawable-xxhdpi/notification_large_icon.png`
  and adds manifest meta-data `expo.modules.notifications.large_notification_icon` →
  `@drawable/notification_large_icon`.
- Generated artifacts prove prebuild ran:
  - `mobile/android/app/src/main/res/drawable-xxhdpi/notification_large_icon.png` exists.
  - `mobile/android/app/src/main/AndroidManifest.xml` **line 41**:
    `<meta-data android:name="expo.modules.notifications.large_notification_icon" android:resource="@drawable/notification_large_icon"/>`.
- Source asset exists: `mobile/assets/images/notification-large-icon.png`.

### 5.2 What the native code actually does with that key
`mobile/node_modules/expo-notifications/.../builders/ExpoNotificationBuilder.kt`:
- `companion object`: `META_DATA_LARGE_ICON_KEY = "expo.modules.notifications.large_notification_icon"`.
- `val largeIcon` getter reads that meta-data and decodes the drawable to a Bitmap.
- In `build()` (the large-icon block):
  ```kotlin
  if (notificationContent.containsImage()) {
      val bitmap = notificationContent.getImage(context)
      bitmap?.let { builder.setLargeIcon(it) }   // image → LARGE ICON (NOT big-picture)
  } else {
      builder.setLargeIcon(largeIcon)             // manifest large_notification_icon
  }
  ```
  Two important facts:
  1. The manifest large icon is applied **only** by this builder.
  2. expo-notifications **never uses `BigPictureStyle`** — when an image is present it
     becomes the (small, right-side) `setLargeIcon`, not a big banner. So the big banner
     the device shows is **not** drawn by Expo at all → it is drawn by Firebase/OS from a
     `notification.image` payload (reinforcing that observation B = old server code).

### 5.3 When does `ExpoNotificationBuilder` run?
`mobile/node_modules/expo-notifications/.../service/ExpoFirebaseMessagingService.kt` and
`.../delegates/FirebaseMessagingDelegate.kt`:
- `onMessageReceived()` → `createNotification()` → `RemoteNotificationContent(remoteMessage)`
  → eventually `ExpoNotificationBuilder`.
- The delegate's own comment points to Firebase's receive-behavior table. Per that
  documented behavior: a message that contains a **`notification`** payload is delivered
  to `onMessageReceived()` **only when the app is in the foreground**. When the app is
  **backgrounded or killed**, the system tray notification is drawn by Firebase/OS
  directly and `onMessageReceived()` is **not** invoked → `ExpoNotificationBuilder` never
  runs → the `large_notification_icon` meta-data is **never applied**.
- `RemoteNotificationContent.kt`: `containsImage()` / `getImage()` read
  `remoteMessage.notification?.imageUrl`. The server's `data.largeIcon` string is in the
  **data** map and is **never read by any native code** as an icon. It is also never read
  by the JS layer as an icon (see 5.4).

### 5.4 Mobile JS handlers don't render `data.largeIcon` either
`mobile/src/push.ts`:
- `setNotificationHandler` (lines ~13–20) only returns show/sound/badge booleans — it
  cannot set a large icon.
- `listenForeground()` reads `data` but only forwards it to `onData(...)`; it does **not**
  turn `data.largeIcon` into any icon. `PushData` even types `largeIcon?: string` but
  nothing consumes it for presentation.
- So `data.largeIcon` is effectively dead weight: not used by native, not used by JS.

### 5.5 What the device screenshot tells us
- "Big logo banner + no right icon" is only consistent with: the OS/Firebase drew the
  notification (app backgrounded) from a `notification.image` payload. Expo never does
  big-picture, and the manifest large icon only works through Expo's builder. ⇒ the
  banner is coming from an **older server** still putting the logo in `image`, and the
  large icon is absent because background notifications bypass the Expo builder entirely.

---

## 6. Root cause

- **(B) Logo-as-banner — DEPLOY GAP.** Current `main` source does not send the logo as an
  image. The live server predates/does-not-run `25b5c88c`. Fix = rebuild + restart the
  Node API; no app rebuild needed. (Old admin-log thumbnails are historical rows and are
  expected to remain unless backfilled.)

- **(A) Missing colour large icon — CODE/DESIGN GAP (wrong assumption).** The chosen
  plugin mechanism (`large_notification_icon` manifest meta-data) only affects
  notifications drawn by expo-notifications' own builder, which does **not** run for
  background/killed `notification`-type FCM messages. For the primary real-world case
  (app not open) the large icon can never appear with the current message type. Not a
  deploy gap — rebuilding/redeploying as-is will not make the right-side logo appear in
  background.

---

## 7. Concrete, Expo-feasible fix plan

### 7.1 Fix (B) immediately — redeploy the API (no new app build)
1. On the production host, from `4astore-v2/api-node`: `npm run build` then restart the
   Node process (whatever supervises `node dist/server.js`).
2. Verify the deployed `dist/services/push.js` contains the guarded
   `...(msg.image ? { image: … } : {})` and `withLargeIcon` (i.e. logo only in
   `data.largeIcon`). Send a test text-only broadcast → it must arrive with **no banner**.
3. (Optional, cosmetic) Backfill: `UPDATE notifications SET image = NULL WHERE image = '<logo-url>'`
   so old `—` rows stop showing the logo thumbnail in the admin log. Owner decision; not
   required for correctness. **Confirm with owner before running** (data mutation).

> After 7.1, text-only pushes are clean and admin-supplied images render correctly. This
> already satisfies the "big-picture only when admin attaches an image" requirement — the
> server code is correct; it just needs to be the code that is running.

### 7.2 Fix (A) — reliably show the colour logo as the right-side large icon
The only approaches that work for **background/killed** delivery in an Expo-managed app:

**Option 1 (recommended) — switch broadcasts/status pushes to DATA-ONLY FCM messages so
Expo's builder always runs.**
- Server change: stop sending the `notification` block; send everything in `data`
  (`title`, `body`, `channelId`, optional `image`, `link`, etc.), i.e. an FCM data-only
  message with `android.priority: high`. With a data-only message `onMessageReceived()`
  fires in background/killed too, so `ExpoNotificationBuilder` runs and **the existing
  `large_notification_icon` meta-data (already in the manifest) becomes the right-side
  large icon** — exactly the desired look, with no extra native code.
- Caveats to call out honestly:
  - Data-only messages are not delivered while the app is force-stopped and can be
    throttled/delayed by Doze on some OEMs; for a store app this is normally acceptable,
    but the loud "new order (staff)" alert is latency-sensitive — test it.
  - For an admin-supplied image to show as a **big-picture banner** (not just a large
    icon) you'd additionally need a custom presentation, because expo-notifications maps
    `imageUrl` to `setLargeIcon`, not `BigPictureStyle` (see 5.2). If big-picture banners
    for promos matter, pair Option 1 with a Notifee/custom builder (Option 3).
- Requires: server change **and** a new app build only if any native/manifest change is
  needed — but the manifest large-icon key is already present, so **no app rebuild is
  strictly required for Option 1's large icon**; only the server changes. (Verify on a
  build that already contains the current manifest.)

**Option 2 — keep `notification`-type messages, accept OS rendering, and set the large
icon via a native notification extender.**
- For OS-drawn background notifications there is **no server field** for a remote large
  icon (FCM `AndroidNotification` exposes only `icon`, `color`, `image`). The large icon
  must come from the device. That requires a custom `FirebaseMessagingService` /
  `NotificationCompat` extender in native code (e.g. a small config plugin that injects a
  service, or Notifee). This is more work than Option 1 and still needs a new app build.

**Option 3 — adopt Notifee (`@notifee/react-native`) for full control.**
- Lets you set `largeIcon` and `style: BigPicture` explicitly for both foreground and
  (via a background handler on data messages) background. Most faithful to Rapido/Zepto
  (colour large icon always + big-picture only when image present). Cost: extra dependency
  and a new app build; still relies on data-only messages for guaranteed background wake.

**Recommendation:** Do **7.1 now** (restores clean text + correct admin-image banner with
just a redeploy). For the right-side colour logo, go with **Option 1** (data-only messages)
since the manifest large-icon key is already wired — smallest change, no new native code.
If the product also wants true big-picture promo banners rendered by the app, add
**Option 3 (Notifee)** on top. In all cases, update the misleading comments/commit claim
that the plugin makes "background pushes show the colour logo" — that is not true for
`notification`-type messages.

### 7.3 Build/redeploy matrix
| Fix | Server redeploy? | New app build? | Owner config? |
|---|---|---|---|
| (B) clean text / admin-image banner | **Yes** (`npm run build` + restart) | No | Optional DB backfill (confirm first) |
| (A) via Option 1 (data-only) | **Yes** (payload change) | Not required for large icon (manifest already has the key); test first | — |
| (A) via Option 2 (native extender) | Maybe | **Yes** | — |
| (A) via Option 3 (Notifee + data-only) | **Yes** | **Yes** | — |

---

## 8. Answers to the brief's explicit questions

- **Does any current code path put the logo into `notification.image` / `imageUrl` with no
  admin image?** No. All three send paths guard image behind `if (msg.image)` /
  `...(msg.image ? … : {})`; the logo only goes to `data.largeIcon`.
  (`services/push.ts` sendToTopic ~118, sendToTokens ~170, androidConfig ~100;
  `routes/push.ts` /send ~84.)
- **Is the plugin registered and did it run at prebuild?** Yes to both — manifest line 41
  and the copied drawable prove it.
- **Does expo-notifications honor that meta-data for OS-drawn background FCM?** No. It is
  honored only inside `ExpoNotificationBuilder`, which does not run for background/killed
  `notification`-type messages. Correct assumption only for foreground / data-only.
- **Why is the big logo appearing as a banner now?** Because the live server is older than
  `25b5c88c` and still sets the logo as `notification.image` (deploy gap). It is not the
  mobile handler misreading `data.largeIcon` (that value is never rendered), and the
  device "now" push reflects current server behavior, not old DB rows.
- **Is production running latest main?** Cannot be confirmed from the repo (no `dist/` is
  checked in; server runs compiled `dist/`). The symptom strongly indicates it is **not**.
  Confirm by inspecting the deployed `dist/services/push.js` for the guarded image code.

---

## 9. Key file:line references
- `api-node/src/services/push.ts`: `NOTIFICATION_LOGO_URL` ~34; `withLargeIcon` ~86–88;
  `androidConfig` imageUrl guard ~100; `sendToTopic` image guard ~118–121; `sendToTokens`
  image guard ~170–177.
- `api-node/src/routes/push.ts`: `/send` image handling ~84; `msg` build ~85.
- `web/src/pages/admin/AdminNotify.tsx`: send image guard (`send()`), log thumbnail
  `{n.image ? <img>}`, `targetLink()` `—` fallback.
- `mobile/app.config.ts`: `expo-notifications` small-icon plugin; `withNotificationLargeIcon` registration (end of plugins).
- `mobile/plugins/withNotificationLargeIcon.js`: drawable copy + meta-data injection.
- `mobile/android/app/src/main/AndroidManifest.xml:41`: large-icon meta-data (prebuild output).
- `mobile/node_modules/expo-notifications/android/.../ExpoNotificationBuilder.kt`:
  `META_DATA_LARGE_ICON_KEY`, `largeIcon` getter, `build()` large-icon/image branch.
- `mobile/node_modules/expo-notifications/android/.../ExpoFirebaseMessagingService.kt` +
  `.../FirebaseMessagingDelegate.kt`: `onMessageReceived` entry (foreground/data only).
- `mobile/node_modules/expo-notifications/android/.../RemoteNotificationContent.kt`:
  `containsImage()` / `getImage()` read `notification.imageUrl`.
- Fix commit: `25b5c88c` (present in `main`; HEAD `a71c41dc`).
