// ─────────────────────────────────────────────────────────────────────────────
// FIREBASE ANALYTICS — safe, no-throw helpers (growth metrics).
//
// Wraps @react-native-firebase/analytics so the app actually SENDS events and the
// Firebase console stops showing "No data available". The analytics module autolinks
// through the already-present '@react-native-firebase/app' config plugin (which also
// applies google-services.json) — push already uses that same Firebase app, so there
// is NO extra native wiring here.
//
// Every helper is fire-and-forget: a failure (native module missing, bad params) is
// swallowed via try/catch and NEVER rejects into the caller, so analytics can never
// crash the app. Call these WITHOUT `await`.
//
// No PII: event params carry only product id/name, qty, order id and numeric value —
// never phone/email/address/customer name.
// ─────────────────────────────────────────────────────────────────────────────
import analytics from '@react-native-firebase/analytics';

/** Fire-and-forget a promise, swallowing any rejection so a bad event never crashes. */
function fire(label: string, run: () => Promise<unknown>): void {
  try {
    run().catch((e) => console.warn(`[analytics] ${label} failed`, e));
  } catch (e) {
    // A synchronous throw (e.g. native module missing) must never reach the caller.
    console.warn(`[analytics] ${label} threw`, e);
  }
}

/** Screen view (per expo-router pathname). Logs the standard `screen_view` event. */
export function logScreenView(screenName: string, screenClass?: string): void {
  fire('logScreenView', () =>
    analytics().logScreenView({ screen_name: screenName, screen_class: screenClass ?? screenName })
  );
}

/** Item added to the cart. Numeric `value = price * qty`; no PII. */
export function logAddToCart(product: { id: number | string; name: string; price?: number }, qty: number): void {
  const value = Number(product.price ?? 0) * qty;
  fire('logAddToCart', () =>
    analytics().logEvent('add_to_cart', {
      item_id: String(product.id),
      item_name: product.name,
      quantity: qty,
      value,
      currency: 'INR',
    })
  );
}

/** Order placed successfully. `transaction_id` is the order id; items carry no PII. */
export function logPurchase(
  orderId: string,
  value: number,
  items?: { id: number | string; name: string; quantity: number; price?: number }[]
): void {
  fire('logPurchase', () =>
    analytics().logEvent('purchase', {
      transaction_id: orderId,
      value: Number(value) || 0,
      currency: 'INR',
      ...(items && items.length
        ? {
            items: items.map((i) => ({
              item_id: String(i.id),
              item_name: i.name,
              quantity: i.quantity,
              price: Number(i.price ?? 0),
            })),
          }
        : {}),
    })
  );
}

/** App opened. RNFirebase auto-logs this natively too; an explicit call is idempotent. */
export function logAppOpen(): void {
  fire('logAppOpen', () => analytics().logAppOpen());
}

/** Generic passthrough for any other event. Keep params free of PII. */
export function logEvent(name: string, params?: Record<string, string | number | boolean>): void {
  fire(`logEvent(${name})`, () => analytics().logEvent(name, params));
}
