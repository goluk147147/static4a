import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { prisma } from '../db';

// Lazy-load firebase-admin so the app runs without it in dev.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let admin: any = null;
let initialized = false;
let enabled = false;

function initFirebase() {
  if (initialized) return;
  initialized = true;
  const saPath = config.fcmServiceAccount;
  if (!saPath) {
    // eslint-disable-next-line no-console
    console.log('[push] FCM_SERVICE_ACCOUNT not set — push disabled (dev mode).');
    return;
  }
  const resolved = path.isAbsolute(saPath) ? saPath : path.join(process.cwd(), saPath);
  if (!fs.existsSync(resolved)) {
    // eslint-disable-next-line no-console
    console.log(`[push] service account file not found at ${resolved} — push disabled.`);
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    admin = require('firebase-admin');
    const serviceAccount = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    enabled = true;
    // eslint-disable-next-line no-console
    console.log('[push] FCM initialized.');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[push] failed to init FCM:', (e as Error).message);
  }
}

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, string>; // e.g. { type: 'new_order', orderId: '4A...', link: '/track/4A...' }
  /** Android notification channel created by the native app ('orders' = loud new-order alert). */
  channelId?: 'default' | 'orders';
}

function androidConfig(msg: PushMessage) {
  return {
    priority: 'high',
    notification: {
      channelId: msg.channelId || 'default',
      sound: 'default',
      defaultVibrateTimings: true,
    },
  };
}

/** Send to an FCM topic (e.g. 'admins', 'customers', 'riders', 'order_4A...'). */
export async function sendToTopic(topic: string, msg: PushMessage): Promise<boolean> {
  initFirebase();
  if (!enabled) {
    // eslint-disable-next-line no-console
    console.log(`[push:dev] topic=${topic} title="${msg.title}" body="${msg.body}"`);
    return false;
  }
  await admin.messaging().send({
    topic,
    notification: { title: msg.title, body: msg.body },
    data: msg.data || {},
    android: androidConfig(msg),
  });
  return true;
}

/** All FCM topics we manage server-side (a device is moved between them when its role changes). */
export const MANAGED_TOPICS = ['all', 'customers', 'riders', 'admins'];

/**
 * Subscribe a native device token to exactly `topics` (and unsubscribe it from the other
 * managed topics). Web push tokens are skipped: topic subscription is Android/iOS only here.
 */
export async function syncTokenTopics(token: string, topics: string[]): Promise<void> {
  initFirebase();
  if (!enabled) {
    // eslint-disable-next-line no-console
    console.log(`[push:dev] token topics -> ${topics.join(',')}`);
    return;
  }
  const messaging = admin.messaging();
  const remove = MANAGED_TOPICS.filter((t) => !topics.includes(t));
  await Promise.all([
    ...topics.map((t) => messaging.subscribeToTopic([token], t).catch(() => null)),
    ...remove.map((t) => messaging.unsubscribeFromTopic([token], t).catch(() => null)),
  ]);
}

/** Remove a token from every managed topic (logout / unregister). */
export async function clearTokenTopics(token: string): Promise<void> {
  initFirebase();
  if (!enabled) return;
  const messaging = admin.messaging();
  await Promise.all(MANAGED_TOPICS.map((t) => messaging.unsubscribeFromTopic([token], t).catch(() => null)));
}

/** Device tokens registered by a given user (customer status pushes). */
export async function tokensForUser(userId: bigint | number | null | undefined): Promise<string[]> {
  if (userId === null || userId === undefined) return [];
  const rows = await prisma.deviceToken.findMany({ where: { user_id: BigInt(userId) }, select: { token: true } });
  return rows.map((r: { token: string }) => r.token);
}

/** Send to explicit device tokens (multicast, chunked by 500). */
export async function sendToTokens(tokens: string[], msg: PushMessage): Promise<number> {
  initFirebase();
  const unique = [...new Set(tokens.filter(Boolean))];
  if (unique.length === 0) return 0;
  if (!enabled) {
    // eslint-disable-next-line no-console
    console.log(`[push:dev] ${unique.length} token(s) title="${msg.title}" body="${msg.body}"`);
    return 0;
  }
  let sent = 0;
  for (let i = 0; i < unique.length; i += 500) {
    const batch = unique.slice(i, i + 500);
    const resp = await admin.messaging().sendEachForMulticast({
      tokens: batch,
      notification: { title: msg.title, body: msg.body },
      data: msg.data || {},
      android: androidConfig(msg),
    });
    sent += resp.successCount;
    // Drop tokens FCM says are gone (app uninstalled / token rotated).
    const dead: string[] = [];
    resp.responses.forEach((r: { success: boolean; error?: { code?: string } }, idx: number) => {
      const code = r.error?.code || '';
      if (!r.success && (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token'))) {
        dead.push(batch[idx]);
      }
    });
    if (dead.length) await prisma.deviceToken.deleteMany({ where: { token: { in: dead } } }).catch(() => null);
  }
  return sent;
}

/** All device tokens belonging to users who are owner/superadmin or admins with the given permission. */
export async function tokensForStaff(permission = 'orders'): Promise<string[]> {
  const staff = await prisma.$queryRawUnsafe<Array<{ token: string }>>(
    `SELECT dt.token
       FROM device_tokens dt
       JOIN users u ON u.id = dt.user_id
      WHERE u.role IN ('owner','superadmin')
         OR (u.role = 'admin' AND (
               JSON_CONTAINS(u.permissions, '"*"') = 1
            OR JSON_CONTAINS(u.permissions, ?) = 1))`,
    JSON.stringify(permission)
  );
  return staff.map((r) => r.token);
}

/** Notify all admin/staff that a new order arrived (topic + direct tokens). */
/** Staff deep link: opens the order detail (native app: admin/order/[id], web: /admin/orders?view=). */
export const staffOrderLink = (orderId: string) => `/admin/orders?view=${encodeURIComponent(orderId)}`;

/**
 * Notify all admin/staff that a new order arrived. Delivered as ONE push per device:
 * direct tokens of every owner/superadmin/admin-with-`orders` (so staff added later get it as
 * soon as their app registers), falling back to the `admins` topic only when no tokens exist.
 */
export async function notifyStaffNewOrder(order: {
  order_id: string;
  customer: unknown;
  items: unknown;
  total_amount: unknown;
}): Promise<void> {
  const customer = (order.customer || {}) as { name?: string; mobile?: string; city?: string; address?: string };
  const items = Array.isArray(order.items) ? (order.items as Array<{ quantity?: number }>) : [];
  const qty = items.reduce((n, i) => n + (Number(i.quantity) || 0), 0);
  const area = [customer.address, customer.city].filter(Boolean).join(', ');

  // Admin can mute the loud staff alert from the web admin (settings.staff_order_alerts_enabled).
  // When OFF we send on the quiet 'default' channel instead of the loud 'orders' channel, so the
  // order still arrives but without the max-importance beep/vibration. Default ON if the column
  // doesn't exist yet (before charges-settings.sql).
  let loud = true;
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ staff_order_alerts_enabled?: number | null }>>(
      'SELECT staff_order_alerts_enabled FROM settings WHERE id = 1'
    );
    const v = rows[0]?.staff_order_alerts_enabled;
    loud = v == null ? true : !!v;
  } catch {
    loud = true;
  }

  const msg: PushMessage = {
    title: `🛒 New order #${order.order_id} – ₹${order.total_amount}`,
    body: `${customer.name || 'Customer'} (${customer.mobile || ''}) • ${qty} item(s) • 📍 ${area || 'Address in app'}`,
    data: {
      type: 'new_order',
      orderId: order.order_id,
      customerName: String(customer.name || ''),
      city: String(customer.city || ''),
      total: String(order.total_amount ?? ''),
      link: staffOrderLink(order.order_id),
    },
    channelId: loud ? 'orders' : 'default',
  };
  const tokens = await tokensForStaff('orders').catch(() => [] as string[]);
  if (tokens.length) await sendToTokens(tokens, msg).catch(() => null);
  else await sendToTopic('admins', msg).catch(() => null);

  // Riders: a new order is available to accept (no customer details in the notification).
  await sendToTopic('riders', {
    title: '🛵 New delivery available',
    body: `Order #${order.order_id} • ${customer.city || ''}`.trim(),
    data: { type: 'rider_new_order', orderId: order.order_id, link: '/rider' },
  }).catch(() => null);
}

/** Notify the customer about their order status change (their own devices + order topic). */
export async function notifyCustomerStatus(order: {
  order_id: string;
  customer: unknown;
  order_status: string;
  user_id?: bigint | number | null;
}): Promise<void> {
  const msg: PushMessage = {
    title: `📦 Order #${order.order_id}`,
    body: `Status: ${order.order_status}`,
    data: { type: 'order_status', orderId: order.order_id, link: `/track/${order.order_id}` },
  };
  const tokens = await tokensForUser(order.user_id).catch(() => [] as string[]);
  if (tokens.length) await sendToTokens(tokens, msg).catch(() => null);
  else await sendToTopic(`order_${order.order_id}`, msg).catch(() => null);
}
