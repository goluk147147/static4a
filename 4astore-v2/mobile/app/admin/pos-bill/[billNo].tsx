import React, { useEffect } from 'react';
import { Alert, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import StoreHeader from '../../../src/components/StoreHeader';
import { Button, Card, Loading, Screen, SummaryRow, styles as ui } from '../../../src/components/ui';
import { useAuth, canAdmin } from '../../../src/store/auth';
import { apiError } from '../../../src/api';
import { showToast } from '../../../src/store/ui';
import { formatDate } from '../../../src/checkout';
import { colors } from '../../../src/theme';
import { useCancelBill, usePosBill, useRefundBill } from '../../../src/pos';

const money = (n: number) => `₹${Number(n).toFixed(2)}`;
const STATUS_COLOR: Record<string, string> = { completed: '#087a3d', held: '#b96500', cancelled: '#c62828', refunded: '#6d28d9' };

/**
 * Bill detail (design §6–§8). Renders the bill; the five share actions
 * (WhatsApp / Download PDF / Print / Share / Copy) are wired here by FEAT-005.
 * This screen owns the layout + the controlled cancel / refund reversals.
 */
export default function PosBillDetail() {
  const router = useRouter();
  const { billNo } = useLocalSearchParams<{ billNo: string }>();
  const { user, ready } = useAuth();
  const allowed = canAdmin(user, 'pos');

  const { data: bill, isLoading } = usePosBill(billNo);
  const cancel = useCancelBill();
  const refund = useRefundBill();

  useEffect(() => {
    if (ready && !allowed) router.replace({ pathname: '/login', params: { next: `/admin/pos-bill/${billNo}` } } as never);
  }, [ready, allowed]); // eslint-disable-line react-hooks/exhaustive-deps

  function reverse(kind: 'cancel' | 'refund') {
    Alert.alert(
      kind === 'cancel' ? 'Cancel bill?' : 'Refund bill?',
      'This restores the sold stock. Continue?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes',
          style: 'destructive',
          onPress: async () => {
            try {
              if (kind === 'cancel') await cancel.mutateAsync({ billNo: billNo! });
              else await refund.mutateAsync({ billNo: billNo! });
              showToast(`Bill ${kind === 'cancel' ? 'cancelled' : 'refunded'} — stock restored`, 'success');
            } catch (e) {
              showToast(apiError(e), 'error');
            }
          },
        },
      ]
    );
  }

  if (!allowed || isLoading || !bill) {
    return <Screen header={<StoreHeader back title="Bill" />}>{isLoading ? <Loading text="Loading bill…" /> : <Card><Text style={ui.muted}>Bill not found.</Text></Card>}</Screen>;
  }

  const reversing = cancel.isPending || refund.isPending;

  return (
    <Screen header={<StoreHeader back title={bill.bill_no || 'Bill'} />}>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View>
            <Text style={ui.h2}>{bill.bill_no || `Held #${bill.id}`}</Text>
            <Text style={ui.muted}>{formatDate(bill.created_at)} · {bill.created_by || '—'}</Text>
          </View>
          <View style={{ backgroundColor: `${STATUS_COLOR[bill.status] || '#999'}22`, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>
            <Text style={{ color: STATUS_COLOR[bill.status] || '#555', fontWeight: '700', fontSize: 12 }}>{bill.status}</Text>
          </View>
        </View>

        {(bill.customer_name || bill.customer_mobile) && (
          <Text style={{ marginTop: 8, color: colors.dark }}>👤 {bill.customer_name || 'Walk-in'}{bill.customer_mobile ? ` · ${bill.customer_mobile}` : ''}</Text>
        )}

        <View style={{ marginTop: 12 }}>
          {bill.items.map((it) => (
            <View key={it.id ?? `${it.name}-${it.rate}`} style={{ flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#f3ece0' }}>
              <View style={{ flex: 1 }}>
                <Text style={ui.body}>{it.name}{it.is_manual ? ' ✎' : ''}</Text>
                <Text style={ui.muted}>{it.quantity} {it.unit} × {money(it.rate)}</Text>
              </View>
              <Text style={ui.bodyStrong}>{money(it.line_total)}</Text>
            </View>
          ))}
        </View>

        <View style={{ marginTop: 10 }}>
          <SummaryRow label="Subtotal" value={money(bill.subtotal)} />
          {bill.discount > 0 && <SummaryRow label="Discount" value={`− ${money(bill.discount)}`} />}
          {bill.tax_total > 0 && <SummaryRow label="Tax" value={money(bill.tax_total)} />}
          <SummaryRow label="Grand Total" value={money(bill.grand_total)} bold />
          <SummaryRow label={`${(bill.payment_method || 'cash').toUpperCase()} · ${bill.payment_status}`} value={`Paid ${money(bill.amount_paid)}`} />
        </View>
      </Card>

      {bill.status === 'completed' && (
        <Card style={{ marginTop: 12 }}>
          <Text style={[ui.muted, { marginBottom: 8 }]}>Reverse this bill (restores stock):</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Cancel bill" outline color="#c62828" onPress={() => reverse('cancel')} disabled={reversing} style={{ flex: 1 }} />
            <Button title="Refund" outline color="#6d28d9" onPress={() => reverse('refund')} disabled={reversing} style={{ flex: 1 }} />
          </View>
        </Card>
      )}
    </Screen>
  );
}
