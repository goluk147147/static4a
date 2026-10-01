import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import StoreHeader from '../../src/components/StoreHeader';
import { Button, Card, EmptyState, Field, GradientButton, Screen, styles as ui } from '../../src/components/ui';
import { useAuth, isOrderStaff, isOwner, isRider, STAFF_ROLES } from '../../src/store/auth';
import { useCart, useCartCount } from '../../src/store/cart';
import { useMyOrders, usePages } from '../../src/queries';
import { api, apiError, setAccessToken, clearRefreshToken } from '../../src/api';
import { showConfirm, showToast } from '../../src/store/ui';
import { appVersion } from '../../src/native';
import { getPushPermission, registerForPush } from '../../src/push';
import { colors, radius, warmGradient } from '../../src/theme';

export default function Profile() {
  const router = useRouter();
  const { user, logout, setUser } = useAuth();
  const cartCount = useCartCount();
  const clearCart = useCart((s) => s.clear);
  const { data: orders = [] } = useMyOrders(user?.mobile);
  const pages = (usePages().data ?? []).filter((p) => p.showInFooter);

  const [email, setEmail] = useState('');
  const [verified, setVerified] = useState(false);
  const [code, setCode] = useState('');
  const [pending, setPending] = useState('');
  const [status, setStatus] = useState({ text: '', color: colors.gray });
  const [pushStatus, setPushStatus] = useState<string>('');

  async function loadRecovery() {
    try {
      const d = await api.get('/users/recovery-email');
      setEmail(d.email || '');
      setVerified(!!d.verified);
      setStatus(d.verified ? { text: '✅ Current recovery email verified. A new email replaces it only after OTP verification.', color: colors.green } : { text: 'No verified recovery email yet.', color: colors.gray });
    } catch {
      setStatus({ text: 'Could not load recovery email status.', color: colors.gray });
    }
  }
  useEffect(() => {
    if (user) {
      void loadRecovery();
      getPushPermission().then(setPushStatus).catch(() => null);
    }
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) {
    return (
      <Screen header={<StoreHeader title="👤 Profile" />}>
        <EmptyState icon="👤" title="Welcome to 4A Store" text="Login karke orders, cart aur address manage karein." action={<GradientButton title="Login / Sign Up" onPress={() => router.push('/login')} />} />
        <LegalLinks pages={pages} />
      </Screen>
    );
  }

  async function sendCode() {
    const clean = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return setStatus({ text: 'Enter a valid email address.', color: '#b42318' });
    setStatus({ text: 'Sending verification code...', color: colors.gray });
    try {
      const d = await api.post('/users/recovery-email/send', { email: clean });
      if (d.alreadyVerified) return setStatus({ text: '✅ This recovery email is already verified.', color: colors.green });
      setPending(clean);
      if (d.devOtp) setCode(String(d.devOtp));
      setStatus({ text: 'Code sent. Check your inbox and spam folder.', color: colors.green });
    } catch (e) {
      setStatus({ text: apiError(e), color: '#b42318' });
    }
  }
  async function verify() {
    const clean = email.trim().toLowerCase();
    if (!pending || clean !== pending) return setStatus({ text: 'Email changed. Send a new verification code.', color: '#b42318' });
    try {
      await api.post('/users/recovery-email/verify', { email: clean, otp: code.trim() });
      setPending('');
      setCode('');
      setStatus({ text: '✅ Recovery email verified and saved.', color: colors.green });
      await loadRecovery();
    } catch (e) {
      setStatus({ text: apiError(e), color: '#b42318' });
    }
  }
  async function doLogout() {
    if (!(await showConfirm('Are you sure you want to logout?', { title: 'Log out?', confirmText: 'Log out' }))) return;
    await logout();
    showToast('Logged out successfully', 'info');
    router.replace('/');
  }
  async function deleteAccount() {
    const ok = await showConfirm('Your account details will be removed. Existing order records may be retained for legal and store records.', { title: 'Delete your account?', confirmText: 'Delete account', danger: true });
    if (!ok) return;
    try {
      await api.post('/users/deleteSelf');
      clearCart();
      await clearRefreshToken();
      setAccessToken(null);
      setUser(null);
      showToast('Your account has been deleted.', 'success');
      router.replace('/');
    } catch (e) {
      showToast(apiError(e) || 'Unable to delete account. Please contact support.', 'error');
    }
  }

  const totalSpent = orders.reduce((s, o) => s + o.total_amount, 0);
  const memberSince = user.registered_at ? new Date(user.registered_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
  const v = appVersion();

  const Action = ({ label, right, onPress, bg = '#fff', fg = colors.dark }: { label: string; right?: string; onPress: () => void; bg?: string; fg?: string }) => (
    <Pressable onPress={onPress} style={[s.action, { backgroundColor: bg }]} accessibilityRole="button">
      <Text style={{ color: fg, fontWeight: '700', fontSize: 15 }}>{label}</Text>
      {!!right && <Text style={{ color: fg, fontSize: 12, marginLeft: 'auto' }}>{right}</Text>}
    </Pressable>
  );

  return (
    <Screen header={<StoreHeader title="👤 My Profile" />}>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <LinearGradient colors={warmGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.head}>
          <View style={s.avatar}><Text style={{ fontSize: 34 }}>👤</Text></View>
          <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800' }}>{user.name}</Text>
          <Text style={{ color: '#fff', opacity: 0.9 }}>@{user.username || user.mobile} · {user.role}</Text>
        </LinearGradient>
        <View style={{ padding: 14 }}>
          <View style={s.stats}>
            <Stat n={String(orders.length)} l="Orders" />
            <Stat n={`₹${totalSpent}`} l="Total Spent" />
            <Stat n={String(cartCount)} l="In Cart" />
          </View>
          <Info l="👤 Name" v={user.name} />
          <Info l="📱 Mobile" v={user.mobile} />
          <Info l="🆔 Username" v={user.username || '-'} />
          <Info l="📅 Member Since" v={memberSince} />
        </View>
      </Card>

      {/* Staff / rider entry points */}
      {(isOrderStaff(user) || STAFF_ROLES.includes(user.role)) && (
        <Card style={{ marginTop: 14, gap: 8 }}>
          <Text style={ui.h3}>🔐 Admin / Staff</Text>
          {isOrderStaff(user) && <Action label="🛒 Orders & new-order alerts" right="→" bg={colors.admin} fg="#fff" onPress={() => router.push('/admin/orders')} />}
          {isOwner(user) && <Action label="👥 Role by mobile number" right="→" bg="#6d28d9" fg="#fff" onPress={() => router.push('/admin/roles')} />}
          <Text style={ui.muted}>
            Push notifications: {pushStatus === 'granted' ? '✅ ON' : '❌ OFF'} — naya order aate hi alert aayega.
          </Text>
          {pushStatus !== 'granted' && (
            <Button title="🔔 Enable order notifications" onPress={async () => { await registerForPush(); setPushStatus(await getPushPermission()); }} />
          )}
        </Card>
      )}
      {isRider(user) && (
        <View style={{ marginTop: 14 }}>
          <Action label="🛵 Rider Console" right="→" bg={colors.track} fg="#fff" onPress={() => router.push('/rider')} />
        </View>
      )}

      <Card style={{ marginTop: 14 }}>
        <Text style={ui.h3}>Password recovery email</Text>
        <Text style={[ui.muted, { marginBottom: 10 }]}>Verify an email address to receive password reset codes.</Text>
        <Field label="Email address" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="you@example.com" />
        <Button title={verified ? 'Update recovery email' : 'Send verification code'} onPress={sendCode} />
        {!!status.text && <Text style={{ color: status.color, fontSize: 12, marginTop: 8 }}>{status.text}</Text>}
        {!!pending && (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <Field label="6-digit email code" value={code} onChangeText={(t) => setCode(t.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={6} placeholder="000000" />
            </View>
            <Button title="Verify" color={colors.green} onPress={verify} style={{ marginBottom: 12 }} />
          </View>
        )}
      </Card>

      <View style={{ marginTop: 14, gap: 8 }}>
        <Action label="📦 My Orders" right={`${orders.length} orders →`} onPress={() => router.push('/orders')} />
        <Action label="🛒 My Cart" right={`${cartCount} items →`} onPress={() => router.push('/cart')} />
        <Action label="🏠 Delivery Address" right="→" onPress={() => router.push('/checkout')} />
        <Action label="📍 Track Order" right="→" onPress={() => router.push('/track')} />
        <Action label="🚪 Logout" onPress={doLogout} bg={colors.primaryLight} fg={colors.primaryDark} />
        <Action label="🗑️ Delete my account" onPress={deleteAccount} bg="#fdecea" fg="#c62828" />
      </View>
      <LegalLinks pages={pages} />
      <Text style={[ui.muted, { textAlign: 'center', marginTop: 16, fontSize: 11 }]}>4A Store app v{v.versionName} ({v.versionCode})</Text>
    </Screen>
  );
}

function LegalLinks({ pages }: { pages: { slug: string; title: string }[] }) {
  const router = useRouter();
  const list = pages.length ? pages : [
    { slug: 'help-support', title: 'Help & Support' },
    { slug: 'privacy-policy', title: 'Privacy Policy' },
    { slug: 'terms', title: 'Terms & Conditions' },
    { slug: 'account-deletion', title: 'Account Deletion' },
  ];
  return (
    <Card style={{ marginTop: 14 }}>
      <Text style={[ui.h3, { marginBottom: 6 }]}>Help & Legal</Text>
      {list.map((p) => (
        <Pressable key={p.slug} onPress={() => router.push(`/page/${p.slug}`)} style={s.legal} accessibilityRole="link">
          <Text style={{ color: colors.dark }}>{p.title}</Text>
          <Text style={{ color: colors.gray }}>›</Text>
        </Pressable>
      ))}
    </Card>
  );
}

const Stat = ({ n, l }: { n: string; l: string }) => (
  <View style={{ flex: 1, alignItems: 'center' }}>
    <Text style={{ fontSize: 18, fontWeight: '800', color: colors.primaryDark }}>{n}</Text>
    <Text style={ui.muted}>{l}</Text>
  </View>
);
const Info = ({ l, v }: { l: string; v: string }) => (
  <View style={s.info}>
    <Text style={ui.muted}>{l}</Text>
    <Text style={{ color: colors.dark, fontWeight: '700' }}>{v}</Text>
  </View>
);

const s = StyleSheet.create({
  head: { alignItems: 'center', padding: 20 },
  avatar: { width: 70, height: 70, borderRadius: 35, backgroundColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  stats: { flexDirection: 'row', marginBottom: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  info: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f6eadb' },
  action: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: radius.md, minHeight: 50, borderWidth: 1, borderColor: colors.border },
  legal: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#f6eadb' },
});
