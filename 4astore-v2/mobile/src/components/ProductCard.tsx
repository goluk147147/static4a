import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Product } from '../types';
import { useCart } from '../store/cart';
import { useSettings } from '../queries';
import { colors, radius, shadow } from '../theme';
import ProductImage from './ProductImage';
import { Stepper } from './ui';

/** Same card as web ProductCard.tsx: discount badge, image, brand, name, weight, price/MRP, add/stepper. */
export default function ProductCard({ product, width }: { product: Product; width?: number }) {
  const router = useRouter();
  const inCart = useCart((s) => s.items.find((i) => i.id === product.id));
  const add = useCart((s) => s.add);
  const setQty = useCart((s) => s.setQty);
  const hideMrp = !!useSettings().data?.hideMrp;
  const showDiscount = product.discount > 0 && !hideMrp;
  const open = () => router.push(`/product/${product.id}`);

  return (
    <View style={[styles.card, width ? { width } : { flex: 1 }]}>
      <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`${product.name}, ₹${product.price}`}>
        <ProductImage name={product.name} weight={product.weight} category={product.category} image={product.image} height={110} />
        {showDiscount && (
          <View style={styles.badge}><Text style={styles.badgeText}>{product.discount}% OFF</Text></View>
        )}
        {!!product.brand && <Text style={styles.brand} numberOfLines={1}>{product.brand}</Text>}
        <Text style={styles.name} numberOfLines={2}>{product.name}</Text>
        <Text style={styles.weight} numberOfLines={1}>{product.weight || ' '}</Text>
      </Pressable>
      <View style={styles.priceRow}>
        <Text style={styles.price}>₹{product.price}</Text>
        {showDiscount && product.mrp > product.price && <Text style={styles.mrp}>₹{product.mrp}</Text>}
      </View>
      {hideMrp ? null : product.in_stock ? (
        inCart ? (
          <Stepper qty={inCart.quantity} label={product.name} onMinus={() => setQty(product.id, inCart.quantity - 1)} onPlus={() => setQty(product.id, inCart.quantity + 1)} />
        ) : (
          <Pressable onPress={() => add(product)} style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={`Add ${product.name} to cart`}>
            <Text style={styles.addText}>Add to Cart</Text>
          </Pressable>
        )
      ) : (
        <Text style={styles.out}>Out of Stock</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.glass, borderRadius: radius.md, padding: 10, margin: 5, borderWidth: 1, borderColor: 'rgba(255,255,255,0.78)', ...shadow },
  badge: { position: 'absolute', top: 6, left: 6, backgroundColor: colors.accent, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4 },
  badgeText: { color: '#fff', fontSize: 10.5, fontWeight: '800' },
  brand: { fontSize: 11, color: colors.gray, marginTop: 8 },
  name: { fontSize: 13.5, fontWeight: '700', color: colors.dark, marginTop: 2, minHeight: 36 },
  weight: { fontSize: 11.5, color: colors.gray, marginBottom: 4 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  price: { fontSize: 16, fontWeight: '800', color: colors.primaryDark },
  mrp: { fontSize: 12.5, color: colors.gray, textDecorationLine: 'line-through' },
  addBtn: { backgroundColor: colors.secondary, borderRadius: radius.sm, minHeight: 38, alignItems: 'center', justifyContent: 'center' },
  addText: { color: '#fff', fontWeight: '800', fontSize: 13.5, textShadowColor: 'rgba(0,0,0,0.25)', textShadowRadius: 2 },
  out: { color: colors.accent, fontWeight: '700', fontSize: 13, paddingVertical: 8 },
});
