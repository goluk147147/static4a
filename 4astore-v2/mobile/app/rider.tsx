import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import StoreHeader from '../src/components/StoreHeader';
import { Button, Card, EmptyState, GradientButton, Loading, Screen, StatusChip, styles as ui } from '../src/components/ui';
import { useAuth, isRider } from '../src/store/auth';
import { useAllOrders } from '../src/queries';
import { api, apiError } from '../src/api';
import { callNumber, openMapDirections } from '../src/native';
import { showToast } from '../src/store/ui';
import { colors } from '../src/theme';

const RIDER_STATUS = ['Rider Assigned', 'Out for Delivery', 'Delivered', 'Cancelled'];

export default function Rider() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user, ready } = useAuth();
  const rider = isRider(user);
  const { data: orders, isLoading } = useAllOrders(rider, 12000);
  const [sharing, setSharing] = useState(false);
  const watch = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    if (ready && !rider) router.replace({ pathname: '/login', params: { next: '/rider' } } as never);
  }, [ready, rider]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { watch.current?.remove(); }, []);

  const riderId = String(user?.id ?? '');
  const list = orders ?? [];
  const available = list.filter((o) => !o.rider_id && ['Order Placed', 'Confirmed', 'Packed'].includes(o.order_status));
  const mine = list.filter((o) => String(o.rider_id ?? '') === riderId && o.order_status !== 'Delivered' && o.order_status !== 'Cancelled');

  async function accept(orderId: string) {
    try {
      await api.post('/orders/accept', { orderId });
      showToast(`Accepted ${orderId}`, 'success');
      qc.invalidateQueries({ queryKey: ['all-orders'] });
    } catch (e) {
      showToast(apiError(e), 'error');
    }
  }
  async function setStatus(orderId: string, status: string) {
    try {
      await api.post('/tracking/status', { orderId, status });
      showToast(`${orderId} → ${status}`, 'success');
      qc.invalidateQueries({ queryKey: ['all-orders'] });
    } catch (e) {
      showToast(apiError(e), 'error');
    }
  }

  async function toggleGps() {
    if (sharing) {
      watch.current?.remove();
      watch.current = null;
      setSharing(false);
      return;
    }
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return showToast('Location permission chahiye GPS share karne ke liye.', 'error');
    watch.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 },
      (pos) => {
        const { latitude, longitude, accuracy, heading, speed } = pos.coords;
        mine.forEach((o) =>
          api.post('/tracking/location', {
            orderId: o.order_id, latitude, longitude,
            accuracy: accuracy ?? undefined, heading: heading ?? undefined, speed: speed != null && speed >= 0 ? speed : undefined,
          }).catch(() => null)
        );
      }
    );
    setSharing(true);
    showToast('📍 GPS sharing started', 'success');
  }

  if (!rider) return <Screen header={<StoreHeader back title="Rider" />}><Loading /></Screen>;

  return (
    <Screen header={<StoreHeader back title="🛵 Rider Console" />} refreshing={isLoading} onRefresh={() => qc.invalidateQueries({ queryKey: ['all-orders'] })}>
      <GradientButton title={sharing ? '📍 Sharing GPS… (tap to stop)' : 'Start GPS Sharing'} onPress={toggleGps} style={{ marginBottom: 14 }} />

      <Text style={[ui.h3, { marginBottom: 8 }]}>My Deliveries ({mine.length})</Text>
      {mine.length === 0 && <Text style={[ui.muted, { marginBottom: 12 }]}>No active deliveries.</Text>}
      {mine.map((o) => (
        <Card key={o.order_id} style={{ marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontWeight: '800', color: colors.dark }}>{o.order_id}</Text>
            <StatusChip status={o.order_status} />
          </View>
          <Text style={ui.muted}>{o.customer?.name} · {o.customer?.city} · ₹{o.total_amount}</Text>
          <Text style={ui.muted}>📍 {o.customer?.address}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            {!!o.customer?.mobile && <Button small color={colors.green} title="📞 Call" onPress={() => callNumber(o.customer?.mobile)} />}
            {o.delivery_address?.latitude != null && <Button small color={colors.track} title="🧭 Navigate" onPress={() => openMapDirections(Number(o.delivery_address!.latitude), Number(o.delivery_address!.longitude), o.customer?.name)} />}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {RIDER_STATUS.map((st) => <Button key={st} small outline={o.order_status !== st} title={st} onPress={() => setStatus(o.order_id, st)} />)}
          </View>
        </Card>
      ))}

      <Text style={[ui.h3, { marginTop: 20, marginBottom: 8 }]}>Available Orders ({available.length})</Text>
      {available.length === 0 ? (
        <EmptyState icon="📭" title="No available orders" text="Naye orders yahan dikhenge." />
      ) : (
        available.map((o) => (
          <Card key={o.order_id} style={{ marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '800', color: colors.dark }}>{o.order_id}</Text>
              <Text style={ui.muted}>{o.customer?.name} · {o.customer?.city} · ₹{o.total_amount}</Text>
            </View>
            <Button title="Accept" onPress={() => accept(o.order_id)} />
          </Card>
        ))
      )}
    </Screen>
  );
}
