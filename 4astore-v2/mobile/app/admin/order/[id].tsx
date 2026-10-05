import React, { useEffect } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import StoreHeader from '../../../src/components/StoreHeader';
import { Button, Card, Loading, Screen, StatusChip, SummaryRow, styles as ui } from '../../../src/components/ui';
import { useAuth, isOrderStaff } from '../../../src/store/auth';
import { useOrder, useSettings } from '../../../src/queries';
import { api, apiError, authHeaders, apiUrl } from '../../../src/api';
import { downloadInvoice } from '../../../src/invoice';
import { callNumber, openMapDirections } from '../../../src/native';
import { showToast } from '../../../src/store/ui';
import { colors } from '../../../src/theme';
import { formatDate } from '../../../src/checkout';
import type { Order } from '../../../src/types';

const STATUS = ['Order Placed', 'Confirmed', 'Packed', 'Rider Assigned', 'Out for Delivery', 'Delivered', 'Cancelled'];

/** Payment screenshot needs the auth header, so fetch as a data URI. */
function useScreenshot(orderId: string) {
  return useQuery({
    queryKey: ['screenshot', orderId],
    retry: false,
    queryFn: async () => {
      // Bound the raw fetch so a slow/hung screenshot can never leave the card's ActivityIndicator
      // spinning forever: abort after 15s. On abort/network error we throw Error('none') like a 404,
      // so (retry:false) resolves to shot.data==null and the "No payment screenshot found" empty
      // state renders and the spinner stops.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(apiUrl(`/orders/${encodeURIComponent(orderId)}/screenshot`), {
          headers: { ...authHeaders() },
          signal: controller.signal,
        });
        if (!res.ok) throw new Error('none');
        const blob = await res.blob();
        return await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onloadend = () => resolve(String(r.result));
          r.onerror = reject;
          r.readAsDataURL(blob);
        });
      } catch {
        throw new Error('none');
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}

/** Admin order detail — kiska order, kahan se, kya items, payment screenshot, status change. */
export default function AdminOrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { user, ready } = useAuth();
  const staff = isOrderStaff(user);
  const q = useOrder(id);
  const settings = useSettings().data;
  const shot = useScreenshot(String(id));

  useEffect(() => {
    if (ready && !staff) router.replace('/login');
  }, [ready, staff]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isLoading || !staff) return <Screen header={<StoreHeader back title="Order" />}><Loading /></Screen>;
  if (q.isError || !q.data) {
    return <Screen header={<StoreHeader back title="Order" />}><Card><Text style={ui.muted}>{apiError(q.error) || 'Order not found'}</Text></Card></Screen>;
  }
  const o = q.data;
  const c = o.customer || {};
  const dest = o.delivery_address || {};

  // Status change (incl. 'Cancelled') is the staff loader surface the user reported as
  // "order staff ke delete pe loader" — there is NO DELETE endpoint in the mobile app, so this
  // is the only staff action that touches an order. Make it optimistic so the button never hangs
  // on the network: apply the new status to the cache immediately, clear the spinner, and roll
  // back if the background request fails.
  function setStatus(status: string) {
    const prevOrder = qc.getQueryData<Order>(['order', o.order_id]);
    const prevAll = qc.getQueryData(['all-orders']);
    // Optimistic cache update — UI reflects the new status at once.
    qc.setQueryData<Order | undefined>(['order', o.order_id], (old) => (old ? { ...old, order_status: status } : old));
    qc.setQueryData(['all-orders'], (list) =>
      Array.isArray(list) ? list.map((x: Order) => (x.order_id === o.order_id ? { ...x, order_status: status } : x)) : list
    );
    // The optimistic cache update is the instant feedback — do NOT hold the button spinner
    // across the network request (that was the reported "loader" hang).
    api
      .post('/admin/orders/status', { orderId: o.order_id, status })
      .then(() => {
        showToast(`#${o.order_id} → ${status}`, 'success');
        qc.invalidateQueries({ queryKey: ['order', o.order_id] });
        qc.invalidateQueries({ queryKey: ['all-orders'] });
      })
      .catch((e) => {
        // Roll the cache back to what it was before the optimistic update.
        qc.setQueryData(['order', o.order_id], prevOrder);
        qc.setQueryData(['all-orders'], prevAll);
        showToast(apiError(e), 'error');
      });
  }

  return (
    <Screen header={<StoreHeader back title={`Order #${o.order_id}`} />}>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={ui.muted}>{formatDate(o.order_date)}</Text>
          <StatusChip status={o.order_status} />
        </View>

        <Text style={[ui.h3, { marginTop: 14 }]}>👤 Customer — kisne order kiya</Text>
        <Text style={{ fontWeight: '800', color: colors.dark, marginTop: 4 }}>{c.name}</Text>
        <Pressable onPress={() => callNumber(c.mobile)}><Text style={{ color: colors.track }}>📱 {c.mobile}</Text></Pressable>

        <Text style={[ui.h3, { marginTop: 14 }]}>📍 Delivery — kahan se / kahan</Text>
        <Text style={{ color: colors.dark, marginTop: 4 }}>{c.address}, {c.city} – {c.pincode}</Text>
        {!!dest.landmark && <Text style={ui.muted}>🏷️ {dest.landmark}</Text>}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <Button small color={colors.green} title="📞 Call" onPress={() => callNumber(c.mobile)} />
          {dest.latitude != null && <Button small color={colors.track} title="🧭 Navigate" onPress={() => openMapDirections(Number(dest.latitude), Number(dest.longitude), c.name)} />}
          <Button small outline title="🗺️ Live track" onPress={() => router.push(`/track/${o.order_id}`)} />
        </View>
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Text style={[ui.h3, { marginBottom: 8 }]}>📦 Items</Text>
        {o.items.map((i, idx) => (
          <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Text style={{ flex: 1, color: colors.dark }}>{i.name} × {i.quantity}</Text>
            <Text style={{ color: colors.dark }}>₹{i.price * i.quantity}</Text>
          </View>
        ))}
        <View style={{ marginTop: 10 }}>
          <SummaryRow label="Subtotal" value={`₹${o.subtotal}`} />
          <SummaryRow label="Discount" value={`-₹${o.discount}`} color={colors.primary} />
          <SummaryRow label="Delivery" value={`₹${o.delivery_charge}`} />
          <View style={ui.divider} />
          <SummaryRow label="Total" value={`₹${o.total_amount}`} bold />
        </View>
        <View style={{ backgroundColor: colors.primaryLight, borderRadius: 8, padding: 10, marginTop: 10 }}>
          <Text style={{ color: colors.dark }}>💳 {o.payment_method}{o.payment_reference ? ` · UTR ${o.payment_reference}` : ''}</Text>
        </View>
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Text style={[ui.h3, { marginBottom: 8 }]}>📸 Payment Screenshot</Text>
        {shot.isLoading ? (
          <ActivityIndicator color={colors.primary} />
        ) : shot.data ? (
          <Image source={{ uri: shot.data }} style={{ width: '100%', height: 300, borderRadius: 8, borderWidth: 2, borderColor: colors.primary }} resizeMode="contain" />
        ) : (
          <Text style={ui.muted}>⚠️ No payment screenshot found</Text>
        )}
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Text style={[ui.h3, { marginBottom: 8 }]}>Update status</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {STATUS.map((st) => (
            <Button key={st} small outline={o.order_status !== st} color={st === 'Cancelled' ? '#c62828' : colors.primary} title={st} onPress={() => setStatus(st)} />
          ))}
        </View>
        <Button title="📄 Download Invoice" onPress={() => downloadInvoice(o, settings?.storePhone, settings?.storeAddress).catch(() => showToast('Invoice could not be created', 'error'))} style={{ marginTop: 12 }} />
      </Card>
    </Screen>
  );
}
