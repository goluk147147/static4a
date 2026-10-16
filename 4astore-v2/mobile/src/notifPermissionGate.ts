// PURE decision helpers for the notification-permission banner and the Android-14+
// full-screen-intent nudge. ZERO native imports on purpose: this file is unit-tested
// under Node's built-in test runner (see src/__tests__/notifPermissionGate.test.ts),
// which does NOT mock expo-notifications / expo-intent-launcher. Keeping the pure logic
// here (and re-exported from notifPermission.ts) mirrors the pushGate.ts split.

export type NotifStatus = 'granted' | 'denied' | 'undetermined';

/**
 * Show the launch notification-permission banner only when permission is currently
 * DENIED and the user has not dismissed it this session. 'undetermined' goes through the
 * OS dialog instead of the banner; 'granted' never shows a banner.
 */
export function shouldShowPermissionBanner(opts: {
  status: NotifStatus;
  dismissedThisSession: boolean;
}): boolean {
  return opts.status === 'denied' && !opts.dismissedThisSession;
}

/**
 * Show the full-screen-intent enable nudge only on Android 14+ (API level >= 34), only to
 * order staff (who actually receive the caller-card alert), and only once (persisted
 * dismissal). Regular customers, older Android, and iOS never see it.
 */
export function shouldShowFullScreenNudge(opts: {
  platformOS: string;
  platformVersion: number;
  isOrderStaff: boolean;
  alreadyDismissed: boolean;
}): boolean {
  return (
    opts.platformOS === 'android' &&
    opts.platformVersion >= 34 &&
    opts.isOrderStaff &&
    !opts.alreadyDismissed
  );
}
