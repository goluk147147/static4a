import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, Vibration } from 'react-native';
import { api, getAccessToken } from './api';
import { HAS_PUSH } from './config';

const TOKEN_KEY = '4astore_push_token';

// Show notifications even while the app is open (staff must never miss a new order).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/** Channels referenced by the API (`android.notification.channelId`). */
export async function ensureChannels() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Order updates & offers',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 150, 250],
    lightColor: '#FF7A00',
  });
  await Notifications.setNotificationChannelAsync('orders', {
    name: 'New orders (staff)',
    description: 'Naya order aane par turant alert (admin / staff)',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 500, 250, 500, 250, 500],
    lightColor: '#FF7A00',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: false,
  });
}

export async function getPushPermission(): Promise<Notifications.PermissionStatus> {
  return (await Notifications.getPermissionsAsync()).status;
}

/**
 * Ask permission, get the FCM device token and register it with the API. The server subscribes
 * the token to role topics (customers / riders / admins) and uses it for direct staff alerts.
 */
export async function registerForPush(): Promise<string | null> {
  if (!HAS_PUSH || !Device.isDevice || !getAccessToken()) return null;
  await ensureChannels();
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return null;

  try {
    const token = (await Notifications.getDevicePushTokenAsync()).data as string;
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
  const sub = Notifications.addPushTokenListener(() => {
    void registerForPush();
  });
  return () => sub.remove();
}

export type PushData = { type?: string; orderId?: string; link?: string; customerName?: string; total?: string; city?: string };

/** Tap on a notification (warm or cold start) → deep link. */
export function listenNotificationTaps(onLink: (link: string, data: PushData) => void) {
  const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
    const data = (resp.notification.request.content.data || {}) as PushData;
    if (data.link) onLink(data.link, data);
  });
  Notifications.getLastNotificationResponseAsync().then((resp) => {
    if (!resp) return;
    const data = (resp.notification.request.content.data || {}) as PushData;
    if (data.link) onLink(data.link, data);
    Notifications.clearLastNotificationResponseAsync?.().catch(() => null);
  });
  return () => sub.remove();
}

/** Notification received while the app is in the foreground. */
export function listenForeground(onData: (data: PushData, title: string, body: string) => void) {
  const sub = Notifications.addNotificationReceivedListener((n) => {
    const c = n.request.content;
    const data = (c.data || {}) as PushData;
    if (data.type === 'new_order' || data.type === 'order_reminder') Vibration.vibrate([0, 400, 200, 400]);
    onData(data, c.title || '', c.body || '');
  });
  return () => sub.remove();
}

/** Local alert (used by the in-app order poller when a new order shows up). */
export async function localOrderAlert(title: string, body: string, orderId: string) {
  await ensureChannels();
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: 'default',
      data: { type: 'new_order_local', orderId, link: `/admin/orders?view=${orderId}` },
      ...(Platform.OS === 'android' ? { priority: Notifications.AndroidNotificationPriority.MAX } : {}),
    },
    trigger: Platform.OS === 'android' ? { channelId: 'orders' } : null,
  });
}
