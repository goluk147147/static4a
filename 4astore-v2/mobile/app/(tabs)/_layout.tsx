import React from 'react';
import { Text, View } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../src/theme';
import { useCartCount } from '../../src/store/cart';

function Icon({ emoji, badge }: { emoji: string; badge?: number }) {
  return (
    <View>
      <Text style={{ fontSize: 20 }}>{emoji}</Text>
      {!!badge && (
        <View style={{ position: 'absolute', top: -4, right: -10, backgroundColor: colors.accent, minWidth: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{badge}</Text>
        </View>
      )}
    </View>
  );
}

/** Bottom nav — same 5 items as the web mobile bottom-nav. */
export default function TabsLayout() {
  const count = useCartCount();
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.gray,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarStyle: { height: 58 + insets.bottom, paddingBottom: 6 + insets.bottom, paddingTop: 6, backgroundColor: '#fff' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: () => <Icon emoji="🏠" /> }} />
      <Tabs.Screen name="products" options={{ title: 'Categories', tabBarIcon: () => <Icon emoji="📂" /> }} />
      <Tabs.Screen name="cart" options={{ title: 'Cart', tabBarIcon: () => <Icon emoji="🛒" badge={count} /> }} />
      <Tabs.Screen name="orders" options={{ title: 'Orders', tabBarIcon: () => <Icon emoji="📦" /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: () => <Icon emoji="👤" /> }} />
    </Tabs>
  );
}
