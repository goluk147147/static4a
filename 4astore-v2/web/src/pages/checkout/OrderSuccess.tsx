import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { showToast } from '../../store/toast';
import { speakHindi } from '../../lib/checkout';

export interface PlacedOrder {
  orderId: string;
  customer: { name: string; mobile: string; address: string; city: string; pincode: string };
  items: { name: string; quantity: number }[];
  totalAmount: number;
  deliveryAddress: string;
}

/** Step 3 — same content and actions as the original #orderSuccess block. */
export default function OrderSuccess({ order, storePhone }: { order: PlacedOrder; storePhone?: string }) {
  useEffect(() => {
    showToast('🎉 Order placed successfully / आपका ऑर्डर सफलतापूर्वक दर्ज हो गया!', 'success');
    speakHindi('4A Store परिवार की तरफ़ से धन्यवाद। आपका भुगतान और ऑर्डर सफलतापूर्वक दर्ज हो गया है।');
  }, []);

  function sendOrderWhatsApp() {
    const itemsList = order.items.map((item, i) => `${i + 1}. ${item.name} × ${item.quantity}`).join('\n');
    const itemCount = order.items.reduce((n, item) => n + Number(item.quantity || 0), 0);
    const msg =
      `*🛒 New Order – 4astore*\n\n` +
      `*Order ID:* #${order.orderId}\n` +
      `*Customer:* ${order.customer.name}\n` +
      `*Mobile:* ${order.customer.mobile}\n\n` +
      `*Delivery Address:* ${order.deliveryAddress}\n\n` +
      `*Items:*\n${itemsList}\n\n` +
      `*Item count:* ${itemCount}\n` +
      `*Total: ₹${order.totalAmount}*\n` +
      `*Payment:* UPI ✅ (Screenshot attached)\n\n` +
      `---\n4astore | Chandargarh`;
    const digits = String(storePhone || '8210874123').replace(/\D/g, '');
    const storeNumber = digits.length === 10 ? `91${digits}` : digits;
    const encoded = encodeURIComponent(msg);
    const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
    if (isMobile) {
      window.location.href = `https://wa.me/${storeNumber}?text=${encoded}`;
    } else {
      window.open(`https://web.whatsapp.com/send?phone=${storeNumber}&text=${encoded}`, '_blank', 'noopener');
    }
  }

  return (
    <div className="order-success">
      <Helmet><title>Order Placed - 4A Store</title></Helmet>
      <div className="success-icon">🎉</div>
      <h2>Order Successfully Placed! / आपका ऑर्डर सफलतापूर्वक दर्ज हो गया!</h2>
      <p className="order-id">Your Order ID / आपका ऑर्डर नंबर: #{order.orderId}</p>
      <p>4A Store परिवार की तरफ़ से धन्यवाद। हम आपके भुगतान की पुष्टि करके जल्द ऑर्डर पूरा करेंगे।</p>
      <p>We will verify your payment and confirm shortly / हम भुगतान जाँचकर जल्द पुष्टि करेंगे।</p>
      <p style={{ marginTop: 12, fontSize: 13, color: 'var(--primary)' }}>✅ Order sent to store / ऑर्डर स्टोर को भेजा गया</p>

      <p style={{ marginTop: 16, fontSize: 13, color: '#666' }}>For faster confirmation, send your order on WhatsApp too / जल्दी पुष्टि के लिए ऑर्डर WhatsApp पर भी भेजें:</p>
      <button onClick={sendOrderWhatsApp} style={{ marginTop: 8, padding: '12px 26px', background: '#25D366', color: '#fff', border: 'none', borderRadius: 30, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
        💬 Send Order on WhatsApp / WhatsApp पर ऑर्डर भेजें
      </button>

      <div style={{ marginTop: 20 }}>
        <Link to="/orders" className="btn-primary" style={{ marginRight: 10 }}>View My Orders / मेरे ऑर्डर देखें</Link>
        <Link to={`/track/${order.orderId}`} className="btn-primary" style={{ marginRight: 10 }}>Track Order / ऑर्डर ट्रैक करें</Link>
        <Link to="/" className="btn-primary" style={{ background: 'var(--secondary)' }}>Continue Shopping / खरीदारी जारी रखें</Link>
      </div>
    </div>
  );
}
