import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '../config';

const EMOJIS = {
  'atta':'🌾','rice':'🍚','mustard oil':'🫒','sunflower':'🌻','salt':'🧂',
  'tea':'🍵','coffee':'☕','maggi':'🍜','soap':'🧼','banana':'🍌',
  'apple':'🍎','mango':'🥭','orange':'🍊','potato':'🥔','onion':'🧅',
  'tomato':'🍅','biscuit':'🍪','parle':'🍪','lays':'🥔','kurkure':'🥨',
  'milk':'🥛','butter':'🧈','cheese':'🧀','bread':'🍞','cola':'🥤',
  'pepsi':'🥤','sprite':'🥤','water':'💧','dal':'🫘','sugar':'🍬',
  'ghee':'🫕','shampoo':'🧴','pen':'🖊️','notebook':'📓','baby':'👶',
};

function getEmoji(name) {
  const n = name.toLowerCase();
  for (const [k, v] of Object.entries(EMOJIS)) {
    if (n.includes(k)) return v;
  }
  return '📦';
}

export default function ProductCard({ product, cartQty, onAdd, onInc, onDec, onPress }) {
  const emoji = getEmoji(product.name);

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      {product.discount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{product.discount}% OFF</Text>
        </View>
      )}
      <View style={styles.imgBox}>
        <Text style={styles.emoji}>{emoji}</Text>
        <Text style={styles.imgName} numberOfLines={1}>{product.name}</Text>
      </View>
      <Text style={styles.brand}>{product.brand}</Text>
      <Text style={styles.name} numberOfLines={2}>{product.name}</Text>
      <Text style={styles.weight}>{product.weight}</Text>
      <View style={styles.priceRow}>
        <Text style={styles.price}>₹{product.price}</Text>
        {product.discount > 0 && <Text style={styles.mrp}>₹{product.mrp}</Text>}
      </View>
      {cartQty > 0 ? (
        <View style={styles.qtyRow}>
          <TouchableOpacity style={styles.qtyBtn} onPress={onDec}><Text style={styles.qtyBtnText}>−</Text></TouchableOpacity>
          <Text style={styles.qtyNum}>{cartQty}</Text>
          <TouchableOpacity style={styles.qtyBtn} onPress={onInc}><Text style={styles.qtyBtnText}>+</Text></TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={styles.addBtn} onPress={onAdd}>
          <Text style={styles.addBtnText}>Add to Cart</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor:'#fff', borderRadius:12, padding:12, flex:1, margin:4, shadowColor:'#000', shadowOpacity:0.05, shadowRadius:4, elevation:2 },
  badge: { position:'absolute', top:8, left:8, backgroundColor:COLORS.accent, borderRadius:4, paddingHorizontal:6, paddingVertical:2, zIndex:1 },
  badgeText: { color:'#fff', fontSize:10, fontWeight:'700' },
  imgBox: { backgroundColor:COLORS.primaryLight, borderRadius:10, height:100, alignItems:'center', justifyContent:'center', marginBottom:8 },
  emoji: { fontSize:36 },
  imgName: { fontSize:10, color:COLORS.primaryDark, fontWeight:'600', marginTop:4 },
  brand: { fontSize:11, color:COLORS.gray },
  name: { fontSize:13, fontWeight:'600', color:'#333', marginVertical:2 },
  weight: { fontSize:11, color:COLORS.gray, marginBottom:4 },
  priceRow: { flexDirection:'row', alignItems:'center', gap:6, marginBottom:8 },
  price: { fontSize:15, fontWeight:'700', color:COLORS.primaryDark },
  mrp: { fontSize:12, color:COLORS.gray, textDecorationLine:'line-through' },
  addBtn: { backgroundColor:COLORS.primary, borderRadius:8, paddingVertical:9, alignItems:'center' },
  addBtnText: { color:'#fff', fontSize:13, fontWeight:'700' },
  qtyRow: { flexDirection:'row', borderWidth:2, borderColor:COLORS.primary, borderRadius:8, overflow:'hidden' },
  qtyBtn: { backgroundColor:COLORS.primary, width:36, alignItems:'center', justifyContent:'center', paddingVertical:8 },
  qtyBtnText: { color:'#fff', fontSize:16, fontWeight:'700' },
  qtyNum: { flex:1, textAlign:'center', fontSize:15, fontWeight:'700', color:COLORS.primary, alignSelf:'center' },
});
