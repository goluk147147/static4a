// Port of the original order-history.html A4 invoice (jsPDF, same layout).
import type { MyOrder } from './queries';

interface AndroidBridge {
  saveBase64File?: (data: string, name: string, mime: string) => void;
}

export async function downloadInvoice(order: MyOrder, storePhone = '8210874123', storeAddress = 'Gajana Road, Chandargarh, Nabinagar, Bihar - 824301') {
  // Loaded on demand so the storefront bundle stays small.
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: [595.28, 841.89] });
  const pageW = doc.internal.pageSize.getWidth();
  const left = 40;
  const right = pageW - 40;
  const rupee = 'Rs. '; // jsPDF core fonts can't render ₹
  const customer = order.customer || {};

  // Header band
  doc.setFillColor(44, 111, 173);
  doc.rect(0, 0, pageW, 125, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text('4A Store', left, 45);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Grocery in Minutes', left, 64);
  doc.setFontSize(8);
  doc.text(doc.splitTextToSize(storeAddress, right - left - 20), left, 86);
  doc.text('Phone: ' + storePhone, left, 108);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('INVOICE', right, 45, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('#' + order.order_id, right, 64, { align: 'right' });

  let y = 145;
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(9);
  const dateStr = new Date(order.order_date).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  doc.text('Date: ' + dateStr, right, y, { align: 'right' });
  doc.text('Status: ' + (order.order_status || 'Order Placed'), right, y + 14, { align: 'right' });
  if (order.order_status === 'Delivered' && order.delivered_at) {
    doc.text('Delivered: ' + new Date(order.delivered_at).toLocaleString('en-IN'), right, y + 28, { align: 'right' });
  }
  y += 44;

  // Bill to
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(44, 111, 173);
  doc.text('Bill To', left, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(60, 60, 60);
  y += 16;
  doc.text(customer.name || '', left, y);
  y += 14;
  doc.text('Mobile: ' + (customer.mobile || ''), left, y);
  y += 14;
  // Hindi village names can't be drawn by jsPDF core fonts; keep the English part.
  const city = String(customer.city || '').replace(/\s*\([^)]*\)\s*$/, '');
  doc.text(doc.splitTextToSize(`${customer.address || ''}, ${city} - ${customer.pincode || ''}`, right - left), left, y);
  y += 26;

  // Items header
  doc.setFillColor(240, 240, 240);
  doc.rect(left, y, right - left, 22, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(40, 40, 40);
  doc.text('Item', left + 8, y + 15);
  doc.text('Qty', right - 200, y + 15, { align: 'right' });
  doc.text('Price', right - 110, y + 15, { align: 'right' });
  doc.text('Amount', right - 8, y + 15, { align: 'right' });
  y += 22;

  doc.setFont('helvetica', 'normal');
  for (const item of order.items) {
    const nameLines = doc.splitTextToSize(String(item.name), right - left - 230);
    const rowH = Math.max(18, nameLines.length * 12 + 6);
    doc.text(nameLines, left + 8, y + 13);
    doc.text(String(item.quantity), right - 200, y + 13, { align: 'right' });
    doc.text(rupee + item.price, right - 110, y + 13, { align: 'right' });
    doc.text(rupee + item.price * item.quantity, right - 8, y + 13, { align: 'right' });
    doc.setDrawColor(230, 230, 230);
    doc.line(left, y + rowH, right, y + rowH);
    y += rowH;
  }
  y += 12;

  const totalsX = right - 200;
  const addTotal = (label: string, value: string, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.text(label, totalsX, y);
    doc.text(value, right - 8, y, { align: 'right' });
    y += 16;
  };
  addTotal('Subtotal', rupee + (order.subtotal || order.total_amount));
  if (order.discount) addTotal('Discount', '- ' + rupee + order.discount);
  addTotal('Delivery', order.delivery_charge ? rupee + order.delivery_charge : 'FREE');
  doc.setDrawColor(44, 111, 173);
  doc.line(totalsX, y, right, y);
  y += 16;
  doc.setTextColor(44, 111, 173);
  addTotal('Total', rupee + order.total_amount, true);

  doc.setTextColor(130, 130, 130);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Payment: ' + (order.payment_method || 'UPI'), left, y + 20);
  doc.text('Thank you for shopping with 4A Store!', left, y + 40);

  const fileName = `Invoice-${order.order_id}.pdf`;
  const android = (window as unknown as { AndroidApp?: AndroidBridge }).AndroidApp;
  if (android?.saveBase64File) {
    try {
      android.saveBase64File(doc.output('datauristring'), fileName, 'application/pdf');
      return 'saved-to-downloads';
    } catch {
      /* fall back to a normal browser download */
    }
  }
  doc.save(fileName);
  return 'downloaded';
}
