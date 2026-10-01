import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import StoreHeader from '../src/components/StoreHeader';
import { Button, Card, GradientButton, Screen, styles as ui } from '../src/components/ui';
import { showToast } from '../src/store/ui';
import { speakHindi, openWhatsApp } from '../src/native';
import { useSettings } from '../src/queries';
import { STORE_WHATSAPP_DEFAULT } from '../src/config';
import { colors } from '../src/theme';

export default function OrderSuccess() {
  const router = useRouter();
  const p = useLocalSearchParams<{ orderId: string; name: string; total: string; address: string; items: string }>();
  const settings = useSettings().data;
  const items: { name: string; quantity: number }[] = (() => { try { return JSON.parse(p.items || '[]'); } catch { return []; } })();

  useEffect(() => {
    showToast('🎉 Order placed successfully / ऑर्डर सफलतापूर्वक दर्ज हो गया!', 'success');
    speakHindi('4A Store परिवार की तरफ़ से धन्यवाद। आपका भुगतान और ऑर्डर सफलतापूर्वक दर्ज हो गया है।');
  }, []);

  function whatsapp() {
    const list = items.map((i, idx) => `${idx + 1}. ${i.name} × ${i.quantity}`).join('\n');
    const count = items.reduce((n, i) => n + Number(i.quantity || 0), 0);
    const msg = `*🛒 New Order – 4astore*\n\n*Order ID:* #${p.orderId}\n*Customer:* ${p.name}\n\n*Delivery Address:* ${p.address}\n\n*Items:*\n${list}\n\n*Item count:* ${count}\n*Total: ₹${p.total}*\n*Payment:* UPI ✅ (Screenshot attached)\n\n---\n4astore | Chandargarh`;
    openWhatsApp(settings?.storePhone || STORE_WHATSAPP_DEFAULT, msg);
  }

  return (
    <Screen header={<StoreHeader title="Order Placed" />}>
      <Card style={{ alignItems: 'center', paddingVertical: 30 }}>
        <Text style={{ fontSize: 64 }}>🎉</Text>
        <Text style={{ fontSize: 20, fontWeight: '800', color: colors.primaryDark, textAlign: 'center', marginTop: 8 }}>Order Successfully Placed!{'\n'}ऑर्डर सफलतापूर्वक दर्ज हो गया!</Text>
        <Text style={{ fontWeight: '700', color: colors.dark, marginTop: 10 }}>Order ID: #{p.orderId}</Text>
        <Text style={[ui.muted, { textAlign: 'center', marginTop: 10 }]}>4A Store परिवार की तरफ़ से धन्यवाद। हम भुगतान जाँचकर जल्द पुष्टि करेंगे।</Text>
        <Text style={{ color: colors.primary, fontSize: 13, marginTop: 10 }}>✅ Order sent to store / ऑर्डर स्टोर को भेजा गया</Text>
        <Button title="💬 Send Order on WhatsApp / WhatsApp पर भेजें" color={colors.whatsapp} onPress={whatsapp} style={{ marginTop: 16, borderRadius: 30 }} />
      </Card>
      <View style={{ gap: 10, marginTop: 14 }}>
        <GradientButton title="📍 Track Order / ऑर्डर ट्रैक करें" onPress={() => router.replace(`/track/${p.orderId}`)} />
        <Button title="📋 View My Orders / मेरे ऑर्डर देखें" onPress={() => router.replace('/orders')} />
        <Button title="🏠 Continue Shopping / खरीदारी जारी रखें" color={colors.secondary} onPress={() => router.replace('/')} />
      </View>
    </Screen>
  );
}
