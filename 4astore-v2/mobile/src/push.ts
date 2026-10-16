// ─────────────────────────────────────────────────────────────────────────────
// DUPLICATE-DISPLAY PREVENTION (plan.md D3)
//
// Every push is drawn EXACTLY ONCE, by Notifee, on every app state:
//   • The server (api-node push.ts, FEAT-002) sends DATA-ONLY FCM messages — there
//     is no `notification` block — so Android/FCM never auto-draws anything in the
//     tray. Nothing is shown unless our JS draws it.
//   • Foreground: messaging().onMessage → displayPush() (this file). One draw.
//   • Background / killed: messaging().setBackgroundMessageHandler → displayPush(),
//     registered at the native entry (mobile/index.js) BEFORE React renders. One draw.
//   • The old expo-notifications display path (Notifications.setNotificationHandler +
//     addNotificationReceivedListener) has been REMOVED — it would have drawn a
//     SECOND copy for the same message. expo-notifications is now used ONLY for the
//     Android POST_NOTIFICATIONS permission prompt/status (getPushPermission).
//
// Net: data-only server + single Notifee presenter per lifecycle = one notification.
// ─────────────────────────────────────────────────────────────────────────────
import notifee, { AndroidCategory, AndroidImportance, AndroidStyle, AndroidVisibility, EventType } from '@notifee/react-native';
import type { AndroidBigPictureStyle, AndroidBigTextStyle } from '@notifee/react-native';
import messaging from '@react-native-firebase/messaging';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, Vibration } from 'react-native';
import { api } from './api';
import { HAS_PUSH } from './config';
import { shouldRegisterPush } from './pushGate';
import { isPromoImagePush, normalizePush } from './pushPayload';
import type { PushData } from './pushPayload';

const TOKEN_KEY = '4astore_push_token';

// Colour 4A logo for the notification large icon (right-side rounded icon, Rapido/Flipkart style).
// IMPORTANT: in a RELEASE build a Metro `require('...png')` ref does NOT resolve to a path Notifee
// can load, so the large icon silently disappeared (worked in debug via Metro). Instead we point at
// the NATIVE Android drawable `@drawable/notification_large_icon` (already bundled by the
// withNotificationLargeIcon plugin + registered in AndroidManifest). A resource name string works in
// both debug and release. The server's absolute `data.largeIcon` URL is preferred when present.
const LARGE_ICON_RESOURCE = 'notification_large_icon';

// Exact Android small (status-bar) icon drawable name. This is the monochrome silhouette the
// expo-notifications config plugin copies in as `@drawable/notification_icon` (see
// node_modules/expo-notifications withNotificationsAndroid NOTIFICATION_ICON = 'notification_icon').
const SMALL_ICON = 'notification_icon';
const BRAND_COLOR = '#FF7A00';

/** Channels referenced by the API (`channelId` in the data payload). Mirrors the previous
 *  expo-notifications importance / vibration / light config, now created via Notifee. */
export async function ensureChannels() {
  if (Platform.OS !== 'android') return;
  try {
  await notifee.createChannel({
    id: 'default',
    name: 'Order updates & offers',
    importance: AndroidImportance.HIGH,
    sound: 'default',
    vibration: true,
    // Notifee requires an EVEN count of strictly POSITIVE ms values (unlike expo-notifications,
    // which tolerated a leading 0). A leading 0 here threw "expected an array containing an even
    // number of positive values", which crashed ensureChannels() and silently aborted BOTH token
    // registration and every displayPush — the real reason pushes stopped after the Notifee switch.
    vibrationPattern: [250, 150, 250, 150],
    lights: true,
    lightColor: BRAND_COLOR,
  });
  await notifee.createChannel({
    id: 'orders',
    name: 'New orders (staff)',
    description: 'Naya order aane par turant alert (admin / staff)',
    importance: AndroidImportance.HIGH,
    sound: 'default',
    vibration: true,
    // Longer/harder alarm vibration. MUST stay an EVEN count of strictly POSITIVE ms values —
    // a leading 0 or odd count throws and crashes ensureChannels(), silently killing ALL push.
    vibrationPattern: [800, 400, 800, 400, 800, 400],
    // A new order is time-critical for staff — let it ring through Do-Not-Disturb when supported.
    bypassDnd: true,
    lights: true,
    lightColor: BRAND_COLOR,
    visibility: AndroidVisibility.PUBLIC,
  });
  } catch (e) {
    // Channel creation must NEVER abort token registration or a notification draw. If a channel
    // config is ever rejected, log and continue — Android falls back to a default channel.
    console.warn('[push] ensureChannels failed (non-fatal)', e);
  }
}

export type { PushData };

/**
 * The single Notifee presenter. Draws one rich notification: colour large icon on the right
 * (always), monochrome small icon tinted brand orange, and a BIGPICTURE banner only when the
 * server supplied an `image`. Used by foreground, background/killed, and local-order paths.
 */
export async function displayPush(input: PushData) {
  const data = normalizePush(input as Record<string, unknown>);
  if (!data.title && !data.body) return;
  try {
    await drawRich(data);
  } catch (e) {
    // A bad largeIcon/image URL or a missing resource must never swallow the push:
    // fall back to a plain notification with only the bundled small icon.
    console.warn('[push] rich display failed, falling back to plain', e);
    const body = data.body || '';
    await notifee.displayNotification({
      id: notifId(data),
      title: data.title || '4A Store',
      body,
      data: data as Record<string, string>,
      android: {
        channelId: data.channelId || 'default',
        smallIcon: SMALL_ICON,
        color: BRAND_COLOR,
        largeIcon: LARGE_ICON_RESOURCE, // native drawable — safe in release even if the URL failed
        pressAction: { id: 'default' },
        ...(body.length > 40 ? { style: { type: AndroidStyle.BIGTEXT, text: body } } : {}),
        // A rich-draw failure still gets the full-screen alarm for new orders.
        ...(isOrderPush(data) ? ORDER_ANDROID : {}),
      },
    });
  }
}

// Notifee rejects an `id` that is undefined/empty — it must be a unique non-empty string, or the
// key must be absent. A broadcast/test push has no orderId, so `data.orderId || undefined` threw
// "invalid notification ID". Use the orderId when present (so order updates REPLACE in the tray),
// else a unique id so each broadcast shows as its own notification.
function notifId(data: PushData): string {
  const oid = (data.orderId || '').trim();
  return oid || `4a_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

// A new-order push for staff must be MAXIMALLY aggressive: full-screen incoming-call style card
// (over the lock screen), high importance, looping alarm sound. These extra android fields apply
// ONLY to order alerts — customer/promo/default draws are left untouched. All fields verified
// against @notifee/react-native v9.1.8 type defs.
function isOrderPush(data: PushData): boolean {
  return (
    data.type === 'new_order' ||
    data.type === 'new_order_local' ||
    data.type === 'order_reminder' ||
    data.channelId === 'orders'
  );
}

const ORDER_ANDROID = {
  category: AndroidCategory.CALL,
  importance: AndroidImportance.HIGH,
  fullScreenAction: { id: 'default', launchActivity: 'default' },
  loopSound: true,
  visibility: AndroidVisibility.PUBLIC,
} as const;

async function drawRich(data: PushData) {
  const body = data.body || '';
  // Prefer the server's absolute logo URL; else the native drawable resource (release-safe).
  const largeIcon = (data.largeIcon && /^https?:\/\//.test(data.largeIcon)) ? data.largeIcon : LARGE_ICON_RESOURCE;

  // Style: a server image → BIGPICTURE (expandable banner). Otherwise, for anything beyond a short
  // line, BIGTEXT so long bodies EXPAND instead of being truncated/cut off in the tray.
  const style: AndroidBigPictureStyle | AndroidBigTextStyle | undefined = data.image
    ? { type: AndroidStyle.BIGPICTURE, picture: data.image }
    : body.length > 40
      ? { type: AndroidStyle.BIGTEXT, text: body }
      : undefined;

  await notifee.displayNotification({
    id: notifId(data),
    title: data.title || '',
    body,
    data,
    android: {
      channelId: data.channelId || 'default',
      smallIcon: SMALL_ICON,
      color: BRAND_COLOR,
      largeIcon,
      pressAction: { id: 'default' },
      ...(style ? { style } : {}),
      ...(isOrderPush(data) ? ORDER_ANDROID : {}),
    },
  });
}

export async function getPushPermission(): Promise<Notifications.PermissionStatus> {
  return (await Notifications.getPermissionsAsync()).status;
}

/**
 * Ask permission, get the FCM token and register it with the API. Works for a GUEST
 * (no login) as well as a logged-in user — the `/push/register` call is header-less for a
 * guest (api.ts only adds Authorization when a token exists), and the server stores the
 * token with user_id null + the broadcast topics. The server subscribes the token to role
 * topics (customers / riders / admins) and uses it for direct staff alerts. A later login
 * re-runs this and re-associates the same token to the user_id.
 */
export async function registerForPush(): Promise<string | null> {
  // No login required: a guest device registers too (server stores user_id null) so it
  // still gets broadcast/promo pushes. Only gate on push-enabled build + real device.
  if (!shouldRegisterPush({ hasPush: HAS_PUSH, isDevice: Device.isDevice })) return null;
  await ensureChannels();
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return null;

  try {
    const token = await messaging().getToken();
    await api.post('/push/register', { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
    await AsyncStorage.setItem(TOKEN_KEY, token);
    return token;
  } catch (e) {
    console.warn('[push] register failed', e);
    return null;
  }
}

export async function unregisterPush() {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (!token) return;
  await api.post('/push/unregister', { token }).catch(() => null);
  await AsyncStorage.removeItem(TOKEN_KEY);
}

/** FCM rotates tokens occasionally — re-register whenever that happens. */
export function listenTokenRotation() {
  return messaging().onTokenRefresh(() => {
    void registerForPush();
  });
}

/** Notification received while the app is in the foreground → draw it once via Notifee. */
export function listenForeground(onData: (data: PushData, title: string, body: string) => void) {
  return messaging().onMessage(async (remoteMessage) => {
    const data = normalizePush(remoteMessage.data, remoteMessage.notification);
    if (!data.title && !data.body) return; // nothing displayable
    await ensureChannels();
    await displayPush(data);
    // Longer/harder foreground buzz for a new order. Even-count, all-positive ms to match the
    // project's Notifee vibration rule (avoids any accidental copy of a leading-0 pattern).
    if (data.type === 'new_order' || data.type === 'order_reminder') Vibration.vibrate([800, 400, 800, 400, 800, 400]);
    onData(data, data.title || '', data.body || '');
  });
}

/** Tap on a notification (foreground, warm or cold start) → deep link via Notifee events. */
export function listenNotificationTaps(onLink: (link: string, data: PushData) => void) {
  const unsub = notifee.onForegroundEvent((event) => {
    if (event.type === EventType.PRESS) {
      const data = (event.detail.notification?.data || {}) as PushData;
      // Deliver the tap when there is a deep link OR a promo image to open full-screen.
      if (data.link || isPromoImagePush(data)) onLink(data.link || '', data);
    }
  });
  // Cold start: the app was launched by tapping a notification.
  notifee.getInitialNotification().then((initial) => {
    if (!initial) return;
    const data = (initial.notification?.data || {}) as PushData;
    if (data.link || isPromoImagePush(data)) onLink(data.link || '', data);
  });
  return unsub;
}

/** Local alert (used by the in-app order poller when a new order shows up). Single Notifee source. */
export async function localOrderAlert(title: string, body: string, orderId: string) {
  await ensureChannels();
  await displayPush({
    type: 'new_order_local',
    orderId,
    title,
    body,
    channelId: 'orders',
    link: `/admin/orders?view=${orderId}`,
  });
}
