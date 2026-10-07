// A4 invoice (same layout as the web jsPDF invoice) rendered natively with expo-print.
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { Order } from './types';
import { STORE_ADDRESS_DEFAULT, STORE_WHATSAPP_DEFAULT } from './config';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function invoiceHtml(order: Order, storePhone = STORE_WHATSAPP_DEFAULT, storeAddress = STORE_ADDRESS_DEFAULT) {
  const c = order.customer || {};
  const date = new Date(order.order_date).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const rows = order.items
    .map(
      (i) => `<tr><td>${esc(i.name)}${i.weight ? ` <small>(${esc(i.weight)})</small>` : ''}</td><td class="r">${i.quantity}</td><td class="r">₹${i.price}</td><td class="r">₹${i.price * i.quantity}</td></tr>`
    )
    .join('');
  // Diagonal repeating "4A" watermark: an inline SVG tile (rotated -30°) tiled as a
  // fixed full-page background. expo-print's Chromium renders SVG data URIs, so the
  // mark reaches the page edges and stays behind the content (kept very faint so the
  // table text stays readable).
  const wmTile = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><text x="0" y="80" transform="rotate(-30 100 60)" font-family="Arial, sans-serif" font-size="54" font-weight="800" fill="rgba(44,111,173,.07)">4A</text></svg>`
  );
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
    <div class="head"><div class="brand"><img class="logo" src="https://4astore.com/notification-logo.png"/><div><h1>4A Store</h1><small>Grocery in Minutes</small><small>${esc(storeAddress)}</small><small>Phone: ${esc(storePhone)}</small></div></div>
    <div class="inv"><h2>INVOICE</h2><div>#${esc(order.order_id)}</div></div></div>
    <div class="wrap">
      <div class="meta">Date: ${esc(date)}<br/>Status: ${esc(order.order_status || 'Order Placed')}${
        order.order_status === 'Delivered' && order.delivered_at ? `<br/>Delivered: ${esc(new Date(order.delivered_at).toLocaleString('en-IN'))}` : ''
      }</div>
      <h3>Bill To</h3>
      <div>${esc(c.name)}<br/>Mobile: ${esc(c.mobile)}<br/>${esc(c.address)}, ${esc(c.city)} - ${esc(c.pincode)}</div>
      <table><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="tot">
        <div><span>Subtotal</span><span>₹${order.subtotal || order.total_amount}</span></div>
        ${order.discount ? `<div><span>Discount</span><span>- ₹${order.discount}</span></div>` : ''}
        <div><span>Delivery</span><span>${order.delivery_charge ? `₹${order.delivery_charge}` : 'FREE'}</span></div>
        <div class="grand"><span>Total</span><span>₹${order.total_amount}</span></div>
      </div>
      <div class="foot">Payment: ${esc(order.payment_method || 'UPI')}<br/>Thank you for shopping with 4A Store!</div>
    </div></body></html>`;
}

/** Create the PDF and open the share / save sheet (Downloads, Drive, WhatsApp …). */
export async function downloadInvoice(order: Order, storePhone?: string, storeAddress?: string) {
  const { uri } = await Print.printToFileAsync({ html: invoiceHtml(order, storePhone, storeAddress), width: 595, height: 842 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Invoice-${order.order_id}.pdf`, UTI: 'com.adobe.pdf' });
  } else {
    await Print.printAsync({ uri });
  }
}
