import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS } from '../config';
import { getUser, logout, getOrders, getCart } from '../utils/storage';

export default function ProfileScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [orderCount, setOrderCount] = useState(0);
  const [cartCount, setCartCount] = useState(0);

  useFocusEffect(useCallback(() => {
    getUser().then(u => { setUser(u); if (!u) navigation.replace('Login'); });
    getOrders().then(o => setOrderCount(o.length));
    getCart().then(c => setCartCount(c.reduce((s,i) => s + i.quantity, 0)));
  }, []));

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure?', [
      { text:'Cancel' },
      { text:'Logout', style:'destructive', onPress: async () => { await logout(); navigation.replace('Login'); }}
    ]);
  };

  if (!user) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{user.name.charAt(0).toUpperCase()}</Text></View>
        <Text style={styles.name}>{user.name}</Text>
        <Text style={styles.sub}>@{user.username || user.mobile}</Text>
      </View>

      <View style={styles.stats}>
        <View style={styles.statItem}><Text style={styles.statNum}>{orderCount}</Text><Text style={styles.statLabel}>Orders</Text></View>
        <View style={styles.statItem}><Text style={styles.statNum}>{cartCount}</Text><Text style={styles.statLabel}>In Cart</Text></View>
      </View>

      <View style={styles.menu}>
        <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('Orders')}>
          <Text style={styles.menuIcon}>📦</Text><Text style={styles.menuText}>My Orders</Text><Text style={styles.menuArrow}>→</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('Cart')}>
          <Text style={styles.menuIcon}>🛒</Text><Text style={styles.menuText}>My Cart</Text><Text style={styles.menuArrow}>→</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.menuItem, { borderBottomWidth:0 }]} onPress={handleLogout}>
          <Text style={styles.menuIcon}>🚪</Text><Text style={[styles.menuText, {color:COLORS.accent}]}>Logout</Text><Text style={styles.menuArrow}>→</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex:1, backgroundColor:COLORS.bg },
  header: { backgroundColor:COLORS.primary, paddingVertical:30, alignItems:'center', borderBottomLeftRadius:20, borderBottomRightRadius:20 },
  avatar: { width:60, height:60, borderRadius:30, backgroundColor:'rgba(255,255,255,0.2)', alignItems:'center', justifyContent:'center', borderWidth:2, borderColor:'rgba(255,255,255,0.5)' },
  avatarText: { color:'#fff', fontSize:24, fontWeight:'800' },
  name: { color:'#fff', fontSize:18, fontWeight:'700', marginTop:10 },
  sub: { color:'rgba(255,255,255,0.8)', fontSize:13, marginTop:2 },
  stats: { flexDirection:'row', justifyContent:'center', gap:40, paddingVertical:20 },
  statItem: { alignItems:'center' },
  statNum: { fontSize:22, fontWeight:'800', color:COLORS.primaryDark },
  statLabel: { fontSize:12, color:COLORS.gray, marginTop:2 },
  menu: { backgroundColor:'#fff', margin:16, borderRadius:12, overflow:'hidden' },
  menuItem: { flexDirection:'row', alignItems:'center', padding:16, borderBottomWidth:1, borderBottomColor:'#f5f5f5' },
  menuIcon: { fontSize:20, marginRight:12 },
  menuText: { flex:1, fontSize:15, fontWeight:'600', color:'#333' },
  menuArrow: { color:COLORS.gray, fontSize:16 },
});
