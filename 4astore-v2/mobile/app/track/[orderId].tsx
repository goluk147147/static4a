import React, { useState } from 'react';
import { ScrollView, Share, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import StoreHeader from '../../src/components/StoreHeader';
import TrackMap from '../../src/components/TrackMap';
import { Button, Card, Field, styles as ui } from '../../src/components/ui';
import { api, apiError } from '../../src/api';
import { callNumber } from '../../src/native';
import { SITE_URL } from '../../src/config';
import { colors } from '../../src/theme';
import type { Tracking } from '../../src/types';

const STEPS = ['Order Placed', 'Confirmed', 'Packed', 'Rider Assigned', 'Out for Delivery', 'Delivered'];

/** Live tracking (Leaflet + OSRM route + ETA). Also the landing screen for /track/:id smart links & pushes. */
export default function Track() {
  const { orderId: raw } = useLocalSearchParams<{ orderId?: string }>();
  const orderId = raw && raw !== 'index' ? String(raw) : '';
  const router = useRouter();
  const [input, setInput] = useState(orderId);

  const q = useQuery({
    queryKey: ['track', orderId],
    enabled: !!orderId,
    refetchInterval: 8000,
    queryFn: async () => (await api.get('/tracking', { orderId })).tracking as Tracking,
  });
  const data = q.data;
  const stepIndex = data ? STEPS.indexOf(data.status) : -1;

  const submit = () => {
    const id = input.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (id) router.replace(`/track/${id}`);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.lightGray }}>
      <StoreHeader back title="📦 Apna Order Track Karein" />
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Field label="Order ID" value={input} onChangeText={setInput} placeholder="Order ID (e.g. 4A123456)" autoCapitalize="characters" onSubmitEditing={submit} />
          </View>
          <Button title="Track" onPress={submit} style={{ marginBottom: 12 }} />
        </View>
        {!orderId && <Text style={ui.muted}>Order ID aapko "My Orders" me milega.</Text>}

        {!!orderId && (
          <>
            <Text style={[ui.h3, { marginBottom: 10 }]}>Track Order {orderId}</Text>
            {q.isError && <Text style={{ color: colors.accent, marginBottom: 10 }}>{apiError(q.error)}</Text>}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginBottom: 14 }}>
              {STEPS.map((s, i) => (
                <View key={s} style={{ width: 92, alignItems: 'center' }}>
                  <View style={{ height: 6, borderRadius: 3, alignSelf: 'stretch', backgroundColor: i <= stepIndex ? colors.primary : '#e2e8f0', marginBottom: 4 }} />
                  <Text style={{ fontSize: 11, textAlign: 'center', color: i <= stepIndex ? colors.primary : '#94a3b8', fontWeight: i === stepIndex ? '800' : '500' }}>{s}</Text>
                </View>
              ))}
            </ScrollView>
            {data?.status === 'Cancelled' && <Text style={{ color: '#dc2626', fontWeight: '800', marginBottom: 10 }}>❌ Order Cancelled</Text>}
            {!!data?.route && (
              <Card style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
                <Text style={{ color: colors.dark }}>🛣️ {data.route.distance} km away</Text>
                <Text style={{ fontWeight: '800', color: colors.dark }}>⏱️ ETA {data.route.eta} min</Text>
              </Card>
            )}
            {!!data?.rider?.name && (
              <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <Text style={{ color: colors.dark, flex: 1 }}>🛵 Rider: {data.rider.name}</Text>
                {!!data.rider.phone && <Button small title={`📞 ${data.rider.phone}`} color={colors.green} onPress={() => callNumber(data.rider.phone)} />}
              </Card>
            )}
            <TrackMap data={data} />
            <Button title="🔗 Share tracking link" outline onPress={() => Share.share({ message: `Track my 4A Store order ${orderId}: ${SITE_URL}/track/${orderId}` })} style={{ marginTop: 12 }} />
          </>
        )}
      </ScrollView>
    </View>
  );
}
