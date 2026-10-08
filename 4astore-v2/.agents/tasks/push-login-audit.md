# Push + Login Audit — 4A Store v2

Read-only investigation of three high-priority bugs. Repo scope: `4astore-v2` only
(legacy `4AStoreApp`, old PHP `/api`, and root `*.html` ignored). Branch at time of
audit: `main` @ `0a3bf939`.

No source files were modified.

---

## Summary (read this first)

- **BUG 1 (push reaches 0 users) — TWO distinct problems, both real:**
  1. **Reporting bug (certain, in code):** For a broadcast to `all` / `customers` /
     `riders`, the send handler calls `sendToTopic(target, msg)`, which returns a
     **boolean**, and then records the history row with `successCount = 0` and
     `failureCount = 0` **always** — because `tokens` is an empty array on the topic
     path. So "Success=0, Fail=0" is written **no matter what FCM did**. This fully
     explains the Notification Log numbers and tells you nothing about real delivery.
  2. **Delivery bug (most likely root cause on the server):** FCM is almost certainly
     **disabled in production** because the service-account JSON is not found at the
     configured path, so `sendToTopic()` hits the dev no-op branch, logs `[push:dev]`,
     returns `false`, and **sends nothing** — while the HTTP response is still `200`.
     Confirm with one log line and one `ls` on the server (steps below). The "devices
     not subscribed to the topic" hypothesis is **weaker**: the register route *does*
     subscribe native tokens to `all` on every launch/login — but note that if FCM is
     disabled, that subscription is also a no-op, so the two failures share one root
     cause.

- **BUG 2 (default logo on image-less pushes):** The **current code does NOT default
  the image to the logo.** The fix in `25b5c88c` is intact. What the user sees is one
  (or both) of: (a) **old notification rows** created before the fix, which still carry
  the logo in the DB and will always render it in the history table; and (b) the
  **`data.largeIcon`** value, which is still set to the logo on *every* push on purpose
  — that is the small right-side app icon on the device, not the admin thumbnail and
  not the big-picture banner. New text-only sends store `image = NULL` and show no
  thumbnail. Action: redeploy is not needed for the code; the user is looking at old
  records. See the "largeIcon" note if they also mean the device icon.

- **BUG 3 (logout/login broken after update):** Login, logout, refresh, and bootstrap
  are all sound and local-first. The one real gap: **`setOnSessionExpired()` is never
  wired.** `src/api.ts` exports it and calls `onSessionExpired?.()` when a hard refresh
  failure means the session is dead, but nothing in the app ever registers a callback,
  so `onSessionExpired` stays `null`. Result: when the ~1-year refresh token is finally
  rejected (expired/revoked/server token table reset), the API throws "Session expired"
  but the Zustand `user` state is **not cleared**, so the UI keeps showing a logged-in
  shell that can't load data instead of bouncing the user to `/login`. This matches
  "login/logout broken after the update" for users whose old refresh token no longer
  validates against the new server.

---

## BUG 1 (CRITICAL) — Broadcast reports Success=0/Fail=0 and reaches nobody

### Reported symptom
Admin Notification Log shows a broadcast to `all` with `success_count=0` AND
`failure_count=0`. UI says "Notification sent", API returns `200`, but 0 devices
receive it. 6 device tokens exist, updated within 7 days.

### Root cause

**(a) The success/fail counts are hard-wired to 0 on the topic path.**

`api-node/src/routes/push.ts`, `POST /api/push/send` handler
(`push.ts:76`–`push.ts:118`):

```
let tokens: string[] = [];
let successCount = 0;
if (target === 'admins') {
  tokens = await tokensForStaff('orders');
  if (tokens.length) successCount = await sendToTokens(tokens, msg);
  else await sendToTopic('admins', msg);
} else {
  await sendToTopic(target, msg);          // push.ts:98 — 'all' | 'customers' | 'riders'
}
await recordNotification(
  { ...meta... },
  tokens,                                   // [] on the topic path
  successCount,                             // 0 on the topic path
  tokens.length ? tokens.length - successCount : 0   // 0 on the topic path
);
```

For `target` = `all` / `customers` / `riders`, `tokens` stays `[]` and `successCount`
stays `0`, so `recordNotification(..., [], 0, 0)` always writes `success_count=0`,
`failure_count=0`. This is a **reporting defect**: FCM topic sends return a single
message ID, not a per-device count (`sendToTopic` returns `boolean` —
`api-node/src/services/push.ts:106`–`push.ts:124`), so there is no count to record and
the code records zeros. The displayed numbers are therefore meaningless for topic
broadcasts and cannot be used to judge delivery.

**(b) FCM is most likely disabled in production, so nothing is actually sent.**

`initFirebase()` in `api-node/src/services/push.ts:41`–`push.ts:71`:
- Reads `config.fcmServiceAccount` = `process.env.FCM_SERVICE_ACCOUNT`
  (`api-node/src/config.ts:42`).
- If unset → logs `"[push] FCM_SERVICE_ACCOUNT not set — push disabled (dev mode)."`
  and leaves `enabled = false` (`push.ts:46`–`push.ts:49`).
- If set but the file is missing → logs
  `"[push] service account file not found at <path> — push disabled."` and leaves
  `enabled = false` (`push.ts:52`–`push.ts:56`).

The checked-in `.env` sets a **relative** path:
`FCM_SERVICE_ACCOUNT=./fcm-service-account.json` (`api-node/.env:35`). Relative paths
are resolved against `process.cwd()` (`push.ts:51`). If the production process is
started from a different working directory than `api-node/`, or the JSON was never
uploaded, `fs.existsSync` fails and push is silently disabled.

When disabled, `sendToTopic()` takes the dev branch
(`api-node/src/services/push.ts:108`–`push.ts:113`):

```
if (!enabled) {
  console.log(`[push:dev] topic=${topic} ...`);
  return false;                            // nothing sent to FCM
}
```

So the HTTP call returns `200` (the handler never inspects the boolean), the log shows
`[push:dev]`, and **no device is contacted**. This is the leading root cause of "0
users received it".

**(c) Subscription hypothesis — weaker, but documented.**

The register route *does* subscribe native tokens to the role topics on every
registration (`api-node/src/routes/push.ts:52`–`push.ts:54`):

```
if (platform !== 'web') await syncTokenTopics(token, topics).catch(() => null);
```

and `topicsForUser()` always includes `'all'` (`push.ts:12`–`push.ts:19`). The mobile
app calls `registerForPush()` on every launch and on user/role change
(`mobile/app/_layout.tsx:50`–`push.ts` registration at `mobile/src/push.ts:50`–`push.ts:66`),
so a healthy install re-subscribes to `all` continuously. **Therefore "tokens exist but
were never subscribed" is unlikely to be the primary cause** — *unless* FCM is disabled,
in which case `syncTokenTopics` also hits its own `!enabled` no-op
(`api-node/src/services/push.ts:134`–`push.ts:140`) and no subscription ever happens.
Both symptoms then collapse into the single root cause (b).

Note: the one row in the **local** dev DB is a `web` token subscribed in the DB column
to `["all","customers","admins"]`, but `syncTokenTopics` is skipped for web
(`push.ts:53`), so web tokens are never subscribed in FCM. Web is not the reported
surface (the 6 tokens are the Android app), so this is a side note, not the bug.

### How to confirm (on the production server)

1. **Is FCM enabled?** Grep the API process logs/stdout for one of:
   - `"[push] FCM initialized."` → enabled, go to step 3.
   - `"[push] FCM_SERVICE_ACCOUNT not set — push disabled (dev mode)."` → env var missing.
   - `"[push] service account file not found at <path> — push disabled."` → path wrong /
     file not uploaded.
   - `"[push:dev] topic=all ..."` appearing when you send a broadcast → **disabled**,
     confirmed; nothing was sent.
2. **Does the service account exist where the process looks?** On the server run
   `echo $FCM_SERVICE_ACCOUNT` and confirm the resolved file exists (prefer an absolute
   path as the `.env` comment at `api-node/.env:33` already advises:
   `/var/www/.../api-node/fcm-service-account.json`).
3. **Are the 6 tokens subscribed to `all`?** In the Firebase console you cannot list
   topic members directly; instead send a test to topic `all` from Firebase Console →
   Messaging and see if the devices receive it. If Console delivery works but the admin
   broadcast does not, the fault is server-side (FCM disabled in the Node process).
4. **DB cross-check:** `SELECT id, target, image IS NOT NULL AS has_img,
   success_count, failure_count, created_at FROM notifications ORDER BY id DESC LIMIT 10;`
   — expect `success_count=0, failure_count=0` on every `all`/`customers`/`riders` row
   regardless of real delivery (that confirms the reporting defect (a)).
   (The local XAMPP DB has no `notifications` table and only a stale web token, so this
   query must be run against the production DB.)

### Recommended fix
- **Delivery:** Set `FCM_SERVICE_ACCOUNT` in the production `.env` to an **absolute**
  path and upload the JSON there; restart the API; confirm the `"[push] FCM initialized."`
  log. This is the single change most likely to make pushes arrive.
- **Reporting:** Make the topic path record a meaningful count instead of a misleading
  `0/0`. Options, in order of preference:
  1. Have `sendToTopic` return something truthy and record `success_count` as the number
     of tokens known to be subscribed to that topic (query `device_tokens` by
     `JSON_CONTAINS(topics, '"all"')`), or
  2. For broadcasts, prefer `sendToTokens` over topic sends when the token set is small
     (6 devices), reusing the per-device `successCount` already returned by
     `sendEachForMulticast` (`api-node/src/services/push.ts:171`–`push.ts:200`). This
     also yields accurate dead-token pruning.
  3. At minimum, when `sendToTopic` returns `false` (disabled/failed), record the row as
     failed rather than `0/0 success` so the admin sees that nothing went out.
- **Startup guard (optional):** Log loudly (warning) at boot in production when push is
  disabled, so a missing service account is caught before a broadcast is attempted.

---

## BUG 2 (HIGH) — Default logo still shows on image-less notifications

### Reported symptom
Admin Notification Log still shows the 4A logo thumbnail on notifications sent without an
explicit image, despite commit `25b5c88c` ("clean text-only pushes").

### Root cause — the current code does NOT default the image

- **Send handler** (`api-node/src/routes/push.ts:82`–`push.ts:84`):
  ```
  const image = parsed.data.image?.trim() || undefined;   // undefined when admin sends none
  const msg: PushMessage = { title, body, data: link ? { link } : {}, image };
  ```
  No fallback to `NOTIFICATION_LOGO_URL`. `recordNotification` stores
  `meta.image ?? null` (`api-node/src/services/push.ts:243`–`push.ts:256`), so an
  image-less send writes `image = NULL`.
- **Service payload** builds the big-picture banner only when an image is present:
  `...(msg.image ? { image: absolutePublicUrl(msg.image) } : {})`
  (`api-node/src/services/push.ts:114`–`push.ts:118` for topic, `push.ts:181`–`push.ts:185`
  for multicast; `androidConfig` guards `imageUrl` the same way at `push.ts:95`–`push.ts:101`).
- **Web admin thumbnail** renders only when `n.image` is truthy
  (`web/src/pages/admin/AdminNotify.tsx`, history row ~`line 148`:
  `{n.image ? <img src={n.image} .../> : null}`), and the compose preview explicitly
  shows "No image — clean text-only notification" when the field is empty.

So on the **current** code, a text-only send shows **no** thumbnail in the log and **no**
banner on the device. The fix is present and working.

### Why the user still sees the logo (two explanations)

1. **Old DB rows.** Notifications created *before* `25b5c88c` were stored with the logo
   URL in `notifications.image`. The history list reads whatever is stored, so those
   historical rows will **always** render the logo thumbnail. New rows won't. Confirm:
   `SELECT id, image, created_at FROM notifications WHERE image IS NOT NULL ORDER BY id
   DESC;` — check whether the logo-bearing rows predate the deploy of `25b5c88c`.
2. **The `largeIcon` on the device (not the admin thumbnail).** Every push still carries
   `data.largeIcon = NOTIFICATION_LOGO_URL` by design
   (`withLargeIcon`, `api-node/src/services/push.ts:84`–`push.ts:86`; constant at
   `push.ts:33`). That renders as the small right-side app logo in the device tray via
   the foreground handler — it is intentional branding, separate from the big-picture
   banner and from the admin log thumbnail. If the user means "the small app logo on the
   notification itself", that is expected and matches their stated requirement ("default
   logo only, name 4astore"). If they want it gone even as the small icon, that is a
   deliberate change, not a regression.

### How to confirm
- Send a fresh text-only broadcast on production, then open the log: the new row must
  have an empty "image" cell and no thumbnail. If it does, the code is correct and the
  user was looking at old rows.
- Run the SQL in (1) to date the logo-bearing rows against the `25b5c88c` deploy time.

### Recommended fix
No code change required for the admin thumbnail / big-picture banner — redeploy of the
current `main` is sufficient and, if already deployed, nothing more is needed. Optional
cosmetic cleanup: a one-time `UPDATE notifications SET image = NULL WHERE image = '<logo
url>'` to scrub historical rows so the log looks consistent. Only touch `data.largeIcon`
if the user explicitly wants the small app icon removed from the device notification
(not recommended — it is the intended branding).

---

## BUG 3 (HIGH) — Logout/login "broken" after the app update

### Reported symptom
After updating to the new version, login/logout behaves incorrectly for existing users.

### What is actually correct (ruled out)

- **Login / social / register** all set the access token in memory and persist the
  refresh token to SecureStore (`mobile/src/store/auth.ts:43`–`push.ts:71`).
- **Logout is local-first:** it clears the in-memory token and `user` state
  synchronously, then best-effort unregisters the push token and revokes the refresh
  token in the background (`mobile/src/store/auth.ts:72`–`push.ts:90`). The UI flips to
  logged-out instantly even offline.
- **Bootstrap** silently refreshes on launch and always sets `ready` in `finally`, so a
  failed/offline refresh still releases the splash loader
  (`mobile/src/store/auth.ts:92`–`push.ts:99`).
- **Refresh route is non-rotating** (`api-node/src/routes/users.ts:259`–`push.ts:272`):
  it validates the stored refresh token and returns a new access token without replacing
  the refresh token, so a valid long-lived refresh token keeps working across restarts —
  this is robust and is **not** the cause.
- The 401 recovery in `src/api.ts` is bounded (single refresh + single retry, guarded by
  `_retried` and single-flight `refreshing`), so there is no login loop/hang
  (`mobile/src/api.ts:140`–`push.ts:163`).

### Root cause — `setOnSessionExpired()` is never wired

`mobile/src/api.ts:27`–`push.ts:31` defines the hook and `mobile/src/api.ts:156`–`push.ts:162`
invokes it on a hard session death:

```
let onSessionExpired: (() => void) | null = null;
export const setOnSessionExpired = (fn) => { onSessionExpired = fn; };
...
// refresh failed too → session truly dead
accessToken = null;
await clearRefreshToken().catch(() => null);
onSessionExpired?.();            // ← no-op: nobody ever set it
throw new ApiError('Session expired. Please log in again ...', 401, opts.silent);
```

A repo-wide search finds **only the definition** of `setOnSessionExpired` — no call site
in app code (confirmed via grep across `mobile/`; the only other hits are the compiled
release bundle maps and a FEAT-003 artifact note that explicitly instructed *not* to
invent the hook). So `onSessionExpired` stays `null`.

Consequence: when an existing user's old refresh token no longer validates against the
updated server (expired after the long TTL, revoked, or the server's `refresh_tokens`
table was reset during the deploy), `refreshSession()` returns `null`, the API clears the
tokens and throws "Session expired", **but the Zustand `user` is never set to `null`**.
Screens that gate on `user` (e.g. `app/admin/order/[id].tsx:103`, `app/admin/roles.tsx:31`,
`app/(tabs)/orders.tsx:23`, `app/checkout.tsx:60`) still think the user is logged in, so
the app shows a logged-in shell that cannot load data and does not redirect to `/login` —
which reads to the user as "login/logout broken after the update". The failure surfaces
precisely for users carrying a pre-update session, matching the report.

### How to confirm
- On a device with an old/expired or server-revoked session, open the app: observe that
  it stays on a logged-in screen (e.g. Profile/Orders) that fails to load rather than
  redirecting to Login, and the "Session expired" toast/error appears without the user
  state clearing. Logging out manually then works (local-first), which is why the symptom
  reads as inconsistent.
- Reproduce deterministically: revoke the user's refresh token in the DB
  (`UPDATE refresh_tokens SET revoked = 1 WHERE user_id = <id>;`), relaunch the app, and
  watch that `user` stays non-null while API calls 401.

### Recommended fix
Wire `setOnSessionExpired` to the auth store so a dead session clears `user` and routes to
login. Minimal, low-risk: in `mobile/src/store/auth.ts` (or in `_layout.tsx` bootstrap),
register a callback once:

```
import { setOnSessionExpired } from '../api';
// during store init / app bootstrap:
setOnSessionExpired(() => { useAuth.getState().setUser(null); });
```

and let the existing per-screen `if (ready && !user) router.replace('/login')` guards do
the redirect (they already exist). Do **not** change the refresh/rotation logic or the
local-first logout — they are correct. Keep Bearer auth, SecureStore refresh token, and
`X-Client: mobile` unchanged.

---

## Appendix — files read

- `api-node/src/routes/push.ts` (send handler, register/unregister, admin notifications list)
- `api-node/src/services/push.ts` (initFirebase, sendToTopic, sendToTokens, syncTokenTopics, recordNotification, NOTIFICATION_LOGO_URL, withLargeIcon)
- `api-node/src/config.ts` (fcmServiceAccount)
- `api-node/.env` (FCM_SERVICE_ACCOUNT=./fcm-service-account.json; local dev values)
- `api-node/src/routes/users.ts` (login, social-login, register, refresh, logout)
- `mobile/src/push.ts` (registerForPush, unregisterPush, listenTokenRotation, channels)
- `mobile/src/api.ts` (access/refresh token handling, refreshSession, 401 recovery, setOnSessionExpired)
- `mobile/src/store/auth.ts` (login/social/register/logout/bootstrap/reloadSession)
- `mobile/app/_layout.tsx` (bootstrap, registerForPush on user/role, push listeners)
- `mobile/app/login.tsx` (login/register/forgot/social UI)
- `web/src/pages/admin/AdminNotify.tsx` (compose + history list, image handling)

Environment note: the local XAMPP DB (`four_a_store`) is stale — it has no
`notifications` table and only one legacy `web` device token — so BUG 1 and BUG 2 DB
confirmations must be run against the **production** database. All code citations above
are from the current `main` branch.
