# Verification — Notification-permission nudge + full-screen-intent enable nudge (4AStore mobile)

Scope: MOBILE ONLY (`4astore-v2/mobile`). Additive, no regression. `versionCode` stays **36**.

## What was implemented

New files (all under `4astore-v2/mobile`):
- `src/notifPermissionGate.ts` — PURE, native-free decision helpers (`shouldShowPermissionBanner`, `shouldShowFullScreenNudge`) + the `NotifStatus` type. Native-free so `node:test` can import it without mocking expo modules (mirrors `pushGate.ts`).
- `src/notifPermission.ts` — no-throw native wrappers: `getNotifStatus()`, `requestNotif()`, `openNotifSettings()`, `openFullScreenIntentSettings()`. Re-exports the pure helpers so callers import from one place. `expo-notifications` is the single permission authority (same source as `getPushPermission` in `push.ts`); Notifee is NOT touched here.
- `src/components/NotifPermissionGate.tsx` — launch permission nudge + dismissible banner.
- `src/components/FullScreenIntentNudge.tsx` — Android-14+ staff-only one-time full-screen-intent nudge.
- `src/__tests__/notifPermissionGate.test.ts` — 9 unit tests for the pure gates.

Edited:
- `app/_layout.tsx` — mounts `<NotifPermissionGate />` and `<FullScreenIntentNudge />` alongside the existing sibling components, with `<Overlays />` LAST so toasts stay on top. The existing launch/resume `registerForPush()` effects are UNCHANGED.

## Launch notification nudge behavior

- On mount, read status via `getNotifStatus()`.
  - **undetermined → request once**: calls `requestNotif()` (the OS dialog). If the result is `granted`, immediately calls `registerForPush()` so the FCM token is sent right away.
  - **denied → banner + settings deep-link**: renders a dismissible top banner (near `insets.top`, `zIndex 9990` so the toast stack at 9999 stays above) with bilingual copy ("🔔 Notification on karein" / "Enable notifications...") and a "Chalu karein / Enable" button that calls `openNotifSettings()` — Android `APP_NOTIFICATION_SETTINGS` with the `android.provider.extra.APP_PACKAGE` extra, falling back to `Linking.openSettings()`.
  - **granted → no banner.**
- **Resume re-check**: an `AppState` 'active' listener re-reads status; when it becomes `granted` it hides the banner and calls `registerForPush()` (covers a user who flipped the toggle in Settings). This is additive to the existing resume `registerForPush()` in `_layout.tsx`.
- **Dismissal is session-only** (React state, NOT persisted) so the banner reappears next launch while still denied, exactly as specified. Non-modal; browsing is never blocked.

## Android-14+ full-screen-intent nudge

- Who sees it: computed by `shouldShowFullScreenNudge` = `platformOS === 'android' && platformVersion >= 34 && isOrderStaff && !alreadyDismissed`. So ONLY order staff (`isOrderStaff` from `store/auth.ts`, the accounts that get the caller-card) on Android 14+ (API 34+) who have not dismissed it. Regular customers, older Android, and iOS never see it.
- One-time: the dismissed flag is persisted in AsyncStorage key `4astore_fsi_nudge_dismissed = '1'`. BOTH the "Open settings" and "Later" buttons persist it, so it never nags again.
- Exact intent used: `IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.MANAGE_APP_USE_FULL_SCREEN_INTENT, { data: 'package:com.store4a.app' })`, with a graceful `Linking.openSettings()` fallback if that action is unavailable. No-op on non-Android. Never throws.

## Why forcing is impossible (OS policy) and how the nudge compensates

Android cannot force notification permission: the OS dialog is dismissible, and POST_NOTIFICATIONS (Android 13+) can be requested only until the user denies twice, after which the OS stops showing the dialog and the only path is app settings. USE_FULL_SCREEN_INTENT (Android 14+) is a Settings special-access toggle with no runtime grant read and no request dialog. So the implementation REQUESTS once when undetermined, and otherwise shows a persistent (reappears each launch) dismissible banner deep-linking to app notification settings for the permission, and a one-time staff-targeted deep-link for full-screen intent. It never hard-blocks and never crashes.

## versionCode

`app.config.ts` was NOT edited. `VERSION_CODE = Number(process.env.STORE4A_VERSION_CODE || 36)` — stays **36**. `USE_FULL_SCREEN_INTENT` permission still declared.

## Typecheck / test results

- `npm run typecheck` → exit 0 (0 errors).
- `npm run typecheck:tests` → exit 0 (0 errors).
- `npm test` → `tests 115, pass 115, fail 0` (prior baseline 106 + 9 new `notifPermissionGate` cases).

## No protected feature regressed

- `src/push.ts` — UNCHANGED (single Notifee draw, `orders` channel, `fullScreenAction`, `AndroidCategory.CALL`, `loopSound`, guest `registerForPush`). Not in the diff.
- `app.config.ts` — UNCHANGED (versionCode 36, USE_FULL_SCREEN_INTENT present).
- Guest push on launch, promo full-screen image, qty-limit, analytics, Google login, POS, force-update, short-link all untouched; `app/_layout.tsx` change is additive mounts only.
- WhatsApp API (backend) untouched — this task is mobile-only. No `api-node/`, `web/`, `prisma/`, or `admin-laravel/` changes.

## Reminder

These JS changes do NOT ship automatically. A **new APK/AAB at versionCode 36** must be built (e.g. `npm run build:aab`) to include this nudge in the installed app.
