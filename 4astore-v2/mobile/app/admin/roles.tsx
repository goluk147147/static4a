import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import StoreHeader from '../../src/components/StoreHeader';
import { Button, Card, Field, GradientButton, Screen, styles as ui } from '../../src/components/ui';
import { useAuth, isOwner } from '../../src/store/auth';
import { api, apiError } from '../../src/api';
import { showToast } from '../../src/store/ui';
import { colors, radius } from '../../src/theme';

const PERMISSIONS: [string, string][] = [
  ['dashboard', 'Dashboard'], ['orders', 'Orders'], ['products', 'Products'], ['categories', 'Categories'],
  ['banners', 'Banners'], ['ads', 'Ads & Social'], ['riderTracking', 'Rider Tracking'], ['users', 'Users'],
  ['earnings', 'Earnings'], ['settings', 'Settings'], ['team', 'Team Access'],
];

/**
 * Owner/superadmin: give any registered user a role by MOBILE NUMBER. Assign `admin` (with the
 * `orders` permission) so they receive new-order push + can open order details, or rider/customer.
 */
export default function Roles() {
  const router = useRouter();
  const { user, ready } = useAuth();
  const owner = isOwner(user);
  const [mobile, setMobile] = useState('');
  const [role, setRole] = useState<'admin' | 'rider' | 'customer'>('admin');
  const [perms, setPerms] = useState<Set<string>>(new Set(['orders', 'dashboard']));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && !owner) router.replace('/login');
  }, [ready, owner]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (p: string) => setPerms((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });

  async function assign() {
    if (!/^[6-9]\d{9}$/.test(mobile)) return showToast('Valid 10-digit mobile number daalein.', 'error');
    if (role === 'admin' && perms.size === 0) return showToast('Admin ke liye kam se kam ek permission chunein.', 'error');
    setBusy(true);
    try {
      const d = await api.post('/admin/assignRole', { mobile, role, permissions: role === 'admin' ? [...perms] : [] });
      showToast(d.message || `Role '${role}' assigned to ${mobile}`, 'success');
      setMobile('');
    } catch (e) {
      showToast(apiError(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!owner) return null;

  return (
    <Screen header={<StoreHeader back title="👥 Role by Mobile" />}>
      <Card>
        <Text style={ui.h3}>Assign role by mobile number</Text>
        <Text style={[ui.muted, { marginVertical: 8 }]}>
          Mobile number daalkar role dein. `admin` + Orders permission wale user ko naya order aate hi push alert milega aur wo order ki detail (kisne, kahan se) dekh sakta hai.
        </Text>
        <Field label="Mobile number" value={mobile} onChangeText={(t) => setMobile(t.replace(/\D/g, ''))} keyboardType="phone-pad" maxLength={10} placeholder="10-digit registered mobile" />

        <Text style={[ui.label, { marginTop: 4 }]}>Role</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
          {(['admin', 'rider', 'customer'] as const).map((r) => (
            <Button key={r} small outline={role !== r} title={r} onPress={() => setRole(r)} style={{ flex: 1 }} />
          ))}
        </View>

        {role === 'admin' && (
          <>
            <Text style={ui.label}>Permissions</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
              {PERMISSIONS.map(([key, label]) => {
                const on = perms.has(key);
                return (
                  <Pressable key={key} onPress={() => toggle(key)} style={[st.perm, on && { backgroundColor: colors.primary, borderColor: colors.primary }]} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                    <Text style={{ color: on ? '#fff' : colors.dark, fontSize: 12, fontWeight: '700' }}>{on ? '✓ ' : ''}{label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[ui.muted, { marginTop: 8, fontSize: 12 }]}>Tip: "Orders" permission zaroori hai naye order ke push alert ke liye.</Text>
          </>
        )}

        <GradientButton title={busy ? 'Saving…' : `Assign '${role}' role`} loading={busy} onPress={assign} style={{ marginTop: 16 }} />
      </Card>
    </Screen>
  );
}

const st = { perm: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.border, backgroundColor: '#fff' } } as const;
