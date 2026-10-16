// Pure, dependency-free push-payload normaliser (no native imports) so it is unit-testable in Node
// and reusable by both the foreground and background handlers.

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

type RemoteNotification = {
  title?: string;
  body?: string;
  android?: { channelId?: string; imageUrl?: string };
} | null | undefined;

/**
 * Normalise every FCM payload shape we can receive into the flat Notifee contract:
 *  - NEW server (flat):   { title, body, channelId, link, ... }
 *  - OLD server (expo):   { title, message, channelId, body: '<JSON string with link/type/...>' }
 *  - notification-type:   remoteMessage.notification { title, body } + data { link, ... }
 * Without this, an older API build shows a raw-JSON body or an empty title/body.
 */
export function normalizePush(raw: Record<string, unknown> | undefined, notification?: RemoteNotification): PushData {
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

// Order-type pushes that must NEVER open the customer promo full-screen image (they keep their
// existing deep-link routing to the admin order / tracking screens).
const ORDER_TYPES = new Set(['new_order', 'new_order_local', 'order_reminder', 'order_status']);

/**
 * Pure predicate: is this push a PROMO that carries a full-screen image the customer should see?
 * True iff `data.image` is an absolute https URL AND the push is not an order/rider type.
 * An absent `type` with an https image counts as a promo (broadcast pushes often omit `type`).
 * No native imports — kept here so it is unit-testable in Node.
 */
export function isPromoImagePush(data: PushData | undefined): boolean {
  if (!data || !data.image || !/^https:\/\//.test(data.image)) return false;
  const type = (data.type || '').trim();
  if (ORDER_TYPES.has(type)) return false;
  if (type.startsWith('rider')) return false;
  return true;
}

/**
 * Build the in-app full-screen promo route for a promo-with-image push, else null.
 * Image URL is URL-encoded into the `[image]` path param; `data.link` (if present) is carried as
 * a `link` query param so the promo screen can show a CTA.
 */
export function promoRoute(data: PushData | undefined): string | null {
  if (!data || !isPromoImagePush(data)) return null;
  let route = `/promo/${encodeURIComponent(data.image!)}`;
  if (data.link) route += `?link=${encodeURIComponent(data.link)}`;
  return route;
}
