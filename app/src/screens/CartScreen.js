import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, STORE_CONFIG } from '../config';
import { getCart, updateCartQty, removeFromCart, getCartTotals } from '../utils/storage';

export default function CartScreen({ navigation }) {
  const [cart, setCart] = useState([]);

  useFocusEffect(useCallback(() => { getCart().then(setCart); }, []));

  const handleQty = async (id, ch) => { setCart(await updateCartQty(id, ch)); };
  const handleRemove = async (id) => { setCart(await removeFromCart(id)); };

  if (cart.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={{ fontSize:50 }}>🛒</Text>
        <Text style={styles.emptyTitle}>Your cart is empty</Text>
        <Text style={styles.emptyText}>Add items to start shopping</Text>
        <TouchableOpacity style={styles.shopBtn} onPress={() => navigation.navigate('Products')}>
          <Text style={styles.shopBtnText}>Browse Products →</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const totals = getCartTotals(cart, STORE_CONFIG.freeDeliveryAbove, STORE_CONFIG.deliveryCharge);

  return (
    <View style={styles.container}>
      <ScrollView style={{ flex:1 }}>
        {cart.map(item => (
          <View key={item.id} style={styles.cartItem}>
            <View style={styles.itemInfo}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemMeta}>{item.brand} · {item.weight}</Text>
              <View style={styles.qtyRow}>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => handleQty(item.id, -1)}><Text style={styles.qtyBtnText}>−</Text></TouchableOpacity>
                <Text style={styles.qtyNum}>{item.quantity}</Text>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => handleQty(item.id, 1)}><Text style={styles.qtyBtnText}>+</Text></TouchableOpacity>
              </View>
            </View>
            <View style={styles.itemRight}>
              <Text style={styles.itemPrice}>₹{item.price * item.quantity}</Text>
              <TouchableOpacity onPress={() => handleRemove(item.id)}><Text style={styles.removeBtn}>🗑️</Text></TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Summary */}
      <View style={styles.summary}>
        <View style={styles.sumRow}><Text style={styles.sumLabel}>Subtotal ({totals.itemCount} items)</Text><Text>₹{totals.mrpTotal}</Text></View>
        <View style={styles.sumRow}><Text style={styles.sumLabel}>Discount</Text><Text style={{color:COLORS.primary}}>-₹{totals.discount}</Text></View>
        <View style={styles.sumRow}><Text style={styles.sumLabel}>Delivery</Text><Text>{totals.delivery === 0 ? 'FREE' : '₹'+totals.delivery}</Text></View>
        <View style={[styles.sumRow, styles.totalRow]}><Text style={styles.totalLabel}>Total</Text><Text style={styles.totalValue}>₹{totals.total}</Text></View>
        <TouchableOpacity style={styles.checkoutBtn} onPress={() => navigation.navigate('Checkout')}>
          <Text style={styles.checkoutBtnText}>Proceed to Checkout →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex:1, backgroundColor:COLORS.bg },
  emptyContainer: { flex:1, alignItems:'center', justifyContent:'center', padding:40, backgroundColor:COLORS.bg },
  emptyTitle: { fontSize:18, fontWeight:'700', marginTop:16, color:COLORS.dark },
  emptyText: { fontSize:14, color:COLORS.gray, marginTop:6 },
  shopBtn: { marginTop:20, backgroundColor:COLORS.primary, borderRadius:10, paddingHorizontal:28, paddingVertical:12 },
  shopBtnText: { color:'#fff', fontWeight:'700', fontSize:15 },
  cartItem: { flexDirection:'row', backgroundColor:'#fff', marginHorizontal:12, marginTop:10, borderRadius:12, padding:14, alignItems:'center' },
  itemInfo: { flex:1 },
  itemName: { fontSize:14, fontWeight:'600', color:'#333' },
  itemMeta: { fontSize:12, color:COLORS.gray, marginVertical:4 },
  qtyRow: { flexDirection:'row', alignItems:'center', marginTop:6 },
  qtyBtn: { backgroundColor:COLORS.primary, width:30, height:30, borderRadius:6, alignItems:'center', justifyContent:'center' },
  qtyBtnText: { color:'#fff', fontSize:16, fontWeight:'700' },
  qtyNum: { marginHorizontal:14, fontSize:15, fontWeight:'700', color:COLORS.primary },
  itemRight: { alignItems:'flex-end', gap:10 },
  itemPrice: { fontSize:16, fontWeight:'700', color:COLORS.primaryDark },
  removeBtn: { fontSize:18 },
  summary: { backgroundColor:'#fff', padding:16, borderTopWidth:1, borderTopColor:COLORS.border },
  sumRow: { flexDirection:'row', justifyContent:'space-between', paddingVertical:5 },
  sumLabel: { fontSize:13, color:COLORS.gray },
  totalRow: { borderTopWidth:2, borderTopColor:COLORS.border, marginTop:8, paddingTop:12 },
  totalLabel: { fontSize:17, fontWeight:'700', color:COLORS.dark },
  totalValue: { fontSize:17, fontWeight:'800', color:COLORS.primaryDark },
  checkoutBtn: { backgroundColor:COLORS.primary, borderRadius:10, paddingVertical:14, alignItems:'center', marginTop:14 },
  checkoutBtnText: { color:'#fff', fontSize:16, fontWeight:'700' },
});
