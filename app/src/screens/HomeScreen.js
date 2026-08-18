import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, API } from '../config';
import ProductCard from '../components/ProductCard';
import { getCart, addToCart, updateCartQty } from '../utils/storage';

export default function HomeScreen({ navigation }) {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [cart, setCart] = useState([]);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    try {
      const [pRes, cRes] = await Promise.all([fetch(API.products), fetch(API.categories)]);
      setProducts(await pRes.json());
      setCategories(await cRes.json());
    } catch (e) { console.log('Load error:', e); }
  };

  useEffect(() => { loadData(); }, []);

  useFocusEffect(useCallback(() => {
    getCart().then(setCart);
  }, []));

  const onRefresh = async () => { setRefreshing(true); await loadData(); setCart(await getCart()); setRefreshing(false); };

  const getQty = (id) => { const i = cart.find(c => c.id === id); return i ? i.quantity : 0; };

  const handleAdd = async (p) => { setCart(await addToCart(p)); };
  const handleQty = async (id, change) => { setCart(await updateCartQty(id, change)); };

  const popular = products.slice(0, 12);

  return (
    <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />}>
      {/* Search */}
      <View style={styles.searchRow}>
        <TextInput style={styles.searchInput} placeholder="Search groceries..." value={search}
          onChangeText={setSearch} onSubmitEditing={() => navigation.navigate('Products', { search })} />
        <TouchableOpacity style={styles.searchBtn} onPress={() => navigation.navigate('Products', { search })}>
          <Text style={{ color:'#fff', fontSize:16 }}>🔍</Text>
        </TouchableOpacity>
      </View>

      {/* Banner */}
      <View style={styles.banner}>
        <Text style={styles.bannerTitle}>🥬 Fresh Groceries at Your Doorstep</Text>
        <Text style={styles.bannerSub}>Quality products from 4astore, Chandargarh</Text>
        <TouchableOpacity style={styles.bannerBtn} onPress={() => navigation.navigate('Products')}>
          <Text style={styles.bannerBtnText}>Shop Now →</Text>
        </TouchableOpacity>
      </View>

      {/* Categories */}
      <Text style={styles.sectionTitle}>🛍️ Categories</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll}>
        {categories.map(cat => (
          <TouchableOpacity key={cat.id} style={styles.catCard}
            onPress={() => navigation.navigate('Products', { category: cat.slug })}>
            <Text style={styles.catIcon}>{cat.icon}</Text>
            <Text style={styles.catName}>{cat.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Popular Products */}
      <Text style={styles.sectionTitle}>🔥 Popular Products</Text>
      <View style={styles.prodGrid}>
        {popular.map(p => (
          <View key={p.id} style={{ width:'48%' }}>
            <ProductCard product={p} cartQty={getQty(p.id)}
              onAdd={() => handleAdd(p)}
              onInc={() => handleQty(p.id, 1)}
              onDec={() => handleQty(p.id, -1)}
              onPress={() => navigation.navigate('ProductDetail', { product: p })} />
          </View>
        ))}
      </View>

      <TouchableOpacity style={styles.viewAllBtn} onPress={() => navigation.navigate('Products')}>
        <Text style={styles.viewAllText}>View All Products →</Text>
      </TouchableOpacity>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerTitle}>4astore</Text>
        <Text style={styles.footerText}>Gajana Road, Chandargarh, Nabinagar{'\n'}Bihar – 824301 | 📞 8210874123</Text>
        <Text style={styles.footerText}>UPI: goluk147147@ybl</Text>
        <Text style={styles.footerCopy}>© 2026 4astore. All Rights Reserved.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex:1, backgroundColor:COLORS.bg },
  searchRow: { flexDirection:'row', margin:16, marginBottom:12, gap:8 },
  searchInput: { flex:1, backgroundColor:'#fff', borderRadius:25, paddingHorizontal:16, paddingVertical:10, fontSize:14, borderWidth:1.5, borderColor:COLORS.border },
  searchBtn: { backgroundColor:COLORS.primary, width:42, height:42, borderRadius:21, alignItems:'center', justifyContent:'center' },
  banner: { margin:16, marginTop:0, backgroundColor:COLORS.primary, borderRadius:16, padding:24, alignItems:'center' },
  bannerTitle: { color:'#fff', fontSize:18, fontWeight:'800', textAlign:'center', marginBottom:6 },
  bannerSub: { color:'rgba(255,255,255,0.9)', fontSize:13, textAlign:'center', marginBottom:14 },
  bannerBtn: { backgroundColor:'#fff', borderRadius:20, paddingHorizontal:24, paddingVertical:10 },
  bannerBtnText: { color:COLORS.primary, fontWeight:'700', fontSize:14 },
  sectionTitle: { fontSize:18, fontWeight:'700', marginHorizontal:16, marginTop:20, marginBottom:12, color:COLORS.dark },
  catScroll: { paddingLeft:12, marginBottom:8 },
  catCard: { backgroundColor:'#fff', borderRadius:12, padding:14, marginRight:10, alignItems:'center', width:90, shadowColor:'#000', shadowOpacity:0.04, shadowRadius:3, elevation:1 },
  catIcon: { fontSize:28, marginBottom:6 },
  catName: { fontSize:11, fontWeight:'600', color:'#444', textAlign:'center' },
  prodGrid: { flexDirection:'row', flexWrap:'wrap', paddingHorizontal:12, justifyContent:'space-between' },
  viewAllBtn: { margin:16, backgroundColor:COLORS.primary, borderRadius:10, paddingVertical:14, alignItems:'center' },
  viewAllText: { color:'#fff', fontSize:15, fontWeight:'700' },
  footer: { backgroundColor:COLORS.dark, padding:24, marginTop:20 },
  footerTitle: { color:COLORS.primary, fontSize:18, fontWeight:'800', marginBottom:8 },
  footerText: { color:'#aaa', fontSize:12, marginBottom:6, lineHeight:18 },
  footerCopy: { color:'#666', fontSize:11, marginTop:12 },
});
