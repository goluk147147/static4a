import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import StoreHeader from '../../src/components/StoreHeader';
import { Card, EmptyState, Loading, Screen, SummaryRow, styles as ui } from '../../src/components/ui';
import { useAuth, canAdmin } from '../../src/store/auth';
import { colors } from '../../src/theme';
import { usePosReport, type ReportPeriod } from '../../src/pos';

const money = (n: number) => `₹${Number(n).toFixed(2)}`;
const qtyFmt = (n: number) => String(Math.round(Number(n) * 1000) / 1000);

const PERIODS: Array<{ key: ReportPeriod; label: string }> = [
  { key: 'day', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

/**
 * Sales Reports (design §7 / §9.3) — totals, discounts/refunds, payment-method
 * summary, best-sellers and low/out-of-stock lists for the counter. Fed by
 * GET /api/admin/pos/reports (requireStaff('pos_reports')). Excel export is
 * web-only (design §9.2); mobile shows the same figures read-only. Gated by
 * canAdmin('pos_reports') with the standard /login bounce.
 */
export default function AdminPosReports() {
  const router = useRouter();
  const { user, ready } = useAuth();
  const allowed = canAdmin(user, 'pos_reports');
  const [period, setPeriod] = useState<ReportPeriod>('day');

  useEffect(() => {
    if (ready && !allowed) router.replace({ pathname: '/login', params: { next: '/admin/pos-reports' } } as never);
  }, [ready, allowed]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data, isLoading, refetch } = usePosReport({ period });

  if (!allowed) {
    return <Screen header={<StoreHeader back title="Sales Reports" />}><Card><Text> </Text></Card></Screen>;
  }

  return (
    <Screen header={<StoreHeader back title="📈 Sales Reports" />} refreshing={isLoading} onRefresh={() => refetch()}>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
        {PERIODS.map((p) => {
          const active = period === p.key;
          return (
            <Pressable
              key={p.key}
              onPress={() => setPeriod(p.key)}
              style={{
                flex: 1,
                paddingVertical: 9,
                borderRadius: 10,
                alignItems: 'center',
                backgroundColor: active ? colors.primary : '#fff',
                borderWidth: 1,
                borderColor: active ? colors.primary : colors.border,
              }}
            >
              <Text style={{ fontWeight: '700', color: active ? '#fff' : colors.dark }}>{p.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {isLoading && !data ? (
        <Loading text="Loading report…" />
      ) : !data ? (
        <EmptyState icon="📈" title="No report data" text="Sales will appear here once bills are created." />
      ) : (
        <>
          <Card>
            <Text style={ui.h3}>Summary</Text>
            <SummaryRow label="Total sales" value={money(data.totals.sales)} bold />
            <SummaryRow label="Bills" value={String(data.totals.bills)} />
            <SummaryRow label="Discounts" value={money(data.totals.discounts)} />
            <SummaryRow label={`Refunds / cancellations (${data.totals.refundBills})`} value={money(data.totals.refunds)} color={colors.accent} />
          </Card>

          <Card style={{ marginTop: 12 }}>
            <Text style={ui.h3}>💳 Payment Methods</Text>
            {data.paymentSummary.length ? (
              data.paymentSummary.map((p) => (
                <SummaryRow key={p.method} label={`${cap(p.method)} (${p.bills})`} value={money(p.amount)} />
              ))
            ) : (
              <Text style={ui.muted}>No sales in this period.</Text>
            )}
          </Card>

          <Card style={{ marginTop: 12 }}>
            <Text style={ui.h3}>🔥 Best Sellers</Text>
            {data.bestSellers.length ? (
              data.bestSellers.map((b, i) => (
                <SummaryRow key={`${b.product_id ?? 'm'}-${i}`} label={`${b.name} · ${qtyFmt(b.quantity)}`} value={money(b.amount)} />
              ))
            ) : (
              <Text style={ui.muted}>No sales in this period.</Text>
            )}
          </Card>

          <Card style={{ marginTop: 12 }}>
            <Text style={ui.h3}>⚠️ Low Stock ({data.lowStock.length})</Text>
            {data.lowStock.length ? (
              data.lowStock.map((p) => (
                <SummaryRow key={p.id} label={p.name} value={`${qtyFmt(p.stock)} ${p.unit}`} color="#b96500" />
              ))
            ) : (
              <Text style={ui.muted}>No low-stock products. ✅</Text>
            )}
          </Card>

          <Card style={{ marginTop: 12 }}>
            <Text style={ui.h3}>⛔ Out of Stock ({data.outOfStock.length})</Text>
            {data.outOfStock.length ? (
              data.outOfStock.map((p) => (
                <SummaryRow key={p.id} label={p.name} value={`${qtyFmt(p.stock)} ${p.unit}`} color={colors.accent} />
              ))
            ) : (
              <Text style={ui.muted}>All products in stock. ✅</Text>
            )}
          </Card>

          <Text style={[ui.muted, { marginTop: 12, textAlign: 'center' }]}>
            Excel export is available in the web admin.
          </Text>
        </>
      )}
    </Screen>
  );
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
