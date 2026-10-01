import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import StoreHeader from '../../src/components/StoreHeader';
import { Button, Card, EmptyState, GradientButton, Loading, Screen, StatusChip, styles as ui } from '../../src/components/ui';
import { useAuth } from '../../src/store/auth';
import { useMyOrders, useSettings } from '../../src/queries';
import { formatDate } from '../../src/checkout';
import { downloadInvoice } from '../../src/invoice';
import { showToast } from '../../src/store/ui';
import { colors } from '../../src/theme';

export default function Orders() {
  const router = useRouter();
  const { user, ready } = useAuth();
  const settings = useSettings().data;
  const q = useMyOrders(user?.mobile);

  useEffect(() => {
    if (ready && !user) router.push({ pathname: '/login', params: { next: '/orders' } } as never);
  }, [ready, user, router]);

  return (
    <Screen header={<StoreHeader title="📋 My Orders" />} refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      {!user ? (
        <EmptyState icon="🔐" title="Login required" text="Apne orders dekhne ke liye login karein." action={<GradientButton title="Login" onPress={() => router.push('/login')} />} />
      ) : q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <Text style={[ui.muted, { textAlign: 'center', padding: 40 }]}>Unable to load data. Pull down to refresh.</Text>
      ) : !q.data?.length ? (
        <EmptyState icon="📋" title="No orders yet" text="You haven't placed any orders yet. Start shopping!" action={<GradientButton title="Browse Products →" onPress={() => router.push('/products')} />} />
      ) : (
        q.data.map((o) => (
          <Card key={o.order_id} style={{ marginBottom: 14 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '800', color: colors.primaryDark }}>#{o.order_id}</Text>
                <Text style={ui.muted}>{formatDate(o.order_date)}</Text>
              </View>
              <StatusChip status={o.order_status} />
            </View>
            <View style={{ marginTop: 10 }}>
              {o.items.map((i, idx) => (
                <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
                  <Text style={{ flex: 1, color: colors.dark }}>{i.name} × {i.quantity}</Text>
                  <Text style={{ color: colors.dark }}>₹{i.price * i.quantity}</Text>
                </View>
              ))}
            </View>
            <View style={ui.divider} />
            <Text style={ui.muted}>📍 {o.customer.address}, {o.customer.city} – {o.customer.pincode}{'\n'}💳 {o.payment_method}</Text>
            <Text style={{ fontWeight: '800', fontSize: 16, color: colors.primaryDark, marginTop: 6 }}>Total: ₹{o.total_amount}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <Button title="📍 Track Order" color={colors.track} onPress={() => router.push(`/track/${o.order_id}`)} style={{ flex: 1 }} />
              <Button
                title="📄 Invoice"
                onPress={() => downloadInvoice(o, settings?.storePhone, settings?.storeAddress).catch(() => showToast('Invoice could not be created. Please try again.', 'error'))}
                style={{ flex: 1 }}
              />
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}
