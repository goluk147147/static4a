import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import StoreHeader from '../../src/components/StoreHeader';
import { Card, EmptyState, Field, OrdersSkeleton, Screen, styles as ui } from '../../src/components/ui';
import { useAuth, canAdmin } from '../../src/store/auth';
import { formatDate } from '../../src/checkout';
import { colors } from '../../src/theme';
import { POS_BILLS_KEY, usePosBills } from '../../src/pos';

const money = (n: number) => `₹${Number(n).toFixed(2)}`;
const STATUS_COLOR: Record<string, string> = { completed: '#087a3d', held: '#b96500', cancelled: '#c62828', refunded: '#6d28d9' };

/** Billing history (design §7) — searchable list; tap a bill to view / share, or
 *  tap a held bill to reopen it in the POS screen. */
export default function AdminPosHistory() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user, ready } = useAuth();
  const allowed = canAdmin(user, 'pos');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (ready && !allowed) router.replace({ pathname: '/login', params: { next: '/admin/pos-history' } } as never);
  }, [ready, allowed]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = search.trim();
  const filters = /^\d{10}$/.test(q) ? { mobile: q } : q ? { billNo: q } : {};
  const { data, isLoading } = usePosBills(filters, 30);
  const bills = data?.bills ?? [];

  if (!allowed) return <Screen header={<StoreHeader back title="Billing History" />}><OrdersSkeleton /></Screen>;

  return (
    <Screen
      header={<StoreHeader back title="📚 Billing History" />}
      refreshing={isLoading}
      onRefresh={() => qc.invalidateQueries({ queryKey: POS_BILLS_KEY })}
    >
      <Field label="" placeholder="🔎 Bill no (INV-…) or 10-digit mobile" value={search} onChangeText={setSearch} autoCapitalize="characters" />

      {isLoading && !bills.length ? (
        <OrdersSkeleton />
      ) : bills.length === 0 ? (
        <EmptyState icon="🧾" title={q ? 'No matching bills' : 'No bills yet'} />
      ) : (
        bills.map((b) => (
          <Pressable
            key={b.id}
            onPress={() => (b.status === 'held' ? router.push(`/admin/pos?reopen=${b.id}`) : router.push(`/admin/pos-bill/${b.bill_no}`))}
            accessibilityRole="button"
          >
            <Card style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontWeight: '800', color: colors.primaryDark }}>{b.bill_no || `Held #${b.id}`}</Text>
                <View style={{ backgroundColor: `${STATUS_COLOR[b.status] || '#999'}22`, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 }}>
                  <Text style={{ color: STATUS_COLOR[b.status] || '#555', fontSize: 12, fontWeight: '700' }}>{b.status}</Text>
                </View>
              </View>
              <Text style={[ui.muted, { marginTop: 4 }]}>{b.customer_name || 'Walk-in'}{b.customer_mobile ? ` · ${b.customer_mobile}` : ''}</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                <Text style={ui.muted}>{b.items.length} item · {formatDate(b.created_at)}</Text>
                <Text style={{ fontWeight: '800', color: colors.dark }}>{money(b.grand_total)}</Text>
              </View>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}
