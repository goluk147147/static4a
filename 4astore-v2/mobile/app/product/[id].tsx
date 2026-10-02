import React, { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, ScrollView, Share, Text, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import StoreHeader from '../../src/components/StoreHeader';
import ProductImage from '../../src/components/ProductImage';
import { Button, Card, EmptyState, GradientButton, Loading, Screen, Stepper, styles as ui } from '../../src/components/ui';
import { useProducts, useSettings } from '../../src/queries';
import { useCart } from '../../src/store/cart';
import { SITE_URL } from '../../src/config';
import { colors, radius } from '../../src/theme';

/** Tap product image → full-screen, pinch/scroll-to-zoom viewer. */
function ZoomViewer({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  const { width, height } = useWindowDimensions();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' }}>
        <Pressable onPress={onClose} style={{ position: 'absolute', top: 44, right: 20, zIndex: 10, padding: 8 }} accessibilityRole="button" accessibilityLabel="Close">
          <Text style={{ color: '#fff', fontSize: 28 }}>✕</Text>
        </Pressable>
        {/* Pinch-zoom via a zoomable ScrollView (works on Android + iOS without extra deps). */}
        <ScrollView
          maximumZoomScale={4}
          minimumZoomScale={1}
          pinchGestureEnabled
          centerContent
          contentContainerStyle={{ width, height, alignItems: 'center', justifyContent: 'center' }}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
        >
          {children}
          <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, position: 'absolute', bottom: 40 }}>🔍 Do ungliyon se zoom karein</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

/** Auto-rotating product feature highlights. */
function FeatureRotator({ features }: { features: string[] }) {
  const [idx, setIdx] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (features.length < 2) return;
    const iv = setInterval(() => {
      Animated.timing(fade, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => {
        setIdx((i) => (i + 1) % features.length);
        Animated.timing(fade, { toValue: 1, duration: 250, useNativeDriver: true }).start();
      });
    }, 2500);
    return () => clearInterval(iv);
  }, [features.length, fade]);
  if (!features.length) return null;
  return (
    <View style={{ backgroundColor: colors.primaryLight, borderRadius: radius.sm, padding: 14, marginBottom: 14, minHeight: 54, justifyContent: 'center' }}>
      <Animated.Text style={{ opacity: fade, color: colors.primaryDark, fontWeight: '700', fontSize: 14 }}>
        ✨ {features[idx]}
      </Animated.Text>
      {features.length > 1 && (
        <View style={{ flexDirection: 'row', gap: 5, marginTop: 8 }}>
          {features.map((_, i) => (
            <View key={i} style={{ width: i === idx ? 16 : 6, height: 6, borderRadius: 3, backgroundColor: i === idx ? colors.primary : '#e0cdb3' }} />
          ))}
        </View>
      )}
    </View>
  );
}

export default function ProductDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const q = useProducts();
  const hideMrp = !!useSettings().data?.hideMrp;
  const product = (q.data ?? []).find((p) => String(p.id) === String(id));
  const inCart = useCart((s) => s.items.find((i) => i.id === product?.id));
  const { add, setQty } = useCart();
  const [zoom, setZoom] = useState(false);

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
        <Pressable onPress={() => setZoom(true)} accessibilityRole="imagebutton" accessibilityLabel={`${product.name} — tap to zoom`}>
          <ProductImage name={product.name} weight={product.weight} category={product.category} image={product.image} height={280} />
          <View style={{ position: 'absolute', right: 8, bottom: 8, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 }}>
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>🔍 Zoom</Text>
          </View>
        </Pressable>
      </Card>
      <ZoomViewer visible={zoom} onClose={() => setZoom(false)}>
        <ProductImage name={product.name} weight={product.weight} category={product.category} image={product.image} height={360} style={{ width: 340 }} />
      </ZoomViewer>
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
        {Array.isArray(product.features) && product.features.length > 0 && (
          <FeatureRotator features={product.features.filter(Boolean)} />
        )}

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
