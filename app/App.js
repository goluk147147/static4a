import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import HomeScreen from './src/screens/HomeScreen';
import ProductsScreen from './src/screens/ProductsScreen';
import ProductDetailScreen from './src/screens/ProductDetailScreen';
import CartScreen from './src/screens/CartScreen';
import CheckoutScreen from './src/screens/CheckoutScreen';
import OrdersScreen from './src/screens/OrdersScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import LoginScreen from './src/screens/LoginScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const COLORS = { primary: '#ff6600', primaryDark: '#e55b00' };

function TabIcon({ icon, label, focused }) {
  return (
    <View style={{ alignItems:'center', paddingTop:4 }}>
      <Text style={{ fontSize:20 }}>{icon}</Text>
      <Text style={{ fontSize:10, fontWeight:focused?'700':'500', color:focused?COLORS.primary:'#999', marginTop:2 }}>{label}</Text>
    </View>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown:false, tabBarShowLabel:false, tabBarStyle:{ height:60, borderTopWidth:0.5, borderTopColor:'#eee' }}}>
      <Tab.Screen name="Home" component={HomeScreen} options={{ tabBarIcon:({focused})=><TabIcon icon="🏠" label="Home" focused={focused}/> }} />
      <Tab.Screen name="Products" component={ProductsScreen} options={{ tabBarIcon:({focused})=><TabIcon icon="📂" label="Categories" focused={focused}/> }} />
      <Tab.Screen name="Cart" component={CartScreen} options={{ tabBarIcon:({focused})=><TabIcon icon="🛒" label="Cart" focused={focused}/> }} />
      <Tab.Screen name="Orders" component={OrdersScreen} options={{ tabBarIcon:({focused})=><TabIcon icon="📦" label="Orders" focused={focused}/> }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ tabBarIcon:({focused})=><TabIcon icon="👤" label="Profile" focused={focused}/> }} />
    </Tab.Navigator>
  );
}

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(null);

  useEffect(() => {
    AsyncStorage.getItem('4astore_user').then(data => {
      setIsLoggedIn(!!data);
    });
  }, []);

  if (isLoggedIn === null) {
    return <View style={{flex:1,backgroundColor:'#ff6600',alignItems:'center',justifyContent:'center'}}><Text style={{color:'#fff',fontSize:28,fontWeight:'800'}}>4astore</Text></View>;
  }

  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Stack.Navigator screenOptions={{ headerStyle:{backgroundColor:'#fff'}, headerTintColor:COLORS.primary, headerTitleStyle:{fontWeight:'700'} }}>
        {!isLoggedIn && <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown:false }} />}
        <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown:false }} />
        <Stack.Screen name="ProductDetail" component={ProductDetailScreen} options={{ title:'Product Details' }} />
        <Stack.Screen name="Checkout" component={CheckoutScreen} options={{ title:'Checkout' }} />
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown:false }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
