// Unit tests for the shared, pure POS invoice core (src/posInvoice.ts).
// Proves the kind:'pos' invoice:
//   1. renders the SERVER-COMPUTED totals verbatim (no rate × quantity recompute),
//      so a 0.5 kg weight line foots exactly to the server grand_total;
//   2. has NO Delivery row (that row is order-invoice only);
//   3. renders ₹ / Devanagari / emoji directly (Unicode, not jsPDF "Rs. ").
// No React, no expo, no network — runs under the Node test runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { billToInvoice, posInvoiceHtml, posWhatsAppText } from '../posInvoice.ts';
import type { PosBill } from '../pos.ts';

// A bill with a weight line (0.5 kg) and a GST line. The server has ALREADY
// computed every total; the renderer must echo them, never recompute.
const bill: PosBill = {
  id: 1,
  bill_no: 'INV-000001',
  idempotency_key: 'k-1',
  status: 'completed',
  customer_name: 'Ramesh',
  customer_mobile: '9876543210',
  subtotal: 150.0, // 0.5 kg @ ₹200 = 100.00  +  2 pcs @ ₹25 = 50.00  (server base totals)
  discount: 0,
  tax_total: 2.5, // GST only on the 50.00 line (5%)
  grand_total: 152.5, // 150.00 - 0 + 2.50  (server grand_total)
  amount_paid: 152.5,
  balance_due: 0,
  payment_method: 'cash',
  payment_status: 'paid',
  payments_json: null,
  note: null,
  created_by: 'owner',
  cancelled_by: null,
  cancel_reason: null,
  created_at: '2026-10-14T10:30:00.000Z',
  updated_at: '2026-10-14T10:30:00.000Z',
  items: [
    { product_id: 10, name: 'Aata', sku: 'ATA', unit: 'kg', quantity: 0.5, rate: 200, tax_rate: 0, line_total: 100.0, is_manual: false },
    { product_id: 11, name: 'Biscuit', sku: 'BIS', unit: 'pcs', quantity: 2, rate: 25, tax_rate: 5, line_total: 52.5, is_manual: false },
  ],
};

test('billToInvoice copies the server totals verbatim (no price × quantity recompute)', () => {
  const inv = billToInvoice(bill, { storeAddress: '', storePhone: '' });
  assert.equal(inv.kind, 'pos');
  // Line amounts are the server line_total, not rate*quantity.
  assert.equal(inv.lines[0].amount, 100.0);
  assert.equal(inv.lines[1].amount, 52.5);
  // The weight line keeps its decimal quantity + unit.
  assert.equal(inv.lines[0].qtyLabel, '0.5 kg');
  assert.equal(inv.subtotal, 150.0);
  assert.equal(inv.taxTotal, 2.5);
  assert.equal(inv.grandTotal, 152.5);
});

test('the invoice foots exactly to the server grand_total for the 0.5 kg bill', () => {
  const inv = billToInvoice(bill);
  // subtotal - discount + tax == grand_total (server-consistent).
  assert.equal(inv.subtotal - inv.discount + inv.taxTotal, inv.grandTotal);
  // The rendered grand total shows the server value.
  const html = posInvoiceHtml(inv);
  assert.match(html, /Grand Total<\/span><span>₹152\.50<\/span>/);
  assert.match(html, /Subtotal<\/span><span>₹150\.00<\/span>/);
  assert.match(html, /Tax<\/span><span>₹2\.50<\/span>/);
});

test('kind:"pos" invoice has NO Delivery row', () => {
  const html = posInvoiceHtml(billToInvoice(bill));
  assert.ok(!/Delivery/.test(html), 'POS invoice must not render a Delivery row');
});

test('POS invoice shows Payment method + status rows instead of Delivery', () => {
  const html = posInvoiceHtml(billToInvoice(bill));
  assert.match(html, /Payment<\/span><span>CASH · paid<\/span>/);
  assert.match(html, /Paid<\/span><span>₹152\.50<\/span>/);
});

test('invoice renders ₹, Devanagari and emoji directly (Unicode, not jsPDF "Rs. ")', () => {
  const html = posInvoiceHtml(billToInvoice(bill));
  assert.ok(html.includes('₹'), 'must render the ₹ sign');
  assert.ok(!html.includes('Rs. '), 'must NOT fall back to the jsPDF "Rs. " prefix');
  assert.ok(html.includes('धन्यवाद'), 'bilingual Devanagari thank-you must be present');
  assert.ok(html.includes('🙏'), 'emoji must render');
});

test('blank store address falls back to the romanized default, not Devanagari', () => {
  const inv = billToInvoice(bill, { storeAddress: '  ', storePhone: '' });
  assert.equal(inv.storeAddress, 'Gajana Road, Chandargarh, Nabinagar, Bihar - 824301');
  // An explicit owner address is used as-is.
  const inv2 = billToInvoice(bill, { storeAddress: 'My Shop, Main Road', storePhone: '9999999999' });
  assert.equal(inv2.storeAddress, 'My Shop, Main Road');
  assert.equal(inv2.storePhone, '9999999999');
});

test('WhatsApp text summary foots to grand_total and carries ₹ + thank-you', () => {
  const txt = posWhatsAppText(billToInvoice(bill));
  assert.ok(txt.includes('Invoice INV-000001'));
  assert.ok(txt.includes('Grand Total: ₹152.50'));
  assert.ok(txt.includes('Aata — 0.5 kg × ₹200.00 = ₹100.00'));
  assert.ok(txt.includes('धन्यवाद'));
  assert.ok(!/Delivery/.test(txt), 'text summary must not mention Delivery');
});
