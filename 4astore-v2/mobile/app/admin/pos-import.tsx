import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import StoreHeader from '../../src/components/StoreHeader';
import { Button, Card, Screen, styles as ui } from '../../src/components/ui';
import { useAuth, canAdmin } from '../../src/store/auth';
import { useChangeLog } from '../../src/pos';
import { formatDate } from '../../src/checkout';

/**
 * Mobile Excel Import (design §9.2) — the spreadsheet upload / preview / commit
 * flow is WEB-ONLY by design (it needs a file picker and would add a native
 * module). On mobile we explain that and point to the on-device inventory
 * editor, which uses the same transactional /api/admin/pos endpoints. We also
 * surface the recent change log so edits made on web/app are visible here.
 */
export default function AdminPosImport() {
  const router = useRouter();
  const { user, ready } = useAuth();
  const allowed = canAdmin(user, 'inventory');
  const { data } = useChangeLog(undefined, 20);
  const entries = data?.entries ?? [];

  useEffect(() => {
    if (ready && !allowed) router.replace({ pathname: '/login', params: { next: '/admin/pos-import' } } as never);
  }, [ready, allowed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!allowed) return <Screen header={<StoreHeader back title="Excel Import" />}><Card><Text style={ui.muted}>Checking access…</Text></Card></Screen>;

  return (
    <Screen header={<StoreHeader back title="📥 Excel Import" />}>
      <Card>
        <Text style={ui.h3}>Excel import runs on the web</Text>
        <Text style={[ui.muted, { marginTop: 8 }]}>
          Bulk product upload from an Excel / CSV file (with preview and row-wise error checks) is available in the web admin panel at Admin → Excel Import. The app keeps the counter fast and doesn't bundle a spreadsheet reader.
        </Text>
        <Text style={[ui.muted, { marginTop: 8 }]}>
          On your phone you can still update prices and stock one product at a time from Inventory — it saves through the same system and is fully audited.
        </Text>
        <Button title="📦 Open Inventory" onPress={() => router.push('/admin/inventory')} style={{ marginTop: 14 }} />
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Text style={ui.h3}>Recent changes</Text>
        {entries.length === 0 ? (
          <Text style={[ui.muted, { marginTop: 8 }]}>No changes logged yet.</Text>
        ) : (
          entries.map((e) => (
            <View key={e.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f3ece0' }}>
              <Text style={ui.body}>#{e.product_id ?? '—'} · {e.field}: {e.old_val ?? '—'} → {e.new_val ?? '—'}</Text>
              <Text style={ui.muted}>{formatDate(e.created_at)} · {e.actor ?? '—'} · {e.source}</Text>
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}
