// No-throw wrappers around the notification permission status + the Settings deep-links
// used by the launch permission banner (NotifPermissionGate) and the Android-14+
// full-screen-intent nudge (FullScreenIntentNudge).
//
// Policy reality baked in here (we cannot bypass it):
//   • Android cannot FORCE notification permission — the OS dialog is dismissible and
//     POST_NOTIFICATIONS (Android 13+) is only requestable until the user denies it twice,
//     after which the OS stops showing the dialog and the only path is app settings.
//   • USE_FULL_SCREEN_INTENT (Android 14+) is a Settings special-access toggle with no
//     runtime grant read and no request dialog — deep-link only.
// So these helpers REQUEST once and otherwise deep-link; they never hard-block and never throw.
//
// expo-notifications stays the single permission authority (same source as getPushPermission
// in push.ts). Notifee is NOT touched here — this file has no coupling to the single-draw path.
import * as Notifications from 'expo-notifications';
import * as IntentLauncher from 'expo-intent-launcher';
import { Linking, Platform } from 'react-native';
import type { NotifStatus } from './notifPermissionGate';

// Re-export the pure decision helpers so callers import everything from one place while the
// unit tests import them from the native-free ./notifPermissionGate module.
export { shouldShowPermissionBanner, shouldShowFullScreenNudge } from './notifPermissionGate';
export type { NotifStatus } from './notifPermissionGate';

// Matches android.package / ios.bundleIdentifier in app.config.ts. Hardcoded on purpose —
// there is no need to read it from native at runtime for a settings deep-link.
const APP_PACKAGE = 'com.store4a.app';

/** Normalize the expo permission status to our three-value union. */
function normalize(status: Notifications.PermissionStatus | undefined): NotifStatus {
  if (status === 'granted') return 'granted';
  if (status === 'undetermined') return 'undetermined';
  return 'denied';
}

/** Current notification permission. Never throws — returns 'undetermined' on any error. */
export async function getNotifStatus(): Promise<NotifStatus> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return normalize(status);
  } catch (e) {
    console.warn('[notifPermission] getNotifStatus failed (non-fatal)', e);
    return 'undetermined';
  }
}

/** Show the OS permission dialog (only effective while status is 'undetermined'). Never throws. */
export async function requestNotif(): Promise<NotifStatus> {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    return normalize(status);
  } catch (e) {
    console.warn('[notifPermission] requestNotif failed (non-fatal)', e);
    return 'denied';
  }
}

/**
 * Deep-link to this app's notification settings so a user who denied can turn it back on.
 * Android: APP_NOTIFICATION_SETTINGS with the package extra; falls back to Linking.openSettings().
 * Non-Android: Linking.openSettings(). Never throws.
 */
export async function openNotifSettings(): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      try {
        await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.APP_NOTIFICATION_SETTINGS, {
          extra: { 'android.provider.extra.APP_PACKAGE': APP_PACKAGE },
        });
        return;
      } catch (e) {
        console.warn('[notifPermission] APP_NOTIFICATION_SETTINGS failed, falling back', e);
        await Linking.openSettings();
        return;
      }
    }
    await Linking.openSettings();
  } catch (e) {
    console.warn('[notifPermission] openNotifSettings failed (non-fatal)', e);
  }
}

/**
 * Deep-link (Android 14+) to the "Allow full-screen intents" special-access screen so staff
 * can enable the caller-card alarm. Android: MANAGE_APP_USE_FULL_SCREEN_INTENT with the
 * package data URI; falls back to Linking.openSettings(). Non-Android: no-op. Never throws.
 */
export async function openFullScreenIntentSettings(): Promise<void> {
  try {
    if (Platform.OS !== 'android') return;
    try {
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.MANAGE_APP_USE_FULL_SCREEN_INTENT, {
        data: 'package:' + APP_PACKAGE,
      });
    } catch (e) {
      console.warn('[notifPermission] MANAGE_APP_USE_FULL_SCREEN_INTENT failed, falling back', e);
      await Linking.openSettings();
    }
  } catch (e) {
    console.warn('[notifPermission] openFullScreenIntentSettings failed (non-fatal)', e);
  }
}
