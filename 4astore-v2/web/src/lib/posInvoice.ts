// POS invoice sharing for the web admin (design §8). SELF-CONTAINED, zero new
// web dependencies.
//
// Why NOT reuse web/src/lib/invoice.ts: that file uses jsPDF core with
// `const rupee = 'Rs. '` and CANNOT render ₹ / Devanagari / emoji; it stays
// untouched for online orders. The POS invoice instead renders the same Unicode
// HTML template the mobile app uses and prints it through the BROWSER print
// pipeline (a hidden <iframe> + window.print()), which gives both "Print" and
// "Save as PDF" with no html2canvas / jsPDF and no new package.
//
// Totals are taken from the server bill VERBATIM — the renderer never recomputes
// rate × quantity (design finding 6 / FEAT-002: read the stored DECIMAL totals).
import type { PosBill, PosBillItem } from './pos';

// Store defaults mirror web/src/lib/invoice.ts; the live owner setting
// (settings.storeAddress, romanized) is preferred and these are the fallback.
const STORE_ADDRESS_DEFAULT = 'Gajana Road, Chandargarh, Nabinagar, Bihar - 824301';
const STORE_PHONE_DEFAULT = '8210874123';
// Devanagari address — used ONLY when both the owner setting and the romanized
// default are blank (design §8.2 / FEAT-005 step 3).
export const STORE_ADDRESS_DEVANAGARI = 'गाजना रोड, चंद्रगढ़, नबीनगर, औरंगाबाद, बिहार – 824301';

export interface InvoiceLine {
  name: string;
  qtyLabel: string;
  rate: number;
  amount: number; // server line_total, verbatim
  manual?: boolean;
}

export interface InvoiceData {
  kind: 'pos' | 'order';
  invoiceNo: string;
  dateLabel: string;
  storeName: string;
  storeAddress: string;
  storePhone: string;
  customerName?: string | null;
  customerMobile?: string | null;
  lines: InvoiceLine[];
  subtotal: number;
  discount: number;
  taxTotal: number;
  deliveryCharge?: number | null;
  grandTotal: number;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  amountPaid?: number | null;
  status?: string | null;
}

const money = (n: number) => `₹${Number(n || 0).toFixed(2)}`;

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function invoiceDateLabel(iso: string | number | Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso ?? '');
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Adapt a server POS bill into the invoice shape (totals verbatim). */
export function billToInvoice(
  bill: PosBill,
  settings?: { storeAddress?: string | null; storePhone?: string | null } | null
): InvoiceData {
  const storeAddress = (settings?.storeAddress || '').trim() || STORE_ADDRESS_DEFAULT || STORE_ADDRESS_DEVANAGARI;
  const storePhone = (settings?.storePhone || '').trim() || STORE_PHONE_DEFAULT;

  return {
    kind: 'pos',
    invoiceNo: bill.bill_no || `#${bill.id}`,
    dateLabel: invoiceDateLabel(bill.created_at),
    storeName: '4A Store',
    storeAddress,
    storePhone,
    customerName: bill.customer_name,
    customerMobile: bill.customer_mobile,
    lines: bill.items.map((it: PosBillItem) => ({
      name: it.name,
      qtyLabel: `${it.quantity} ${it.unit}`.trim(),
      rate: Number(it.rate),
      amount: Number(it.line_total), // server total — NOT rate × quantity
      manual: !!it.is_manual,
    })),
    subtotal: Number(bill.subtotal),
    discount: Number(bill.discount),
    taxTotal: Number(bill.tax_total),
    deliveryCharge: null, // POS has NO delivery row
    grandTotal: Number(bill.grand_total),
    paymentMethod: bill.payment_method,
    paymentStatus: bill.payment_status,
    amountPaid: Number(bill.amount_paid),
    status: bill.status,
  };
}

export const THANK_YOU_EN = 'Thank you for shopping with 4A Store!';
export const THANK_YOU_HI = '4A Store पर खरीदारी करने के लिए आपका धन्यवाद। 🙏';

/** One shared Unicode A4 template; kind:'pos' omits Delivery, adds Tax + Payment rows. */
export function posInvoiceHtml(data: InvoiceData): string {
  const rows = data.lines
    .map(
      (l) =>
        `<tr><td>${esc(l.name)}${l.manual ? ' <small>✎</small>' : ''}</td><td class="r">${esc(l.qtyLabel)}</td><td class="r">${money(l.rate)}</td><td class="r">${money(l.amount)}</td></tr>`
    )
    .join('');

  const wmTile = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><text x="0" y="80" transform="rotate(-30 100 60)" font-family="Arial, sans-serif" font-size="54" font-weight="800" fill="rgba(44,111,173,.07)">4A</text></svg>`
  );

  const customerBlock =
    data.customerName || data.customerMobile
      ? `<h3>Bill To</h3><div>${esc(data.customerName || 'Walk-in')}${data.customerMobile ? `<br/>Mobile: ${esc(data.customerMobile)}` : ''}</div>`
      : '';

  const isPos = data.kind === 'pos';
  const taxRow = data.taxTotal > 0 ? `<div><span>Tax</span><span>${money(data.taxTotal)}</span></div>` : '';
  const discountRow = data.discount > 0 ? `<div><span>Discount</span><span>- ${money(data.discount)}</span></div>` : '';
  const deliveryRow = isPos
    ? ''
    : `<div><span>Delivery</span><span>${data.deliveryCharge ? money(data.deliveryCharge) : 'FREE'}</span></div>`;
  const payMethod = (data.paymentMethod || 'cash').toUpperCase();
  const payStatus = data.paymentStatus ? ` · ${esc(data.paymentStatus)}` : '';
  const paymentRows = isPos
    ? `<div><span>Payment</span><span>${esc(payMethod)}${payStatus}</span></div>` +
      (data.amountPaid != null ? `<div><span>Paid</span><span>${money(data.amountPaid)}</span></div>` : '')
    : '';

  return `<!doctype html><html><head><meta charset="utf-8"/><style>
    @page { size: A4; margin: 0; }
    body { font-family: 'Noto Sans', Arial, sans-serif; margin: 0; color: #3c3c3c; font-size: 12px; }
    .wm { position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 0; pointer-events: none;
          background-image: url("data:image/svg+xml,${wmTile}"); background-repeat: repeat; }
    .head, .wrap { position: relative; z-index: 1; }
    .head { background: #2C6FAD; color: #fff; padding: 28px 40px; display: flex; justify-content: space-between; align-items: center; }
    .brand { display: flex; align-items: center; }
    .logo { width: 48px; height: 48px; border-radius: 8px; background: #fff; padding: 4px; margin-right: 14px; }
    .head h1 { margin: 0; font-size: 26px; } .head small { display: block; font-size: 10px; opacity: .9; margin-top: 4px; }
    .inv { text-align: right; } .inv h2 { margin: 0; font-size: 20px; letter-spacing: 2px; }
    .wrap { padding: 24px 40px; }
    .meta { text-align: right; margin-bottom: 14px; }
    h3 { color: #2C6FAD; margin: 0 0 6px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th { background: #2C6FAD; color: #fff; text-align: left; padding: 9px 8px; font-size: 11px; letter-spacing: .3px; }
    td { padding: 8px; border-bottom: 1px solid #e6e6e6; }
    tbody tr:nth-child(even) { background: #fafafa; }
    .r { text-align: right; } .tot { width: 260px; margin-left: auto; margin-top: 14px; }
    .tot div { display: flex; justify-content: space-between; padding: 3px 0; }
    .grand { border-top: 2px solid #2C6FAD; color: #2C6FAD; font-weight: 700; font-size: 15px; margin-top: 6px; padding-top: 6px !important; }
    .foot { color: #828282; margin-top: 24px; padding-top: 12px; border-top: 1px solid #e6e6e6; font-size: 11px; }
  </style></head><body>
    <div class="wm"></div>
    <div class="head"><div class="brand"><img class="logo" src="https://4astore.com/notification-logo.png"/><div><h1>${esc(data.storeName)}</h1><small>Grocery in Minutes</small><small>${esc(data.storeAddress)}</small><small>Phone: ${esc(data.storePhone)}</small></div></div>
    <div class="inv"><h2>INVOICE</h2><div>${esc(data.invoiceNo)}</div></div></div>
    <div class="wrap">
      <div class="meta">Date: ${esc(data.dateLabel)}${data.status ? `<br/>Status: ${esc(data.status)}` : ''}</div>
      ${customerBlock}
      <table><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="tot">
        <div><span>Subtotal</span><span>${money(data.subtotal)}</span></div>
        ${discountRow}
        ${taxRow}
        ${deliveryRow}
        <div class="grand"><span>Grand Total</span><span>${money(data.grandTotal)}</span></div>
        ${paymentRows}
      </div>
      <div class="foot">${THANK_YOU_EN}<br/>${THANK_YOU_HI}</div>
    </div></body></html>`;
}

/** §8.3 WhatsApp / copy text summary (plain Unicode). */
export function posWhatsAppText(data: InvoiceData): string {
  const sep = '--------------------------';
  const lines = data.lines
    .map((l) => `• ${l.name} — ${l.qtyLabel} × ${money(l.rate)} = ${money(l.amount)}`)
    .join('\n');
  const parts: string[] = [
    `🧾 *4A Store* — Invoice ${data.invoiceNo}`,
    data.storeAddress,
    `Date: ${data.dateLabel}`,
  ];
  if (data.customerName || data.customerMobile) {
    parts.push(`Customer: ${data.customerName || 'Walk-in'}${data.customerMobile ? ` (${data.customerMobile})` : ''}`);
  }
  parts.push(sep, lines, sep, `Subtotal: ${money(data.subtotal)}`);
  if (data.discount > 0) parts.push(`Discount: - ${money(data.discount)}`);
  if (data.taxTotal > 0) parts.push(`Tax: ${money(data.taxTotal)}`);
  parts.push(`*Grand Total: ${money(data.grandTotal)}*`);
  const payMethod = (data.paymentMethod || 'cash').toUpperCase();
  parts.push(`Payment: ${payMethod}${data.paymentStatus ? ` (${data.paymentStatus})` : ''}`);
  parts.push('', THANK_YOU_HI, THANK_YOU_EN);
  return parts.join('\n');
}

// --------------------------------------------------------------------------
// Browser print pipeline — hidden <iframe> + window.print(). The user picks a
// physical printer (Print) OR "Save as PDF" from the same system dialog, so one
// helper covers BOTH the Print and Download-PDF actions with zero new deps.
// --------------------------------------------------------------------------

/**
 * Print (or Save-as-PDF) the given invoice HTML via a transient hidden iframe.
 * The iframe is removed after the print dialog closes (afterprint) with a timed
 * fallback for browsers that don't fire that event.
 */
export function printInvoiceHtml(html: string): void {
  if (typeof document === 'undefined') return;
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    // Remove on the next tick so the print job isn't cancelled mid-flight.
    setTimeout(() => iframe.remove(), 0);
  };

  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) {
      cleanup();
      return;
    }
    win.addEventListener('afterprint', cleanup);
    // Fallback for browsers that never fire afterprint.
    setTimeout(cleanup, 60_000);
    try {
      win.focus();
      win.print();
    } catch {
      cleanup();
    }
  };

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
}

/** Print / Save-as-PDF a POS bill (both the Print and Download-PDF actions). */
export function printPosBill(bill: PosBill, settings?: { storeAddress?: string | null; storePhone?: string | null } | null): void {
  printInvoiceHtml(posInvoiceHtml(billToInvoice(bill, settings)));
}

/** Build the WhatsApp / copy text summary for a POS bill. */
export function posBillText(bill: PosBill, settings?: { storeAddress?: string | null; storePhone?: string | null } | null): string {
  return posWhatsAppText(billToInvoice(bill, settings));
}

/**
 * Copy text to the clipboard. Uses the async Clipboard API when available and
 * falls back to a hidden textarea + execCommand for older / insecure contexts.
 * Returns true on success.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Native share (Web Share API) with a clipboard fallback. Returns 'shared',
 * 'copied' or 'unavailable' so the caller can toast appropriately.
 */
export async function nativeShareText(text: string): Promise<'shared' | 'copied' | 'unavailable'> {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      await navigator.share({ text });
      return 'shared';
    }
  } catch (e) {
    // User abort is not an error — report nothing further.
    if ((e as Error)?.name === 'AbortError') return 'shared';
  }
  return (await copyText(text)) ? 'copied' : 'unavailable';
}
