/**
 * POS owner push notifications (design §7). A thin typed layer over the existing
 * FCM infra in services/push.ts — it adds NO new transport, channel or native
 * code. Every helper:
 *   - resolves recipients with tokensForStaff('pos') so delivery goes ONLY to
 *     authorised staff (owner/superadmin + admins holding the `pos` permission)
 *     and automatically to ALL of an owner's registered devices (the existing
 *     multi-token multicast in sendToTokens),
 *   - sends on the quiet 'default' channel (POS alerts are informational, not the
 *     latency-critical loud 'orders' alert),
 *   - is wrapped so a push/logging failure can NEVER block or fail the caller
 *     (checkout/reversal/adjustment have already committed before these run),
 *   - records one `notifications` history row via recordNotification with a new
 *     POS `type` so the admin notification history stays consistent.
 *
 * Low-stock dedupe (design §7): posNotify.lowStock / outOfStock fire ONLY on the
 * TRANSITION into the low/out state. The caller passes the previous stock (read
 * inside the checkout tx, before deduction) and the post-deduction balance, and
 * this module fires at most one alert per product per sale — out-of-stock when
 * the balance crossed to <= 0, else low-stock when it crossed to <= threshold.
 * A product already below threshold before the sale does not re-alert.
 */
import { sendToTokens, tokensForStaff, recordNotification, PushMessage } from './push';

/** New POS notification `type` values persisted on the notifications history table. */
export type PosNotificationType =
  | 'pos_sale'
  | 'pos_low_stock'
  | 'pos_out_of_stock'
  | 'pos_cancel'
  | 'pos_stock_adjust';

/** Deep link opening the matching admin screen (web: /admin/..., native: admin/...). */
const BILL_LINK = (billNo: string) => `/admin/pos-history?bill=${encodeURIComponent(billNo)}`;
const INVENTORY_LINK = '/admin/inventory';

/**
 * Send one POS push to all authorised `pos` staff and record it in history.
 * Fully self-contained best-effort: resolves tokens, sends, logs — every step
 * guarded so a failure returns quietly instead of propagating to the caller.
 */
async function notifyPosStaff(type: PosNotificationType, msg: PushMessage, productId?: number | null): Promise<void> {
  try {
    const tokens = await tokensForStaff('pos').catch(() => [] as string[]);
    const sent = tokens.length ? await sendToTokens(tokens, msg).catch(() => 0) : 0;
    await recordNotification(
      {
        type,
        title: msg.title,
        body: msg.body,
        target: 'pos_staff',
        link: msg.data?.link ?? null,
        product_id: productId ?? null,
      },
      tokens,
      sent,
      tokens.length ? tokens.length - sent : 0
    ).catch(() => null);
  } catch {
    // A notification must never break billing/inventory — swallow everything.
  }
}

/** Completed-sale alert. Gated by the caller on settings.pos_sale_notifications. */
export async function sale(bill: {
  bill_no: string | null;
  grand_total: number;
  item_count: number;
  payment_method?: string | null;
}): Promise<void> {
  const billNo = bill.bill_no || 'Bill';
  const method = (bill.payment_method || 'cash').toUpperCase();
  await notifyPosStaff('pos_sale', {
    title: `🧾 4A Store – Sale ₹${bill.grand_total}`,
    body: `${billNo} • ${bill.item_count} item(s) • ${method}`,
    channelId: 'default',
    data: { type: 'pos_sale', billNo: String(billNo), link: BILL_LINK(billNo) },
  });
}

/** Low-stock alert — "<name> has only <qty> <unit> remaining. Please restock soon." */
export async function lowStock(product: { id: number; name: string; stock: number; unit: string }): Promise<void> {
  const qty = formatQty(product.stock);
  await notifyPosStaff(
    'pos_low_stock',
    {
      title: '⚠️ 4A Store – Low Stock Alert',
      body: `${product.name} has only ${qty} ${product.unit} remaining. Please restock soon.`,
      channelId: 'default',
      data: { type: 'pos_low_stock', productId: String(product.id), link: INVENTORY_LINK },
    },
    product.id
  );
}

/** Out-of-stock alert. */
export async function outOfStock(product: { id: number; name: string }): Promise<void> {
  await notifyPosStaff(
    'pos_out_of_stock',
    {
      title: '⛔ 4A Store – Out of Stock',
      body: `${product.name} is out of stock.`,
      channelId: 'default',
      data: { type: 'pos_out_of_stock', productId: String(product.id), link: INVENTORY_LINK },
    },
    product.id
  );
}

/**
 * Fire the correct stock-state alert for a single product AFTER a sale, honouring
 * the transition rule: alert only when the sale pushed the product across its
 * threshold (previous above, new at/below). Out-of-stock takes precedence over
 * low-stock. A null/undefined threshold means low-stock alerts are disabled for
 * that product (out-of-stock still fires on crossing to <= 0).
 */
export async function stockStateAfterSale(product: {
  id: number;
  name: string;
  unit: string;
  previousStock: number;
  balanceAfter: number;
  lowStockThreshold: number | null;
}): Promise<void> {
  const { previousStock, balanceAfter, lowStockThreshold } = product;
  // Out of stock: crossed from >0 to <=0.
  if (balanceAfter <= 0 && previousStock > 0) {
    await outOfStock({ id: product.id, name: product.name });
    return;
  }
  // Low stock: a usable threshold, still in stock, crossed from above to at/below.
  if (
    lowStockThreshold != null &&
    lowStockThreshold > 0 &&
    balanceAfter > 0 &&
    balanceAfter <= lowStockThreshold &&
    previousStock > lowStockThreshold
  ) {
    await lowStock({ id: product.id, name: product.name, stock: balanceAfter, unit: product.unit });
  }
}

/** Bill cancelled / refunded alert, fired after the reversal commits. */
export async function cancelRefund(bill: {
  bill_no: string | null;
  grand_total: number;
  kind: 'cancel' | 'refund';
}): Promise<void> {
  const billNo = bill.bill_no || 'Bill';
  const label = bill.kind === 'cancel' ? 'Cancelled' : 'Refunded';
  await notifyPosStaff('pos_cancel', {
    title: `↩️ 4A Store – Bill ${label}`,
    body: `${billNo} reversed • ₹${bill.grand_total}`,
    channelId: 'default',
    data: { type: 'pos_cancel', billNo: String(billNo), link: BILL_LINK(billNo) },
  });
}

/**
 * Significant stock-adjustment alert (manual / bulk edit). The caller decides what
 * "significant" means; this only formats + delivers. "<name>: 50 → 5".
 */
export async function stockAdjust(product: {
  id: number;
  name: string;
  from: number;
  to: number;
}): Promise<void> {
  await notifyPosStaff(
    'pos_stock_adjust',
    {
      title: '🔧 4A Store – Stock Adjusted',
      body: `${product.name}: ${formatQty(product.from)} → ${formatQty(product.to)}`,
      channelId: 'default',
      data: { type: 'pos_stock_adjust', productId: String(product.id), link: INVENTORY_LINK },
    },
    product.id
  );
}

/** Trim trailing zeros from a DECIMAL(10,3) quantity for display (2.000 → "2", 0.500 → "0.5"). */
function formatQty(v: number): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n * 1000) / 1000);
}
