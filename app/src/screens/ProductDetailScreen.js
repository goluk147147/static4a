import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, STORE_CONFIG } from '../config';
import { getCart, addToCart, updateCartQty } from '../utils/storage';

export default function ProductDetailScreen({ route, navigation }) {
  const { product } = route.params;
  const [cart, setCart] = useState([]);

  useEffect(() => { getCart().then(setCart); }, []);

  const qty = (() => { const i = cart.find(c => c.id === product.id); return i ? i.quantity : 0; })();
  const handleAdd = async () => { setCart(await addToCart(product)); };
  const handleQty = async (ch) => { setCart(await updateCartQty(product.id, ch)); };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.imgBox}><Text style={{fontSize:80}}>📦</Text></View>
      <View style={styles.info}>
        <Text style={styles.brand}>{product.brand} · {product.weight}</Text>
        <Text style={styles.name}>{product.name}</Text>
        <View style={styles.priceRow}>
          <Text style={styles.price}>₹{product.price}</Text>
          {product.discount > 0 && <Text style={styles.mrp}>₹{product.mrp}</Text>}
          {product.discount > 0 && <View style={styles.offBadge}><Text style={styles.offText}>{product.discount}% OFF</Text></View>}
        </View>
        <Text style={styles.desc}>{product.description}</Text>

        <View style={styles.specs}>
          <View style={styles.specRow}><Text style={styles.specLabel}>Brand</Text><Text>{product.brand}</Text></View>
          <View style={styles.specRow}><Text style={styles.specLabel}>Weight</Text><Text>{product.weight}</Text></View>
          <View style={styles.specRow}><Text style={styles.specLabel}>Category</Text><Text>{product.category}</Text></View>
          <View style={styles.specRow}><Text style={styles.specLabel}>Stock</Text><Text style={{color: product.inStock ? COLORS.primary : COLORS.accent}}>{product.inStock ? '✅ In Stock' : '❌ Out of Stock'}</Text></View>
        </View>

        <View style={styles.pinBox}>
          <Text style={styles.pinTitle}>📍 Delivery: PIN 824301 only</Text>
          <Text style={styles.pinText}>Chandargarh, Nabinagar area</Text>
        </View>

        {qty > 0 ? (
          <View style={styles.qtyRow}>
            <TouchableOpacity style={styles.qtyBtn} onPress={() => handleQty(-1)}><Text style={styles.qtyBtnText}>−</Text></TouchableOpacity>
            <Text style={styles.qtyNum}>{qty}</Text>
            <TouchableOpacity style={styles.qtyBtn} onPress={() => handleQty(1)}><Text style={styles.qtyBtnText}>+</Text></TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.addBtn} onPress={handleAdd}><Text style={styles.addBtnText}>🛒 Add to Cart</Text></TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex:1, backgroundColor:COLORS.bg },
  imgBox: { backgroundColor:COLORS.primaryLight, height:200, alignItems:'center', justifyContent:'center' },
  info: { padding:20 },
  brand: { fontSize:13, color:COLORS.gray, marginBottom:4 },
  name: { fontSize:20, fontWeight:'700', color:COLORS.dark, marginBottom:10 },
  priceRow: { flexDirection:'row', alignItems:'center', gap:10, marginBottom:12 },
  price: { fontSize:24, fontWeight:'800', color:COLORS.primaryDark },
  mrp: { fontSize:15, color:COLORS.gray, textDecorationLine:'line-through' },
  offBadge: { backgroundColor:'#ffe0e0', paddingHorizontal:8, paddingVertical:3, borderRadius:4 },
  offText: { color:COLORS.accent, fontSize:12, fontWeight:'700' },
  desc: { fontSize:14, color:'#555', lineHeight:21, marginBottom:16 },
  specs: { backgroundColor:'#fff', borderRadius:12, padding:14, marginBottom:16 },
  specRow: { flexDirection:'row', justifyContent:'space-between', paddingVertical:8, borderBottomWidth:0.5, borderBottomColor:'#f0f0f0' },
  specLabel: { fontWeight:'600', color:'#666' },
  pinBox: { backgroundColor:COLORS.primaryLight, padding:14, borderRadius:10, marginBottom:20 },
  pinTitle: { fontWeight:'600', color:COLORS.primaryDark, marginBottom:4 },
  pinText: { fontSize:12, color:'#666' },
  addBtn: { backgroundColor:COLORS.primary, borderRadius:12, paddingVertical:16, alignItems:'center' },
  addBtnText: { color:'#fff', fontSize:16, fontWeight:'700' },
  qtyRow: { flexDirection:'row', alignItems:'center', justifyContent:'center', borderWidth:2, borderColor:COLORS.primary, borderRadius:12, overflow:'hidden' },
  qtyBtn: { backgroundColor:COLORS.primary, width:50, paddingVertical:14, alignItems:'center' },
  qtyBtnText: { color:'#fff', fontSize:20, fontWeight:'700' },
  qtyNum: { paddingHorizontal:30, fontSize:20, fontWeight:'700', color:COLORS.primary },
});
