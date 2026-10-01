import React from 'react';
import { Share, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import StoreHeader from '../../src/components/StoreHeader';
import ProductImage from '../../src/components/ProductImage';
import { Button, Card, EmptyState, GradientButton, Loading, Screen, Stepper, styles as ui } from '../../src/components/ui';
import { useProducts, useSettings } from '../../src/queries';
import { useCart } from '../../src/store/cart';
import { SITE_URL } from '../../src/config';
import { colors } from '../../src/theme';

export default function ProductDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const q = useProducts();
  const hideMrp = !!useSettings().data?.hideMrp;
  const product = (q.data ?? []).find((p) => String(p.id) === String(id));
  const inCart = useCart((s) => s.items.find((i) => i.id === product?.id));
  const { add, setQty } = useCart();

  if (q.isLoading) return <Screen header={<StoreHeader back hideSearch />}><Loading /></Screen>;
  if (!product) {
    return (
      <Screen header={<StoreHeader back hideSearch />}>
        <EmptyState icon="📦" title="Product not found." action={<GradientButton title="Browse Products" onPress={() => router.push('/products')} />} />
      </Screen>
    );
  }

  // Smart link: opens this product in the app (App Links) or on the website.
  const share = () => Share.share({ message: `${product.name} – ₹${product.price} | 4A Store\n${SITE_URL}/product/${product.id}` });

  return (
    <Screen header={<StoreHeader back hideSearch />}>
      <Card style={{ padding: 16 }}>
        <ProductImage name={product.name} weight={product.weight} category={product.category} image={product.image} height={280} />
      </Card>
      <View style={{ paddingVertical: 14 }}>
        {!!product.brand && <Text style={ui.muted}>{product.brand}</Text>}
        <Text style={ui.h2}>{product.name}</Text>
        {!!product.weight && <Text style={ui.muted}>{product.weight}</Text>}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 12 }}>
          <Text style={{ fontSize: 26, fontWeight: '900', color: colors.primaryDark }}>₹{product.price}</Text>
          {!hideMrp && product.mrp > product.price && <Text style={{ fontSize: 16, color: colors.gray, textDecorationLine: 'line-through' }}>₹{product.mrp}</Text>}
          {!hideMrp && product.discount > 0 && (
            <View style={{ backgroundColor: colors.accent, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>{product.discount}% OFF</Text>
            </View>
          )}
        </View>
        {!!product.description && <Text style={{ color: colors.dark, lineHeight: 22, marginBottom: 12 }}>{product.description}</Text>}
        {Array.isArray(product.features) && product.features.map((f, i) => <Text key={i} style={{ color: colors.dark, marginBottom: 4 }}>✔️ {f}</Text>)}

        <View style={{ marginTop: 14 }}>
          {!product.in_stock ? (
            <Text style={{ color: colors.accent, fontWeight: '800', fontSize: 15 }}>Out of stock</Text>
          ) : hideMrp ? null : inCart ? (
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <Stepper qty={inCart.quantity} label={product.name} onMinus={() => setQty(product.id, inCart.quantity - 1)} onPlus={() => setQty(product.id, inCart.quantity + 1)} />
              <GradientButton title="Go to Cart →" onPress={() => router.push('/cart')} style={{ flex: 1 }} />
            </View>
          ) : (
            <GradientButton title="Add to Cart" onPress={() => add(product)} />
          )}
        </View>
        <Button title="🔗 Share" outline onPress={share} style={{ marginTop: 12 }} />
      </View>
    </Screen>
  );
}
