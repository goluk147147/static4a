import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { prisma } from '../db';
import { SITE_ORIGIN } from '../seo/origin';

/**
 * Resolve a stored image path to an absolute https URL FCM can fetch for the
 * big-picture notification. Mirrors routes/og.ts absoluteImageUrl(): an already
 * absolute http(s) URL is returned unchanged, otherwise it is joined onto the
 * public site origin.
 */
function absolutePublicUrl(src: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  return `${SITE_ORIGIN}/${src.replace(/^\.?\//, '')}`;
}

/**
 * Colour 4A logo carried as a largeIcon hint on every push.
 *
 * Android limitation (honest note): FCM's server payload has no field for a REMOTE
 * large icon on OS-drawn (background) notifications — `AndroidNotification` only
 * exposes `icon` (the monochrome small/status-bar icon, always tinted — set in the
 * app's app.config.ts), `color`, and `imageUrl` (the big-picture banner). So the
 * colour logo is carried in the `data.largeIcon` payload for the mobile FOREGROUND
 * handler (and any future native extender) to render as the right-side large icon.
 * The big-picture `imageUrl` is used ONLY when the admin explicitly provides an image —
 * text-only broadcasts stay clean (title + body, no banner), like Flipkart.
 * Served in production from web/public: https://4astore.com/notification-logo.png.
 * Override with NOTIFICATION_LOGO_URL.
 */
export const NOTIFICATION_LOGO_URL = (process.env.NOTIFICATION_LOGO_URL || `${SITE_ORIGIN}/notification-logo.png`).replace(/\/+$/, '');

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
  /** Optional big-picture image (relative path or absolute URL). Omitted keeps text-only payload byte-identical. */
  image?: string;
}

/**
 * Merge the colour-logo `largeIcon` hint into the data payload so the mobile foreground
 * handler can render the right-side app logo. The OS-drawn (background) tray icon stays
 * the monochrome small icon + tint from app.config.ts — Android gives no server lever for
 * a remote large icon, so this hint is the only cross-send way to surface the colour logo.
 */
function withLargeIcon(data: Record<string, string> | undefined): Record<string, string> {
  return { largeIcon: NOTIFICATION_LOGO_URL, ...(data || {}) };
}

function androidConfig(msg: PushMessage) {
  const notification: Record<string, unknown> = {
    channelId: msg.channelId || 'default',
    sound: 'default',
    defaultVibrateTimings: true,
  };
  // Big-picture image only when provided — text-only pushes stay byte-identical.
  if (msg.image) notification.imageUrl = absolutePublicUrl(msg.image);
  return {
    priority: 'high',
    notification,
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
    notification: {
      title: msg.title,
      body: msg.body,
      // Big-picture image only when provided — text-only payload stays byte-identical.
      ...(msg.image ? { image: absolutePublicUrl(msg.image) } : {}),
    },
    // Carry the colour logo as a largeIcon hint for the foreground handler.
    data: withLargeIcon(msg.data),
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
      notification: {
        title: msg.title,
        body: msg.body,
        // Big-picture image only when provided — text-only payload stays byte-identical.
        ...(msg.image ? { image: absolutePublicUrl(msg.image) } : {}),
      },
      // Carry the colour logo as a largeIcon hint for the foreground handler.
      data: withLargeIcon(msg.data),
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

/**
 * Device tokens subscribed (in the DB) to a given broadcast topic ('all' | 'customers' | 'riders').
 * Lets a broadcast go out as an explicit multicast so we get a real per-device success count and
 * dead-token pruning, instead of a topic send that returns only a boolean.
 */
export async function tokensForTopic(topic: string): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ token: string }>>(
    `SELECT token FROM device_tokens WHERE JSON_CONTAINS(topics, ?) = 1`,
    JSON.stringify(topic)
  );
  return rows.map((r) => r.token);
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

/** Metadata persisted for a push on the notifications history table. */
export interface NotificationMeta {
  type: string;
  title: string;
  body: string;
  image?: string | null;
  link?: string | null;
  target: string;
  product_id?: bigint | number | null;
  order_id?: string | null;
  sent_by?: string | null;
}

/**
 * Best-effort history write for a push: one `notifications` row plus one
 * `notification_recipients` row per token (user_id resolved from device_tokens
 * in a single query where possible). NEVER throws — a logging failure must not
 * block the push, so every caller wraps this in .catch() too.
 */
export async function recordNotification(
  meta: NotificationMeta,
  tokens: string[],
  successCount: number,
  failureCount: number
): Promise<void> {
  try {
    const unique = [...new Set((tokens || []).filter(Boolean))];
    await prisma.$executeRawUnsafe(
      `INSERT INTO notifications
         (type, title, body, image, link, target, product_id, order_id, sent_by, success_count, failure_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      meta.type,
      meta.title,
      meta.body,
      meta.image ?? null,
      meta.link ?? null,
      meta.target,
      meta.product_id != null ? BigInt(meta.product_id).toString() : null,
      meta.order_id ?? null,
      meta.sent_by ?? null,
      Number(successCount) || 0,
      Number(failureCount) || 0
    );
    // MariaDB 10.4 has no INSERT...RETURNING; LAST_INSERT_ID() is per-connection safe.
    const idRows = await prisma.$queryRawUnsafe<Array<{ id: bigint | number }>>('SELECT LAST_INSERT_ID() AS id');
    const notifId = idRows?.[0]?.id;
    if (notifId == null || Number(notifId) === 0 || unique.length === 0) return;

    // Resolve token -> user_id in one query so recipients carry the owner FK.
    const rows = await prisma.deviceToken.findMany({
      where: { token: { in: unique } },
      select: { token: true, user_id: true },
    });
    const tokenToUser = new Map(rows.map((r) => [r.token, r.user_id]));

    // Best-effort delivery status: when FCM reported no failures mark all 'sent',
    // otherwise fall back to 'failed' (per-token success is not tracked here).
    const status = failureCount > 0 && successCount === 0 ? 'failed' : 'sent';
    const values: string[] = [];
    const params: Array<string | null> = [];
    for (const token of unique) {
      const uid = tokenToUser.get(token);
      values.push('(?, ?, ?, ?)');
      params.push(
        BigInt(notifId).toString(),
        uid != null ? BigInt(uid).toString() : null,
        token.slice(0, 255),
        status
      );
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO notification_recipients (notification_id, user_id, token, status) VALUES ${values.join(', ')}`,
      ...params
    );
  } catch {
    // Swallow — history logging must never block or fail a push.
  }
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
  let staffSent = 0;
  if (tokens.length) staffSent = await sendToTokens(tokens, msg).catch(() => 0);
  else await sendToTopic('admins', msg).catch(() => null);
  await recordNotification(
    {
      type: 'new_order',
      title: msg.title,
      body: msg.body,
      target: 'admins',
      order_id: order.order_id,
    },
    tokens,
    staffSent,
    tokens.length ? tokens.length - staffSent : 0
  ).catch(() => null);

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
  let sent = 0;
  if (tokens.length) sent = await sendToTokens(tokens, msg).catch(() => 0);
  else await sendToTopic(`order_${order.order_id}`, msg).catch(() => null);
  await recordNotification(
    {
      type: 'order_status',
      title: msg.title,
      body: msg.body,
      target: 'customer',
      order_id: order.order_id,
    },
    tokens,
    sent,
    tokens.length ? tokens.length - sent : 0
  ).catch(() => null);
}
