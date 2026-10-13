// Reusable click-to-share WhatsApp helpers (FREE / manual send).
//
// Everything here builds `wa.me` / `web.whatsapp.com` links that open WhatsApp
// with the message prefilled — the user taps "Send" from their own phone. This
// is NOT the paid WhatsApp Business/Cloud API: no server-side messaging, no
// per-message cost. The logic mirrors the inline share in
// `web/src/pages/checkout/OrderSuccess.tsx`.

/** Strip non-digits and prefix the India country code when a bare 10-digit number is given. */
export function normalizeWa(num: string): string {
  const digits = String(num || '').replace(/\D/g, '');
  return digits.length === 10 ? `91${digits}` : digits;
}

/**
 * Build a `wa.me` share URL.
 * - With a number → `https://wa.me/91XXXXXXXXXX?text=<encoded>`
 * - Without a number (group / pick-a-chat share) → `https://wa.me/?text=<encoded>`
 */
export function waLink(number: string | null | undefined, text: string): string {
  const encoded = encodeURIComponent(text || '');
  const n = number ? normalizeWa(number) : '';
  return n ? `https://wa.me/${n}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}

/**
 * Open WhatsApp with a prefilled message. On mobile uses `wa.me` (app deep link);
 * on desktop uses `web.whatsapp.com/send`. Mirrors OrderSuccess.tsx behaviour.
 */
export function openWhatsApp(number: string | null | undefined, text: string): void {
  const encoded = encodeURIComponent(text || '');
  const n = number ? normalizeWa(number) : '';
  const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
  if (isMobile) {
    window.location.href = n ? `https://wa.me/${n}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
  } else {
    const url = n
      ? `https://web.whatsapp.com/send?phone=${n}&text=${encoded}`
      : `https://web.whatsapp.com/send?text=${encoded}`;
    window.open(url, '_blank', 'noopener');
  }
}
