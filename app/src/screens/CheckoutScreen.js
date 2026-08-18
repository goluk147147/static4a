import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, Alert, StyleSheet, Linking } from 'react-native';
import { COLORS, STORE_CONFIG } from '../config';
import { getCart, saveCart, getCartTotals, getUser, saveOrder, generateOrderId } from '../utils/storage';
import { sendWhatsAppOrder } from '../utils/whatsapp';

export default function CheckoutScreen({ navigation }) {
  const [cart, setCart] = useState([]);
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('Chandargarh');
  const [pincode, setPincode] = useState('824301');
  const [screenshot, setScreenshot] = useState(null);
  const [showQR, setShowQR] = useState(false);
  const [orderPlaced, setOrderPlaced] = useState(null);

  useEffect(() => {
    getCart().then(setCart);
    getUser().then(u => { if (u) { setName(u.name); setMobile(u.mobile); }});
  }, []);

  const totals = getCartTotals(cart, STORE_CONFIG.freeDeliveryAbove, STORE_CONFIG.deliveryCharge);

  const proceedToPayment = () => {
    if (!name.trim()) return Alert.alert('Error', 'Please enter your name');
    if (!/^[6-9]\d{9}$/.test(mobile)) return Alert.alert('Error', 'Enter valid 10-digit mobile number');
    if (!address.trim()) return Alert.alert('Error', 'Please enter your address');
    if (pincode !== '824301') return Alert.alert('Coming Soon!', '4astore currently delivers only in PIN 824301 (Chandargarh)');
    setShowQR(true);
  };

  const pickScreenshot = async () => {
    // Simple confirmation instead of image picker (removed expo-image-picker)
    Alert.alert(
      'Payment Done?', 
      'Confirm that you have completed UPI payment of ₹' + totals.total,
      [
        { text: 'Not Yet', style: 'cancel' },
        { text: 'Yes, Paid ✅', onPress: () => setScreenshot('confirmed') }
      ]
    );
  };

  const confirmOrder = async () => {
    if (!screenshot) return Alert.alert('Upload Required', 'Please upload payment screenshot');

    const order = {
      orderId: generateOrderId(),
      customer: { name, mobile, address, city, pincode },
      items: cart.map(i => ({ id:i.id, name:i.name, weight:i.weight, price:i.price, quantity:i.quantity })),
      subtotal: totals.subtotal,
      discount: totals.discount,
      deliveryCharge: totals.delivery,
      totalAmount: totals.total,
      paymentMethod: 'UPI',
      orderStatus: 'Order Placed',
      orderDate: new Date().toISOString(),
    };

    await saveOrder(order);
    await saveCart([]);
    setOrderPlaced(order);

    // Force WhatsApp
    setTimeout(() => sendWhatsAppOrder(order), 1500);
  };

  // ORDER SUCCESS
  if (orderPlaced) {
    return (
      <View style={styles.successContainer}>
        <Text style={{ fontSize:50 }}>🎉</Text>
        <Text style={styles.successTitle}>Order Placed!</Text>
        <Text style={styles.successId}>#{orderPlaced.orderId}</Text>
        <Text style={styles.successText}>Thank you! We'll contact you shortly.</Text>
        <TouchableOpacity style={styles.btn} onPress={() => navigation.navigate('Home')}><Text style={styles.btnText}>Continue Shopping</Text></TouchableOpacity>
      </View>
    );
  }

  // UPI QR MODAL
  if (showQR) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ padding:20, alignItems:'center' }}>
        <Text style={styles.qrTitle}>📱 Pay via UPI</Text>
        <View style={styles.qrBox}>
          <Text style={{ fontSize:40 }}>📱</Text>
          <Text style={styles.qrUpi}>{STORE_CONFIG.upiId}</Text>
          <Text style={styles.qrName}>Name: {STORE_CONFIG.upiName}</Text>
        </View>
        <View style={styles.amountBox}><Text style={styles.amountText}>💰 Pay: ₹{totals.total}</Text></View>

        <Text style={styles.uploadTitle}>📸 Upload Payment Screenshot</Text>
        <TouchableOpacity style={styles.uploadBtn} onPress={pickScreenshot}>
          <Text style={styles.uploadBtnText}>{screenshot ? '✅ Screenshot Selected' : '📷 Tap to Upload Screenshot'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.btn, !screenshot && { opacity:0.5 }]} onPress={confirmOrder} disabled={!screenshot}>
          <Text style={styles.btnText}>✅ Confirm Order</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowQR(false)} style={{ marginTop:12 }}><Text style={{ color:COLORS.gray }}>← Go Back</Text></TouchableOpacity>
      </ScrollView>
    );
  }

  // CHECKOUT FORM
  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding:16 }}>
      <Text style={styles.heading}>🏠 Delivery Details</Text>
      <TextInput style={styles.input} placeholder="Full Name" value={name} onChangeText={setName} />
      <TextInput style={styles.input} placeholder="Mobile (10 digits)" value={mobile} onChangeText={setMobile} keyboardType="phone-pad" maxLength={10} />
      <TextInput style={[styles.input, { height:70 }]} placeholder="Complete Address" value={address} onChangeText={setAddress} multiline />
      <TextInput style={styles.input} placeholder="City" value={city} onChangeText={setCity} />
      <TextInput style={styles.input} placeholder="PIN Code" value={pincode} onChangeText={setPincode} keyboardType="number-pad" maxLength={6} />

      <Text style={styles.heading}>💳 Payment – UPI Only</Text>
      <View style={styles.upiInfo}>
        <Text style={styles.upiLabel}>UPI ID: <Text style={styles.upiValue}>{STORE_CONFIG.upiId}</Text></Text>
        <Text style={styles.upiLabel}>Name: <Text style={styles.upiValue}>{STORE_CONFIG.upiName}</Text></Text>
      </View>

      <View style={styles.summaryBox}>
        <Text style={styles.heading}>📦 Order Summary</Text>
        {cart.map(i => <View key={i.id} style={styles.sumRow}><Text style={styles.sumItem}>{i.name} × {i.quantity}</Text><Text>₹{i.price*i.quantity}</Text></View>)}
        <View style={[styles.sumRow,{marginTop:10,borderTopWidth:1,borderTopColor:COLORS.border,paddingTop:10}]}>
          <Text style={{fontWeight:'700',fontSize:16}}>Total</Text><Text style={{fontWeight:'800',fontSize:16,color:COLORS.primaryDark}}>₹{totals.total}</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.btn} onPress={proceedToPayment}><Text style={styles.btnText}>📱 Proceed to UPI Payment →</Text></TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex:1, backgroundColor:COLORS.bg },
  heading: { fontSize:16, fontWeight:'700', color:COLORS.dark, marginTop:16, marginBottom:10 },
  input: { backgroundColor:'#fff', borderRadius:10, paddingHorizontal:14, paddingVertical:12, fontSize:14, borderWidth:1.5, borderColor:COLORS.border, marginBottom:10 },
  upiInfo: { backgroundColor:COLORS.primaryLight, padding:14, borderRadius:10, borderWidth:1.5, borderColor:COLORS.primary },
  upiLabel: { fontSize:13, color:'#666', marginBottom:4 },
  upiValue: { fontWeight:'700', color:COLORS.primaryDark },
  summaryBox: { backgroundColor:'#fff', borderRadius:12, padding:16, marginTop:16 },
  sumRow: { flexDirection:'row', justifyContent:'space-between', paddingVertical:4 },
  sumItem: { fontSize:13, color:'#555' },
  btn: { backgroundColor:COLORS.primary, borderRadius:10, paddingVertical:15, alignItems:'center', marginTop:20 },
  btnText: { color:'#fff', fontSize:15, fontWeight:'700' },
  // QR
  qrTitle: { fontSize:20, fontWeight:'700', color:COLORS.primary, marginBottom:16 },
  qrBox: { backgroundColor:'#f8f8f8', borderRadius:12, padding:30, alignItems:'center', marginBottom:14 },
  qrUpi: { fontSize:16, fontWeight:'700', color:COLORS.primaryDark, marginTop:10 },
  qrName: { fontSize:13, color:'#666', marginTop:4 },
  amountBox: { backgroundColor:COLORS.primaryLight, padding:14, borderRadius:10, marginBottom:20 },
  amountText: { fontSize:18, fontWeight:'700', color:COLORS.primaryDark, textAlign:'center' },
  uploadTitle: { fontSize:14, fontWeight:'600', marginBottom:8 },
  uploadBtn: { backgroundColor:'#fff', borderWidth:2, borderColor:COLORS.primary, borderStyle:'dashed', borderRadius:12, padding:20, alignItems:'center', marginBottom:16, width:'100%' },
  uploadBtnText: { color:COLORS.primary, fontWeight:'600' },
  // Success
  successContainer: { flex:1, alignItems:'center', justifyContent:'center', padding:40, backgroundColor:COLORS.bg },
  successTitle: { fontSize:22, fontWeight:'800', color:COLORS.primary, marginTop:12 },
  successId: { fontSize:16, fontWeight:'600', color:COLORS.dark, marginTop:6 },
  successText: { fontSize:14, color:COLORS.gray, marginTop:8, textAlign:'center' },
});
