import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Logo from './Logo';
import Icon from './Icon';
import { colors, topBarGradient, warmGradient } from '../theme';
import { useAuth } from '../store/auth';
import { useCartCount } from '../store/cart';

/**
 * Storefront chrome (web Layout.tsx): gradient top bar, logo, login/orders/cart actions and the
 * search box. `back` shows a back arrow for pushed screens.
 */
export default function StoreHeader({ back, title, hideSearch }: { back?: boolean; title?: string; hideSearch?: boolean }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const count = useCartCount();
  const [q, setQ] = useState('');

  const submit = () => router.push({ pathname: '/products', params: { search: q.trim() } } as never);

  return (
    <View style={{ backgroundColor: colors.glass }}>
      <LinearGradient colors={topBarGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ paddingTop: insets.top }}>
        <Text style={styles.topBar} numberOfLines={1}>📍 Delivering in Chandargarh – 824301 | ☎️ 7543888698</Text>
      </LinearGradient>

      <View style={styles.row}>
        {back && (
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={styles.back} accessibilityRole="button" accessibilityLabel="Back / पीछे" hitSlop={8}>
            <Icon name="back" size="lg" color={colors.dark} />
          </Pressable>
        )}
        <Pressable onPress={() => router.push('/')} accessibilityRole="link" accessibilityLabel="4A Store home">
          <Logo height={40} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => router.push(user ? '/profile' : '/login')}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel={user ? `Profile ${user.name}` : 'Login'}
        >
          {user ? (
            <View style={styles.avatar}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>{user.name.charAt(0).toUpperCase()}</Text></View>
          ) : (
            <Icon name="profile" size="lg" />
          )}
        </Pressable>
        <Pressable onPress={() => router.push('/orders')} style={styles.action} accessibilityRole="button" accessibilityLabel="Orders / ऑर्डर">
          <Icon name="orders" size="lg" />
        </Pressable>
        <Pressable onPress={() => router.push('/cart')} style={styles.action} accessibilityRole="button" accessibilityLabel={`Cart, ${count} items / कार्ट`}>
          <Icon name="cart" size="lg" />
          {count > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{count}</Text></View>}
        </Pressable>
      </View>

      {title ? (
        <Text style={styles.title} accessibilityRole="header">{title}</Text>
      ) : !hideSearch ? (
        <View style={styles.searchWrap}>
          <TextInput
            value={q}
            onChangeText={setQ}
            onSubmitEditing={submit}
            placeholder="Search for groceries, fruits, snacks..."
            placeholderTextColor="#a3928a"
            returnKeyType="search"
            style={styles.search}
            accessibilityLabel="Search products"
          />
          <Pressable onPress={submit} style={styles.searchBtn} accessibilityRole="button" accessibilityLabel="Search">
            <LinearGradient colors={warmGradient} style={styles.searchGrad}>
              <Icon name="search" size="sm" />
            </LinearGradient>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { color: '#fff', fontSize: 11.5, fontWeight: '700', textAlign: 'center', paddingVertical: 6, paddingHorizontal: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, gap: 2 },
  back: { paddingRight: 8, paddingVertical: 4 },
  action: { padding: 8, minWidth: 40, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  avatar: { backgroundColor: colors.primary, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 0, right: 0, backgroundColor: colors.accent, minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  searchWrap: { marginHorizontal: 12, marginBottom: 10, justifyContent: 'center' },
  search: { borderWidth: 2, borderColor: colors.border, borderRadius: 30, paddingLeft: 16, paddingRight: 48, height: 44, backgroundColor: 'rgba(255,255,255,0.9)', fontSize: 14, color: colors.dark },
  searchBtn: { position: 'absolute', right: 4, width: 36, height: 36, borderRadius: 18, overflow: 'hidden' },
  searchGrad: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '800', color: colors.primaryDark, paddingHorizontal: 14, paddingBottom: 10 },
});
