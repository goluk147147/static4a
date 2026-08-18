import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, ScrollView, StyleSheet } from 'react-native';
import { COLORS } from '../config';
import { getUsers, saveUsers, saveUser } from '../utils/storage';

export default function LoginScreen({ navigation }) {
  const [tab, setTab] = useState('login');
  const [loginId, setLoginId] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [signName, setSignName] = useState('');
  const [signMobile, setSignMobile] = useState('');
  const [signUser, setSignUser] = useState('');
  const [signPass, setSignPass] = useState('');
  const [signConfirm, setSignConfirm] = useState('');

  const handleLogin = async () => {
    if (!loginId || !loginPass) return Alert.alert('Error', 'Enter username and password');
    const users = await getUsers();
    const user = users.find(u => (u.username === loginId || u.mobile === loginId) && u.password === loginPass);
    if (!user) return Alert.alert('Error', 'Invalid credentials');
    await saveUser({ name: user.name, mobile: user.mobile, username: user.username });
    navigation.replace('MainTabs');
  };

  const handleSignup = async () => {
    if (!signName) return Alert.alert('Error', 'Enter name');
    if (!/^[6-9]\d{9}$/.test(signMobile)) return Alert.alert('Error', 'Enter valid 10-digit mobile');
    if (!signUser || signUser.length < 3) return Alert.alert('Error', 'Username min 3 chars');
    if (!signPass || signPass.length < 4) return Alert.alert('Error', 'Password min 4 chars');
    if (signPass !== signConfirm) return Alert.alert('Error', 'Passwords don\'t match');

    let users = await getUsers();
    if (users.find(u => u.username === signUser)) return Alert.alert('Error', 'Username taken');
    if (users.find(u => u.mobile === signMobile)) return Alert.alert('Error', 'Mobile already registered');

    const newUser = { name:signName, mobile:signMobile, username:signUser, password:signPass, registeredAt: new Date().toISOString() };
    users.push(newUser);
    await saveUsers(users);
    await saveUser({ name:signName, mobile:signMobile, username:signUser });
    Alert.alert('🎉 Welcome!', 'Account created successfully');
    navigation.replace('MainTabs');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.logo}>4a<Text style={{color:COLORS.secondary}}>store</Text></Text>
      <Text style={styles.subtitle}>Login or Sign Up to continue</Text>

      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, tab==='login'&&styles.tabActive]} onPress={()=>setTab('login')}><Text style={[styles.tabText, tab==='login'&&styles.tabTextActive]}>Login</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab==='signup'&&styles.tabActive]} onPress={()=>setTab('signup')}><Text style={[styles.tabText, tab==='signup'&&styles.tabTextActive]}>Sign Up</Text></TouchableOpacity>
      </View>

      {tab === 'login' ? (
        <View>
          <TextInput style={styles.input} placeholder="Username or Mobile" value={loginId} onChangeText={setLoginId} autoCapitalize="none" />
          <TextInput style={styles.input} placeholder="Password" value={loginPass} onChangeText={setLoginPass} secureTextEntry />
          <TouchableOpacity style={styles.btn} onPress={handleLogin}><Text style={styles.btnText}>🔓 Login</Text></TouchableOpacity>
        </View>
      ) : (
        <View>
          <TextInput style={styles.input} placeholder="Full Name" value={signName} onChangeText={setSignName} />
          <TextInput style={styles.input} placeholder="Mobile (10 digits)" value={signMobile} onChangeText={setSignMobile} keyboardType="phone-pad" maxLength={10} />
          <TextInput style={styles.input} placeholder="Choose Username" value={signUser} onChangeText={setSignUser} autoCapitalize="none" />
          <TextInput style={styles.input} placeholder="Password (min 4)" value={signPass} onChangeText={setSignPass} secureTextEntry />
          <TextInput style={styles.input} placeholder="Confirm Password" value={signConfirm} onChangeText={setSignConfirm} secureTextEntry />
          <TouchableOpacity style={styles.btn} onPress={handleSignup}><Text style={styles.btnText}>📝 Create Account</Text></TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex:1, backgroundColor:COLORS.bg },
  content: { padding:24, paddingTop:60 },
  logo: { fontSize:32, fontWeight:'800', color:COLORS.primary, textAlign:'center' },
  subtitle: { textAlign:'center', color:COLORS.gray, fontSize:14, marginTop:6, marginBottom:24 },
  tabs: { flexDirection:'row', borderRadius:10, borderWidth:2, borderColor:COLORS.primary, overflow:'hidden', marginBottom:20 },
  tab: { flex:1, paddingVertical:12, alignItems:'center', backgroundColor:'#fff' },
  tabActive: { backgroundColor:COLORS.primary },
  tabText: { fontWeight:'700', color:COLORS.primary },
  tabTextActive: { color:'#fff' },
  input: { backgroundColor:'#fff', borderRadius:10, paddingHorizontal:14, paddingVertical:12, fontSize:14, borderWidth:1.5, borderColor:COLORS.border, marginBottom:10 },
  btn: { backgroundColor:COLORS.primary, borderRadius:10, paddingVertical:14, alignItems:'center', marginTop:10 },
  btnText: { color:'#fff', fontSize:15, fontWeight:'700' },
});
