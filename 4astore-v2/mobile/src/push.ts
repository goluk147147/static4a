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
import notifee, { AndroidImportance, AndroidStyle, AndroidVisibility, EventType } from '@notifee/react-native';
import messaging from '@react-native-firebase/messaging';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, Vibration } from 'react-native';
import { api, getAccessToken } from './api';
import { HAS_PUSH } from './config';

const TOKEN_KEY = '4astore_push_token';

// Bundled colour 4A logo used as the notification large icon (right-side rounded icon,
// Rapido/Flipkart style). Falls back to data.largeIcon (a URL) when the server supplies one.
const LARGE_ICON = require('../assets/images/notification-large-icon.png');

// Exact Android small (status-bar) icon drawable name. This is the monochrome silhouette the
// expo-notifications config plugin copies in as `@drawable/notification_icon` (see
// node_modules/expo-notifications withNotificationsAndroid NOTIFICATION_ICON = 'notification_icon').
const SMALL_ICON = 'notification_icon';
const BRAND_COLOR = '#FF7A00';

/** Channels referenced by the API (`channelId` in the data payload). Mirrors the previous
 *  expo-notifications importance / vibration / light config, now created via Notifee. */
export async function ensureChannels() {
  if (Platform.OS !== 'android') return;
  await notifee.createChannel({
    id: 'default',
    name: 'Order updates & offers',
    importance: AndroidImportance.HIGH,
    sound: 'default',
    vibration: true,
    vibrationPattern: [0, 250, 150, 250],
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
    vibrationPattern: [0, 500, 250, 500, 250, 500],
    lights: true,
    lightColor: BRAND_COLOR,
    visibility: AndroidVisibility.PUBLIC,
  });
}

export type PushData = {
  type?: string;
  orderId?: string;
  link?: string;
  customerName?: string;
  total?: string;
  city?: string;
  largeIcon?: string;
  // Flat keys emitted by the server (FEAT-002 dataOnlyPayload).
  title?: string;
  body?: string;
  channelId?: string;
  image?: string;
  sound?: string;
};

/**
 * Normalise every FCM payload shape we can receive into the flat Notifee contract:
 *  - NEW server (flat):   { title, body, channelId, link, ... }
 *  - OLD server (expo):   { title, message, channelId, body: '<JSON string with link/type/...>' }
 *  - notification-type:   remoteMessage.notification { title, body } + data { link, ... }
 * Without this, an older API build shows a raw-JSON body or an empty title/body.
 */
export function normalizePush(
  raw: Record<string, unknown> | undefined,
  notification?: { title?: string; body?: string; android?: { channelId?: string; imageUrl?: string } } | null,
): PushData {
  const src: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw || {})) if (v != null) src[k] = String(v);
  let extra: Record<string, string> = {};
  const b = src.body;
  if (b && b.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(b) as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) if (v != null) extra[k] = String(v);
      delete src.body; // JSON blob is data, not display text
    } catch {
      extra = {};
    }
  }
  const out: PushData = { ...extra, ...src };
  out.title = src.title || notification?.title || extra.title || '';
  out.body = src.body || src.message || notification?.body || extra.body || extra.message || '';
  out.channelId = src.channelId || notification?.android?.channelId || extra.channelId || 'default';
  if (!out.image && notification?.android?.imageUrl) out.image = notification.android.imageUrl;
  return out;
}

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
    await notifee.displayNotification({
      id: data.orderId || undefined,
      title: data.title || '4A Store',
      body: data.body || '',
      data: data as Record<string, string>,
      android: { channelId: data.channelId || 'default', smallIcon: SMALL_ICON, color: BRAND_COLOR, pressAction: { id: 'default' } },
    });
  }
}

async function drawRich(data: PushData) {
  await notifee.displayNotification({
    id: data.orderId || undefined,
    title: data.title || '',
    body: data.body || '',
    data,
    android: {
      channelId: data.channelId || 'default',
      smallIcon: SMALL_ICON,
      color: BRAND_COLOR,
      largeIcon: data.largeIcon || LARGE_ICON,
      pressAction: { id: 'default' },
      ...(data.image ? { style: { type: AndroidStyle.BIGPICTURE, picture: data.image } } : {}),
    },
  });
}

export async function getPushPermission(): Promise<Notifications.PermissionStatus> {
  return (await Notifications.getPermissionsAsync()).status;
}

/**
 * Ask permission, get the FCM token and register it with the API. The server subscribes
 * the token to role topics (customers / riders / admins) and uses it for direct staff alerts.
 */
export async function registerForPush(): Promise<string | null> {
  if (!HAS_PUSH || !Device.isDevice || !getAccessToken()) return null;
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
    if (data.type === 'new_order' || data.type === 'order_reminder') Vibration.vibrate([0, 400, 200, 400]);
    onData(data, data.title || '', data.body || '');
  });
}

/** Tap on a notification (foreground, warm or cold start) → deep link via Notifee events. */
export function listenNotificationTaps(onLink: (link: string, data: PushData) => void) {
  const unsub = notifee.onForegroundEvent((event) => {
    if (event.type === EventType.PRESS) {
      const data = (event.detail.notification?.data || {}) as PushData;
      if (data.link) onLink(data.link, data);
    }
  });
  // Cold start: the app was launched by tapping a notification.
  notifee.getInitialNotification().then((initial) => {
    if (!initial) return;
    const data = (initial.notification?.data || {}) as PushData;
    if (data.link) onLink(data.link, data);
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
