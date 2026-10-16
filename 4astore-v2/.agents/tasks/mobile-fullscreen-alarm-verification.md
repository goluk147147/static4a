# Verification — Order full-screen alarm alert + Promo full-screen in-app image (versionCode 36)

MOBILE ONLY. No `api-node/`, `prisma/`, or `web/` file changed. `src/share.ts` untouched (short-link
fix already committed `718501df`).

## Notifee v9.1.8 fields/categories used (verified against installed type defs)

Confirmed present in `node_modules/@notifee/react-native/dist/types/` before use (RN runtime can't be
`require`d in Node, so the `.d.ts` were inspected directly):

- `AndroidCategory` enum — exports `CALL = "call"` and `ALARM = "alarm"` (plus others). **Used
  `AndroidCategory.CALL`** on order draws → incoming-call style card the founder asked for.
- `AndroidNotification.fullScreenAction?: NotificationFullScreenAction` — interface has `id: string`
  (required) and `launchActivity?: string` (optional). **Used `{ id: 'default', launchActivity:
  'default' }`** — `'default'` is Notifee's sentinel for the app's own main activity, so no custom
  native Activity is added. `mainComponent` is NOT exported in v9.1.8 → not used.
- `AndroidNotification.loopSound?: boolean` — present → `loopSound: true` on order draws so the
  alarm keeps ringing until opened/dismissed.
- `AndroidChannel.bypassDnd?: boolean` — present → `bypassDnd: true` on the `orders` channel.
- `AndroidImportance.HIGH`, `AndroidVisibility.PUBLIC` — already imported, reused on order draws.
- `vibrationPattern: number[]` — kept to the project's hard rule: EVEN count, all strictly POSITIVE
  ms. `orders` channel + foreground buzz now `[800, 400, 800, 400, 800, 400]` (6 positive values).

No invented fields. No `priority`/`ongoing` hacks.

## A) Owner full-screen + alarm behaviour

- `ensureChannels()` `orders` channel: `importance HIGH`, `vibrationPattern [800,400,800,400,800,400]`,
  `bypassDnd: true`, inside the existing `try/catch` (a rejected config still never aborts token
  registration or a draw).
- Order draw path (`drawRich()` AND the `displayPush()` catch-fallback): when
  `isOrderPush(data)` (`type` ∈ {new_order, new_order_local, order_reminder} OR `channelId === 'orders'`)
  the android block gets `category: CALL`, `importance: HIGH`,
  `fullScreenAction: { id: 'default', launchActivity: 'default' }`, `loopSound: true`,
  `visibility: PUBLIC`. Existing `channelId/smallIcon/color/largeIcon/pressAction/style` and the
  single-draw `notifId` behaviour are unchanged. Customer/promo/default draws (isOrder false) are
  byte-for-byte unchanged.
- Foreground `Vibration.vibrate` for `new_order`/`order_reminder` lengthened to
  `[800,400,800,400,800,400]`.

## B) Customer promo full-screen in-app image flow

- New expo-router dynamic route **`app/promo/[image].tsx`** (matches `app/track/[orderId].tsx` style:
  `useLocalSearchParams` + `useRouter`). `[image]` is the `encodeURIComponent`-encoded absolute image
  URL; optional CTA link is a `link` query param.
- Renders RN core `Image` `resizeMode="contain"` on a black (`#000`) full-screen background → a 9:16
  image shows whole, no crop/scroll. Top-right ✕, tap-anywhere backdrop dismiss, and a bottom CTA
  (`View Offer`) shown only when `link` is present (follows it via `openLink`). `Image onError` sets a
  `failed` state → plain "Image load nahi hua" fallback with the close button; never crashes. No new
  dependency.
- Pure helpers added to `src/pushPayload.ts` (no native imports, unit-tested): `isPromoImagePush(data)`
  (true iff `data.image` is `https://…` AND `type` not in {new_order, new_order_local, order_reminder,
  order_status} and not `rider*`; absent type + image = promo) and `promoRoute(data)` (builds
  `/promo/<enc-image>[?link=<enc-link>]` or null).
- Tap wiring: `push.ts listenNotificationTaps` now delivers the tap when `data.link` OR
  `isPromoImagePush(data)` (so a link-less promo still opens). `app/_layout.tsx` callback takes
  `(link, data)`: `promoRoute(data)` → full-screen promo; otherwise the existing `legacyToRoute(link)`
  path. Order/status/rider taps (promoRoute null) keep exact existing routing; cold-start stashing via
  `pendingLink` reused through a new `navigateToRoute` helper.
- New unit tests `src/__tests__/pushImage.test.ts` (8 cases) cover promo-with/without-link, new_order,
  rider_assigned, order_status, non-https, no-image, undefined.

## C) Version bump

- `app.config.ts`: `VERSION_CODE` fallback `35 → 36` with comment
  `// 36 = order full-screen alarm alert + promo full-screen in-app image + short-link share fix`.
  `VERSION_NAME` unchanged (`2.0.0`).
- Added `android.permission.USE_FULL_SCREEN_INTENT` to `android.permissions` (appended; no existing
  permission or `blockedPermissions` entry removed).

## Verification run (from `4astore-v2/mobile`)

- `npm run typecheck` (tsc --noEmit) → **0 errors**.
- `npm run typecheck:tests` (tsconfig.test.json) → **0 errors**.
- `npm test` → **102 tests pass, 0 fail** (incl. the 8 new pushImage cases + pushPayload + qty-limit +
  analytics suites).
- NOT run (long-running; founder builds the .aab): gradle/.aab build, `expo prebuild`, Metro.

No temp files left behind.

## Reminders for the founder

- A NEW `.aab` at **versionCode 36** must be built (`npm run prebuild` then `npm run build:aab`) and
  uploaded to Play.
- On **Android 14+** the OS may require the user to grant full-screen-intent special access for the
  caller-card to show over the lock screen. The loud heads-up + looping alarm sound + hard vibration
  fire regardless; the full-screen card is the only part gated by that OS permission.
