// Native entry point. Registers the FCM background/killed-state message handler and the
// Notifee background event handler at module top level — BEFORE React/expo-router boots —
// because setBackgroundMessageHandler MUST be registered synchronously on JS load for
// Android to deliver data-only messages while the app is backgrounded or killed.
//
// Duplicate-display prevention (plan.md D3): the server sends DATA-ONLY messages, so FCM
// never auto-draws a tray notification. We draw EXACTLY ONCE here via displayPush() for the
// background/killed case (the foreground case is drawn by messaging().onMessage in src/push.ts).
import messaging from '@react-native-firebase/messaging';
import notifee, { EventType } from '@notifee/react-native';
import { ensureChannels, displayPush } from './src/push';

messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  await ensureChannels();
  await displayPush(remoteMessage.data || {});
});

// Background taps: the deep link is handled on the next app open via
// notifee.getInitialNotification() (see listenNotificationTaps in src/push.ts), so there is
// nothing to route synchronously here.
notifee.onBackgroundEvent(async (event) => {
  if (event.type === EventType.PRESS) {
    // no-op: cold/warm-start routing is flushed from getInitialNotification on app open.
  }
});

// Boot expo-router exactly as the default entry would.
require('expo-router/entry');
