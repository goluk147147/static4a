import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import StoreHeader from '../../src/components/StoreHeader';
import { Button, Card, EmptyState, Field, OrdersSkeleton, Screen, StatusChip, styles as ui } from '../../src/components/ui';
import { useAuth, isOrderStaff } from '../../src/store/auth';
import { useAllOrders } from '../../src/queries';
import { getPushPermission, registerForPush } from '../../src/push';
import { formatDate } from '../../src/checkout';
import { colors } from '../../src/theme';

/** Staff Orders screen: new/pending orders highlighted on top, who ordered & from where, tap for detail. */
export default function AdminOrders() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user, ready } = useAuth();
  const staff = isOrderStaff(user);
  const { data: orders = [], isLoading } = useAllOrders(staff, 7000);
  const [search, setSearch] = useState('');
  const [push, setPush] = useState('');
  // Follow-up filter: show only the 'Pending Payment' leads (paid-but-unconfirmed / abandoned).
  const [pendingOnly, setPendingOnly] = useState(false);

  useEffect(() => {
    if (ready && !staff) router.replace({ pathname: '/login', params: { next: '/admin/orders' } } as never);
  }, [ready, staff]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    getPushPermission().then(setPush).catch(() => null);
  }, []);

  // 'Pending Payment' leads are the paid-but-unconfirmed / abandoned follow-ups the owner must work.
  const pending = orders.filter((o) => o.order_status === 'Pending Payment');
  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    const base = pendingOnly ? orders.filter((o) => o.order_status === 'Pending Payment') : orders;
    return q ? base.filter((o) => (o.customer?.name || '').toLowerCase().includes(q) || o.order_id.toLowerCase().includes(q) || (o.customer?.mobile || '').includes(q)) : base;
  }, [orders, q, pendingOnly]);

  if (!staff) return <Screen header={<StoreHeader back title="Orders" />}><OrdersSkeleton /></Screen>;

  return (
    <Screen header={<StoreHeader back title="🛒 Orders (Staff)" />} refreshing={isLoading} onRefresh={() => qc.invalidateQueries({ queryKey: ['all-orders'] })}>
      {push !== 'granted' && (
        <Card style={{ marginBottom: 12, borderColor: colors.primary, borderWidth: 1 }}>
          <Text style={{ color: colors.dark, marginBottom: 8 }}>🔔 Naye order ka turant alert paane ke liye notifications ON karein.</Text>
          <Button title="Enable order notifications" onPress={async () => { await registerForPush(); setPush(await getPushPermission()); }} />
        </Card>
      )}

      {pending.length > 0 && (
        <Pressable onPress={() => setPendingOnly((v) => !v)} accessibilityRole="button">
          <View style={{ backgroundColor: pendingOnly ? '#ffe8c2' : '#fff3cd', borderRadius: 10, borderLeftWidth: 5, borderLeftColor: '#e0a800', padding: 12, marginBottom: 12 }}>
            <Text style={{ fontWeight: '800', color: '#664d03' }}>⏳ {pending.length} payment-pending lead{pending.length === 1 ? '' : 's'} — follow up karein {pendingOnly ? '(sab dekhein ↺)' : '(sirf ye dekhein →)'}</Text>
          </View>
        </Pressable>
      )}

      <Field label="" placeholder="🔎 Search name, mobile or Order ID" value={search} onChangeText={setSearch} autoCapitalize="none" />

      {isLoading && !orders.length ? (
        <OrdersSkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState icon="📋" title={q ? 'No matching orders' : 'No orders yet'} />
      ) : (
        filtered.map((o) => {
          // Flag the unpaid 'Pending Payment' lead as the one needing follow-up (🆕), the real
          // paid-but-unconfirmed order the owner would otherwise lose.
          const isNew = o.order_status === 'Pending Payment';
          return (
            <Pressable key={o.order_id} onPress={() => router.push(`/admin/order/${o.order_id}`)} accessibilityRole="button" accessibilityLabel={`Order ${o.order_id} from ${o.customer?.name}`}>
              <Card style={[{ marginBottom: 10 }, isNew && { borderColor: '#e0a800', borderWidth: 1.5 }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontWeight: '800', color: colors.primaryDark }}>#{o.order_id}{isNew ? '  🆕' : ''}</Text>
                  <StatusChip status={o.order_status} />
                </View>
                <Text style={{ color: colors.dark, fontWeight: '700', marginTop: 4 }}>{o.customer?.name} · {o.customer?.mobile}</Text>
                <Text style={ui.muted}>📍 {[o.customer?.address, o.customer?.city].filter(Boolean).join(', ')} – {o.customer?.pincode}</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                  <Text style={ui.muted}>{o.items.length} item · {formatDate(o.order_date)}</Text>
                  <Text style={{ fontWeight: '800', color: colors.dark }}>₹{o.total_amount}</Text>
                </View>
              </Card>
            </Pressable>
          );
        })
      )}
    </Screen>
  );
}
