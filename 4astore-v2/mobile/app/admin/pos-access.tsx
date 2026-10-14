import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import StoreHeader from '../../src/components/StoreHeader';
import { Button, Card, Field, GradientButton, Screen, styles as ui } from '../../src/components/ui';
import { useAuth, isOwner } from '../../src/store/auth';
import { apiError } from '../../src/api';
import { showToast } from '../../src/store/ui';
import { formatDate } from '../../src/checkout';
import { colors, radius } from '../../src/theme';
import { usePosPhones, useRemovePhone, useUpsertPhone } from '../../src/pos';

// POS/inventory permission keys (keep in sync with ALLOWED_PERMS in routes/admin-pos.ts).
const PERMISSIONS: [string, string][] = [
  ['pos', 'Billing / POS'],
  ['inventory', 'Inventory & Excel'],
  ['pos_reports', 'Sales Reports'],
  ['orders', 'Online Orders'],
];

/**
 * POS Access (design §1, owner-only) — manage the mobile-number allowlist that
 * governs who can obtain a staff JWT. Removal revokes server-side (demote +
 * refresh-token revoke), so this is real access control, not a frontend hide.
 */
export default function AdminPosAccess() {
  const router = useRouter();
  const { user, ready } = useAuth();
  const owner = isOwner(user);

  const { data: phones = [], isLoading } = usePosPhones();
  const upsert = useUpsertPhone();
  const remove = useRemovePhone();

  const [mobile, setMobile] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'owner' | 'staff'>('staff');
  const [perms, setPerms] = useState<Set<string>>(new Set(['pos']));

  useEffect(() => {
    if (ready && !owner) router.replace('/login');
  }, [ready, owner]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (p: string) => setPerms((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });

  async function add() {
    if (!/^[6-9]\d{9}$/.test(mobile)) return showToast('Enter a valid 10-digit mobile number.', 'error');
    if (role === 'staff' && perms.size === 0) return showToast('Select at least one permission for staff.', 'error');
    try {
      const r = await upsert.mutateAsync({ mobile, role, permissions: role === 'staff' ? [...perms] : undefined, name: name.trim() || undefined });
      showToast(r.message, 'success');
      setMobile('');
      setName('');
    } catch (e) {
      showToast(apiError(e), 'error');
    }
  }

  function revoke(m: string) {
    Alert.alert('Revoke access?', `${m} will be signed out and demoted to customer.`, [
      { text: 'No', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: async () => {
          try {
            const r = await remove.mutateAsync(m);
            showToast(r.message, 'success');
          } catch (e) {
            showToast(apiError(e), 'error');
          }
        },
      },
    ]);
  }

  if (!owner) return null;

  return (
    <Screen header={<StoreHeader back title="🔑 POS Access" />}>
      <Card>
        <Text style={ui.h3}>Authorise a mobile number</Text>
        <Field label="Mobile number" value={mobile} onChangeText={(t) => setMobile(t.replace(/\D/g, ''))} keyboardType="phone-pad" maxLength={10} placeholder="10-digit mobile" />
        <Field label="Name (optional)" value={name} onChangeText={setName} />

        <Text style={ui.label}>Role</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
          {(['staff', 'owner'] as const).map((r) => (
            <Button key={r} small outline={role !== r} title={r === 'owner' ? '👑 Owner' : '👤 Staff'} onPress={() => setRole(r)} style={{ flex: 1 }} />
          ))}
        </View>

        {role === 'staff' ? (
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
          </>
        ) : (
          <Text style={[ui.muted, { marginBottom: 4 }]}>Owner numbers get full access to every section.</Text>
        )}

        <GradientButton title={upsert.isPending ? 'Saving…' : 'Authorise number'} loading={upsert.isPending} onPress={add} style={{ marginTop: 16 }} />
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Text style={ui.h3}>Authorised numbers</Text>
        {isLoading ? (
          <Text style={[ui.muted, { marginTop: 8 }]}>Loading…</Text>
        ) : phones.length === 0 ? (
          <Text style={[ui.muted, { marginTop: 8 }]}>No numbers authorised yet.</Text>
        ) : (
          phones.map((p) => (
            <View key={p.id} style={[st.phoneRow, !p.active && { opacity: 0.5 }]}>
              <View style={{ flex: 1 }}>
                <Text style={ui.bodyStrong}>{p.mobile} · {p.role}</Text>
                <Text style={ui.muted}>{p.name ? `${p.name} · ` : ''}{p.role === 'owner' ? 'All permissions' : p.permissions.join(', ') || '—'}</Text>
                <Text style={ui.muted}>{formatDate(p.created_at)}</Text>
              </View>
              {p.active && <Button small outline color="#c62828" title="Revoke" onPress={() => revoke(p.mobile)} />}
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}

const st = {
  perm: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.border, backgroundColor: '#fff' },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f3ece0' },
} as const;
