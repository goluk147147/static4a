// Unit tests for the pure notification-permission / full-screen-intent gate helpers
// (src/notifPermissionGate.ts). These are native-free so they run under node:test with
// zero expo mocks, same style as guestPushGate.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowPermissionBanner, shouldShowFullScreenNudge } from '../notifPermissionGate.ts';

test('permission banner shows when denied and not dismissed this session', () => {
  assert.equal(shouldShowPermissionBanner({ status: 'denied', dismissedThisSession: false }), true);
});

test('permission banner hidden once dismissed this session', () => {
  assert.equal(shouldShowPermissionBanner({ status: 'denied', dismissedThisSession: true }), false);
});

test('permission banner never shows when granted', () => {
  assert.equal(shouldShowPermissionBanner({ status: 'granted', dismissedThisSession: false }), false);
});

test('permission banner never shows when undetermined (OS dialog handles that)', () => {
  assert.equal(shouldShowPermissionBanner({ status: 'undetermined', dismissedThisSession: false }), false);
});

test('full-screen nudge shows on Android 14+ staff who has not dismissed', () => {
  assert.equal(
    shouldShowFullScreenNudge({ platformOS: 'android', platformVersion: 34, isOrderStaff: true, alreadyDismissed: false }),
    true,
  );
});

test('full-screen nudge hidden on Android 13 (below API 34)', () => {
  assert.equal(
    shouldShowFullScreenNudge({ platformOS: 'android', platformVersion: 33, isOrderStaff: true, alreadyDismissed: false }),
    false,
  );
});

test('full-screen nudge hidden for a non-staff customer on Android 14', () => {
  assert.equal(
    shouldShowFullScreenNudge({ platformOS: 'android', platformVersion: 34, isOrderStaff: false, alreadyDismissed: false }),
    false,
  );
});

test('full-screen nudge hidden once already dismissed (one-time)', () => {
  assert.equal(
    shouldShowFullScreenNudge({ platformOS: 'android', platformVersion: 34, isOrderStaff: true, alreadyDismissed: true }),
    false,
  );
});

test('full-screen nudge never shows on iOS', () => {
  assert.equal(
    shouldShowFullScreenNudge({ platformOS: 'ios', platformVersion: 17, isOrderStaff: true, alreadyDismissed: false }),
    false,
  );
});
