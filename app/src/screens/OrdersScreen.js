import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS } from '../config';
import { getOrders } from '../utils/storage';

export default function OrdersScreen() {
  const [orders, setOrders] = useState([]);

  useFocusEffect(useCallback(() => { getOrders().then(setOrders); }, []));

  if (orders.length === 0) {
    return (
      <View style={styles.empty}><Text style={{fontSize:40}}>📋</Text>
        <Text style={styles.emptyTitle}>No orders yet</Text>
        <Text style={styles.emptyText}>Place your first order!</Text>
      </View>
    );
  }

  const statusColor = (s) => {
    if (s === 'Delivered') return '#1b5e20';
    if (s === 'Out for Delivery') return '#2e7d32';
    if (s === 'Processing') return '#6a1b9a';
    if (s === 'Confirmed') return '#1565c0';
    return '#e65100';
  };

  return (
    <ScrollView style={styles.container}>
      {orders.map(o => (
        <View key={o.orderId} style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.orderId}>#{o.orderId}</Text>
            <View style={[styles.statusBadge, { backgroundColor: statusColor(o.orderStatus)+'22' }]}>
              <Text style={[styles.statusText, { color: statusColor(o.orderStatus) }]}>{o.orderStatus}</Text>
            </View>
          </View>
          <Text style={styles.date}>{new Date(o.orderDate).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })}</Text>
          {o.items.map((item, i) => (
            <View key={i} style={styles.itemRow}>
              <Text style={styles.itemName}>{item.name} × {item.quantity}</Text>
              <Text style={styles.itemPrice}>₹{item.price * item.quantity}</Text>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>₹{o.totalAmount}</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex:1, backgroundColor:COLORS.bg, padding:12 },
  empty: { flex:1, alignItems:'center', justifyContent:'center', backgroundColor:COLORS.bg },
  emptyTitle: { fontSize:18, fontWeight:'700', marginTop:12 },
  emptyText: { fontSize:14, color:COLORS.gray, marginTop:6 },
  card: { backgroundColor:'#fff', borderRadius:12, padding:16, marginBottom:12, shadowColor:'#000', shadowOpacity:0.04, shadowRadius:4, elevation:1 },
  header: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:6 },
  orderId: { fontSize:15, fontWeight:'700', color:COLORS.primaryDark },
  statusBadge: { paddingHorizontal:10, paddingVertical:3, borderRadius:12 },
  statusText: { fontSize:11, fontWeight:'700' },
  date: { fontSize:12, color:COLORS.gray, marginBottom:10 },
  itemRow: { flexDirection:'row', justifyContent:'space-between', paddingVertical:4, borderBottomWidth:0.5, borderBottomColor:'#f0f0f0' },
  itemName: { fontSize:13, color:'#555' },
  itemPrice: { fontSize:13, color:'#333' },
  totalRow: { flexDirection:'row', justifyContent:'space-between', marginTop:10, paddingTop:10, borderTopWidth:1.5, borderTopColor:COLORS.border },
  totalLabel: { fontSize:15, fontWeight:'700' },
  totalValue: { fontSize:15, fontWeight:'800', color:COLORS.primaryDark },
});
