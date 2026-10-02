import React, { useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import StoreHeader from '../../src/components/StoreHeader';
import TrackMap from '../../src/components/TrackMap';
import { Button, Card, Field, styles as ui } from '../../src/components/ui';
import { api, apiError } from '../../src/api';
import { callNumber } from '../../src/native';
import { SITE_URL } from '../../src/config';
import { colors, radius } from '../../src/theme';
import type { Tracking } from '../../src/types';

const STEPS = ['Order Placed', 'Confirmed', 'Packed', 'Rider Assigned', 'Out for Delivery', 'Delivered'];
const STEP_ICON: Record<string, string> = {
  'Order Placed': '📝',
  Confirmed: '✅',
  Packed: '📦',
  'Rider Assigned': '🛵',
  'Out for Delivery': '🚀',
  Delivered: '🏠',
};

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
  const isDelivered = data?.status === 'Delivered';
  const etaMin = data?.route?.eta != null ? Math.max(1, Math.round(data.route.eta)) : null;

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
            {q.isError && <Text style={{ color: colors.accent, marginBottom: 10 }}>{apiError(q.error)}</Text>}

            {/* Zepto/Blinkit-style ETA hero */}
            {data?.status === 'Cancelled' ? (
              <View style={[s.hero, { backgroundColor: '#fdecea' }]}>
                <Text style={{ fontSize: 34 }}>❌</Text>
                <Text style={{ color: '#dc2626', fontWeight: '900', fontSize: 18, marginTop: 4 }}>Order Cancelled</Text>
              </View>
            ) : (
              <LinearGradient colors={isDelivered ? ['#087a3d', '#0bb15a'] : ['#ff7a00', '#ef233c']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700', opacity: 0.95 }}>Order #{orderId}</Text>
                {isDelivered ? (
                  <Text style={s.heroBig}>Delivered 🎉</Text>
                ) : etaMin != null ? (
                  <>
                    <Text style={s.heroBig}>Arriving in {etaMin} min</Text>
                    {data?.route?.distance != null && <Text style={s.heroSub}>🛣️ {data.route.distance} km away · {STEP_ICON[data?.status || ''] || ''} {data?.status}</Text>}
                  </>
                ) : (
                  <>
                    <Text style={s.heroBig}>{STEP_ICON[data?.status || ''] || '⏳'} {data?.status || 'Fetching status…'}</Text>
                    <Text style={s.heroSub}>Hum aapke order par kaam kar rahe hain</Text>
                  </>
                )}
              </LinearGradient>
            )}

            {/* Live map */}
            <View style={{ marginTop: 12 }}>
              <TrackMap data={data} height={300} />
            </View>

            {/* Rider card */}
            {!!data?.rider?.name && !isDelivered && (
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 }}>
                <View style={s.riderAvatar}><Text style={{ fontSize: 24 }}>🛵</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '800', color: colors.dark }}>{data.rider.name}</Text>
                  <Text style={ui.muted}>Your delivery partner</Text>
                </View>
                {!!data.rider.phone && <Button small title="📞 Call" color={colors.green} onPress={() => callNumber(data.rider.phone)} />}
              </Card>
            )}

            {/* Vertical status timeline */}
            <Card style={{ marginTop: 12 }}>
              <Text style={[ui.h3, { marginBottom: 10 }]}>Order status</Text>
              {STEPS.map((step, i) => {
                const done = i < stepIndex;
                const current = i === stepIndex;
                const last = i === STEPS.length - 1;
                return (
                  <View key={step} style={{ flexDirection: 'row' }}>
                    <View style={{ alignItems: 'center', width: 34 }}>
                      <View style={[s.dot, done && s.dotDone, current && s.dotCurrent]}>
                        <Text style={{ fontSize: 13 }}>{done ? '✓' : current ? STEP_ICON[step] : ''}</Text>
                      </View>
                      {!last && <View style={[s.line, i < stepIndex && { backgroundColor: colors.primary }]} />}
                    </View>
                    <View style={{ flex: 1, paddingBottom: last ? 0 : 14, paddingTop: 2 }}>
                      <Text style={{ fontSize: 14, fontWeight: current ? '800' : done ? '600' : '500', color: current ? colors.primaryDark : done ? colors.dark : '#94a3b8' }}>{STEP_ICON[step]} {step}</Text>
                      {current && <Text style={{ color: colors.primary, fontSize: 12, marginTop: 2 }}>In progress…</Text>}
                    </View>
                  </View>
                );
              })}
            </Card>

            <Button title="🔗 Share tracking link" outline onPress={() => Share.share({ message: `Track my 4A Store order ${orderId}: ${SITE_URL}/track/${orderId}` })} style={{ marginTop: 12 }} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  hero: { borderRadius: radius.lg, padding: 20, alignItems: 'center', justifyContent: 'center', minHeight: 110 },
  heroBig: { color: '#fff', fontSize: 24, fontWeight: '900', marginTop: 4, textAlign: 'center' },
  heroSub: { color: '#fff', fontSize: 13, marginTop: 6, opacity: 0.95, textAlign: 'center' },
  riderAvatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' },
  dotDone: { backgroundColor: colors.primary },
  dotCurrent: { backgroundColor: colors.secondary, borderWidth: 2, borderColor: colors.primary },
  line: { width: 2, flex: 1, minHeight: 18, backgroundColor: '#e2e8f0', marginVertical: 2 },
});
