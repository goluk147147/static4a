import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, API } from '../config';
import ProductCard from '../components/ProductCard';
import { getCart, addToCart, updateCartQty } from '../utils/storage';

export default function ProductsScreen({ navigation, route }) {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [cart, setCart] = useState([]);
  const [selectedCat, setSelectedCat] = useState(route.params?.category || '');
  const [searchQuery, setSearchQuery] = useState(route.params?.search || '');
  const [sortBy, setSortBy] = useState('');

  useEffect(() => {
    (async () => {
      const [pRes, cRes] = await Promise.all([fetch(API.products), fetch(API.categories)]);
      setProducts(await pRes.json());
      setCategories(await cRes.json());
    })();
  }, []);

  useFocusEffect(useCallback(() => { getCart().then(setCart); }, []));

  useEffect(() => {
    if (route.params?.category) setSelectedCat(route.params.category);
    if (route.params?.search) setSearchQuery(route.params.search);
  }, [route.params]);

  const getQty = (id) => { const i = cart.find(c => c.id === id); return i ? i.quantity : 0; };
  const handleAdd = async (p) => { setCart(await addToCart(p)); };
  const handleQty = async (id, ch) => { setCart(await updateCartQty(id, ch)); };

  // Filter
  let filtered = [...products];
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(p => p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q) || p.category.replace(/-/g,' ').includes(q));
  }
  if (selectedCat) filtered = filtered.filter(p => p.category === selectedCat);
  if (sortBy === 'price-low') filtered.sort((a,b) => a.price - b.price);
  else if (sortBy === 'price-high') filtered.sort((a,b) => b.price - a.price);
  else if (sortBy === 'discount') filtered.sort((a,b) => b.discount - a.discount);

  return (
    <View style={styles.container}>
      {/* Search */}
      <View style={styles.searchRow}>
        <TextInput style={styles.searchInput} placeholder="Search..." value={searchQuery}
          onChangeText={setSearchQuery} />
        {searchQuery ? <TouchableOpacity onPress={() => setSearchQuery('')}><Text style={styles.clearBtn}>✕</Text></TouchableOpacity> : null}
      </View>

      {/* Category Pills */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillsScroll} contentContainerStyle={{ paddingHorizontal:12 }}>
        <TouchableOpacity style={[styles.pill, !selectedCat && styles.pillActive]} onPress={() => setSelectedCat('')}>
          <Text style={[styles.pillText, !selectedCat && styles.pillTextActive]}>🛒 All</Text>
        </TouchableOpacity>
        {categories.map(c => (
          <TouchableOpacity key={c.id} style={[styles.pill, selectedCat===c.slug && styles.pillActive]} onPress={() => setSelectedCat(c.slug)}>
            <Text style={[styles.pillText, selectedCat===c.slug && styles.pillTextActive]}>{c.icon} {c.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Sort Row */}
      <View style={styles.sortRow}>
        <Text style={styles.count}>{filtered.length} products</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {['','price-low','price-high','discount'].map(s => (
            <TouchableOpacity key={s} style={[styles.sortChip, sortBy===s && styles.sortChipActive]} onPress={() => setSortBy(s)}>
              <Text style={[styles.sortText, sortBy===s && styles.sortTextActive]}>
                {s===''?'Default':s==='price-low'?'Low→High':s==='price-high'?'High→Low':'Discount'}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Products */}
      <ScrollView contentContainerStyle={styles.grid}>
        {filtered.length === 0 ? (
          <View style={styles.empty}><Text style={{fontSize:40}}>🔍</Text><Text style={styles.emptyText}>No products found</Text></View>
        ) : (
          <View style={styles.gridInner}>
            {filtered.map(p => (
              <View key={p.id} style={{ width:'48%', marginBottom:8 }}>
                <ProductCard product={p} cartQty={getQty(p.id)}
                  onAdd={() => handleAdd(p)} onInc={() => handleQty(p.id, 1)} onDec={() => handleQty(p.id, -1)}
                  onPress={() => navigation.navigate('ProductDetail', { product: p })} />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex:1, backgroundColor:COLORS.bg },
  searchRow: { flexDirection:'row', alignItems:'center', margin:12, backgroundColor:'#fff', borderRadius:10, paddingHorizontal:14, borderWidth:1.5, borderColor:COLORS.border },
  searchInput: { flex:1, paddingVertical:10, fontSize:14 },
  clearBtn: { color:COLORS.primary, fontSize:16, fontWeight:'700', padding:8 },
  pillsScroll: { maxHeight:50, marginBottom:8 },
  pill: { paddingHorizontal:14, paddingVertical:8, borderRadius:20, borderWidth:1.5, borderColor:'#e0e0e0', marginRight:8, backgroundColor:'#fff' },
  pillActive: { backgroundColor:COLORS.primary, borderColor:COLORS.primary },
  pillText: { fontSize:12, fontWeight:'600', color:'#555' },
  pillTextActive: { color:'#fff' },
  sortRow: { flexDirection:'row', alignItems:'center', paddingHorizontal:12, marginBottom:8, gap:8 },
  count: { fontSize:12, color:COLORS.gray, marginRight:8 },
  sortChip: { paddingHorizontal:10, paddingVertical:5, borderRadius:12, backgroundColor:'#fff', borderWidth:1, borderColor:'#e0e0e0', marginRight:6 },
  sortChipActive: { backgroundColor:COLORS.primary, borderColor:COLORS.primary },
  sortText: { fontSize:11, color:'#555' },
  sortTextActive: { color:'#fff' },
  grid: { paddingBottom:20 },
  gridInner: { flexDirection:'row', flexWrap:'wrap', paddingHorizontal:8, justifyContent:'space-between' },
  empty: { alignItems:'center', paddingTop:60 },
  emptyText: { fontSize:16, color:COLORS.gray, marginTop:12 },
});
