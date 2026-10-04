import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { useLocalSearchParams, useRouter } from 'expo-router';
import StoreHeader from '../src/components/StoreHeader';
import { Button, Card, GradientButton, Screen, styles as ui } from '../src/components/ui';
import { showToast } from '../src/store/ui';
import { speakHindi, openWhatsApp } from '../src/native';
import { useSettings } from '../src/queries';
import { STORE_WHATSAPP_DEFAULT } from '../src/config';
import { colors, radius } from '../src/theme';

export default function OrderSuccess() {
  const router = useRouter();
  const p = useLocalSearchParams<{ orderId: string; name: string; total: string; address: string; items: string }>();
  const settings = useSettings().data;
  const items: { name: string; quantity: number }[] = (() => { try { return JSON.parse(p.items || '[]'); } catch { return []; } })();

  const cardRef = useRef<View>(null);
  const autoFired = useRef(false);
  const [sharing, setSharing] = useState(false);

  const storeWa = settings?.storePhone || STORE_WHATSAPP_DEFAULT;

  function orderMessage() {
    const list = items.map((i, idx) => `${idx + 1}. ${i.name} × ${i.quantity}`).join('\n');
    const count = items.reduce((n, i) => n + Number(i.quantity || 0), 0);
    return `*🛒 New Order – 4astore*\n\n*Order ID:* #${p.orderId}\n*Customer:* ${p.name}\n\n*Delivery Address:* ${p.address}\n\n*Items:*\n${list}\n\n*Item count:* ${count}\n*Total: ₹${p.total}*\n*Payment:* UPI ✅ (Screenshot attached)\n\n---\n4astore | Chandargarh`;
  }

  function whatsapp() {
    openWhatsApp(storeWa, orderMessage());
  }

  /** Capture the order-confirmation card and open the WhatsApp share-sheet with the image.
   *  (whatsapp:// deep links can only carry text — an image must go through the native
   *  share-sheet, where the user picks WhatsApp and taps send; apps cannot send silently.) */
  async function shareScreenshot() {
    try {
      setSharing(true);
      const uri = await captureRef(cardRef, { format: 'png', quality: 1, result: 'tmpfile' });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: `Order #${p.orderId}` });
      } else {
        showToast('Sharing not available on this device.', 'error');
      }
    } catch {
      showToast('Screenshot share nahi ho saka / स्क्रीनशॉट साझा नहीं हुआ।', 'error');
    } finally {
      setSharing(false);
    }
  }

  useEffect(() => {
    if (autoFired.current) return;
    autoFired.current = true;
    showToast('🎉 Order placed successfully / ऑर्डर सफलतापूर्वक दर्ज हो गया!', 'success');
    speakHindi('4A Store परिवार की तरफ़ से धन्यवाद। आपका भुगतान और ऑर्डर सफलतापूर्वक दर्ज हो गया है।');
    // Auto-send the order text to the store WhatsApp (user taps send inside WhatsApp),
    // then surface the order screenshot via the share-sheet so it can be attached.
    const t1 = setTimeout(() => whatsapp(), 900);
    const t2 = setTimeout(() => { void shareScreenshot(); }, 1800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Screen header={<StoreHeader title="Order Placed" />}>
      <View ref={cardRef} collapsable={false}>
        <Card style={{ alignItems: 'center', paddingVertical: 30 }}>
          <Text style={{ fontSize: 64 }}>🎉</Text>
          <Text style={{ fontSize: 20, fontWeight: '800', color: colors.primaryDark, textAlign: 'center', marginTop: 8 }}>Order Successfully Placed!{'\n'}ऑर्डर सफलतापूर्वक दर्ज हो गया!</Text>
          <Text style={{ fontWeight: '700', color: colors.dark, marginTop: 10 }}>Order ID: #{p.orderId}</Text>
          {!!p.name && <Text style={[ui.muted, { marginTop: 4 }]}>{p.name}</Text>}
          {!!p.address && <Text style={[ui.muted, { textAlign: 'center', marginTop: 2 }]}>📍 {p.address}</Text>}
          <Text style={{ fontWeight: '800', color: colors.primaryDark, marginTop: 8 }}>Total: ₹{p.total}</Text>
          {items.length > 0 && (
            <View style={{ alignSelf: 'stretch', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
              {items.map((i, idx) => (
                <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
                  <Text style={{ color: colors.dark, flex: 1 }}>{idx + 1}. {i.name}</Text>
                  <Text style={{ color: colors.gray }}>× {i.quantity}</Text>
                </View>
              ))}
            </View>
          )}
          <Text style={[ui.muted, { textAlign: 'center', marginTop: 10 }]}>4A Store परिवार की तरफ़ से धन्यवाद। हम भुगतान जाँचकर जल्द पुष्टि करेंगे।</Text>
          <Text style={{ color: colors.primary, fontSize: 13, marginTop: 10 }}>✅ Order sent to store / ऑर्डर स्टोर को भेजा गया</Text>
        </Card>
      </View>

      <View style={{ gap: 10, marginTop: 14 }}>
        <Button title="💬 Send Order on WhatsApp / WhatsApp पर भेजें" color={colors.whatsapp} onPress={whatsapp} style={{ borderRadius: radius.pill }} />
        <Button title={sharing ? '⏳ Preparing…' : '📸 Send Screenshot on WhatsApp / स्क्रीनशॉट भेजें'} color={colors.green} loading={sharing} onPress={shareScreenshot} style={{ borderRadius: radius.pill }} />
        <GradientButton title="📍 Track Order / ऑर्डर ट्रैक करें" onPress={() => router.replace(`/track/${p.orderId}`)} />
        <Button title="📋 View My Orders / मेरे ऑर्डर देखें" onPress={() => router.replace('/orders')} />
        <Button title="🏠 Continue Shopping / खरीदारी जारी रखें" color={colors.secondary} onPress={() => router.replace('/')} />
      </View>
    </Screen>
  );
}
