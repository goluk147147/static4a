import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import StoreHeader from '../../src/components/StoreHeader';
import ProductImage from '../../src/components/ProductImage';
import { Card, EmptyState, GradientButton, Loading, Screen, Stepper, SummaryRow, styles as ui } from '../../src/components/ui';
import { useCart } from '../../src/store/cart';
import { useAuth } from '../../src/store/auth';
import { useProducts, useSettings } from '../../src/queries';
import { cartTotals } from '../../src/checkout';
import { colors } from '../../src/theme';

export default function Cart() {
  const router = useRouter();
  const { items, setQty, remove } = useCart();
  const settings = useSettings().data;
  const productsQ = useProducts();
  const products = productsQ.data ?? [];
  const user = useAuth((s) => s.user);

  if (productsQ.isLoading && items.length) return <Screen header={<StoreHeader title="Your Cart" />}><Loading /></Screen>;
  const t = cartTotals(items, products, settings, user);
  const freeAbove = settings?.freeDeliveryAbove ?? 500;

  return (
    <Screen header={<StoreHeader title="🛒 Your Cart" />}>
      {items.length === 0 ? (
        <EmptyState icon="🛒" title="Your cart is empty" text="Add some fresh groceries to get started." action={<GradientButton title="Shop Now" onPress={() => router.push('/products')} />} />
      ) : (
        <>
          {items.map((i) => (
            <Card key={i.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <ProductImage name={i.name} weight={i.weight} category={i.category ?? products.find((p) => p.id === i.id)?.category} image={i.image} height={56} style={{ width: 56 }} compact />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', fontSize: 14, color: colors.dark }} numberOfLines={2}>{i.name}</Text>
                <Text style={ui.muted}>{i.weight} · ₹{i.price}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                  <Stepper qty={i.quantity} label={i.name} onMinus={() => setQty(i.id, i.quantity - 1)} onPlus={() => setQty(i.id, i.quantity + 1)} />
                  <Text style={{ fontWeight: '800', color: colors.primaryDark }}>₹{i.price * i.quantity}</Text>
                </View>
              </View>
              <Pressable onPress={() => remove(i.id)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${i.name}`}>
                <Text style={{ fontSize: 22, color: '#c62828' }}>×</Text>
              </Pressable>
            </Card>
          ))}
          <Card style={{ marginTop: 6 }}>
            <SummaryRow label="Subtotal" value={`₹${t.subtotal}`} />
            {settings?.deliveryChargeEnabled !== false && (
              <SummaryRow label="Delivery" value={t.deliveryCharge === 0 ? 'FREE' : `₹${t.deliveryCharge}`} color={t.deliveryCharge === 0 ? colors.primary : undefined} />
            )}
            {t.handlingCharge > 0 && <SummaryRow label="Handling charge" value={`₹${t.handlingCharge}`} />}
            {settings?.deliveryChargeEnabled !== false && t.deliveryCharge > 0 && user?.custom_delivery == null && t.subtotal < freeAbove && (
              <Text style={[ui.muted, { fontSize: 12 }]}>Add ₹{freeAbove - t.subtotal} more for free delivery</Text>
            )}
            <View style={ui.divider} />
            <SummaryRow label="Total" value={`₹${t.total}`} bold />
            <GradientButton
              title={user ? 'Proceed to Checkout' : 'Login to Checkout'}
              onPress={() => router.push(user ? '/checkout' : { pathname: '/login', params: { next: '/cart' } } as never)}
              style={{ marginTop: 14 }}
            />
          </Card>
        </>
      )}
    </Screen>
  );
}
