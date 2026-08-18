import { Linking } from 'react-native';
import { STORE_CONFIG } from '../config';

export function sendWhatsAppOrder(order) {
  const itemsList = order.items
    .map((item, i) => `${i + 1}. ${item.name} × ${item.quantity}`)
    .join('\n');

  const message =
    `*🛒 New Order – 4astore*\n\n` +
    `*Order ID:* #${order.orderId}\n` +
    `*Customer:* ${order.customer.name}\n` +
    `*Mobile:* ${order.customer.mobile}\n\n` +
    `*Address:* ${order.customer.address}, ${order.customer.city} – ${order.customer.pincode}\n\n` +
    `*Items:*\n${itemsList}\n\n` +
    `*Total: ₹${order.totalAmount}*\n` +
    `*Payment:* UPI ✅\n\n` +
    `---\n4astore | Chandargarh`;

  const url = `https://api.whatsapp.com/send?phone=${STORE_CONFIG.whatsappNumber}&text=${encodeURIComponent(message)}`;
  Linking.openURL(url);
}
