import React, { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import StoreHeader from '../../src/components/StoreHeader';
import { Button, Card, Field, Screen, styles as ui } from '../../src/components/ui';
import { useAuth, canAdmin } from '../../src/store/auth';
import { apiError } from '../../src/api';
import { showToast } from '../../src/store/ui';
import { colors, radius } from '../../src/theme';
import { PosProduct, useBulkUpdate, usePosProductSearch } from '../../src/pos';

const money = (n: number) => `₹${Number(n).toFixed(2)}`;

/**
 * Mobile inventory (design §6.4) — search a product and update its selling price
 * and/or stock through the SAME transactional /api/admin/pos/bulk-update
 * endpoint the web Excel module uses (change-log + stock movements server-side).
 * Excel file import/export stays web-only per design §9.2 (no new native module).
 */
export default function AdminInventory() {
  const router = useRouter();
  const { user, ready } = useAuth();
  const allowed = canAdmin(user, 'inventory');
  const [search, setSearch] = useState('');
  const { data: results = [], isFetching } = usePosProductSearch(search);
  const bulk = useBulkUpdate();
  const [edits, setEdits] = useState<Record<number, { price?: string; stock?: string }>>({});

  useEffect(() => {
    if (ready && !allowed) router.replace({ pathname: '/login', params: { next: '/admin/inventory' } } as never);
  }, [ready, allowed]); // eslint-disable-line react-hooks/exhaustive-deps

  const setEdit = (id: number, field: 'price' | 'stock', value: string) =>
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));

  async function save(p: PosProduct) {
    const e = edits[p.id] || {};
    const price = e.price?.trim();
    const stock = e.stock?.trim();
    if (!price && !stock) return showToast('Change price or stock first.', 'error');
    try {
      if (price) {
        const r = await bulk.mutateAsync({ field: 'selling_price', updates: [{ id: p.id, value: Number(price) }] });
        showToast(r.message, 'success');
      }
      if (stock) {
        const r = await bulk.mutateAsync({ field: 'stock', updates: [{ id: p.id, value: Number(stock) }] });
        showToast(r.message, 'success');
      }
      setEdits((prev) => ({ ...prev, [p.id]: {} }));
    } catch (err) {
      showToast(apiError(err), 'error');
    }
  }

  if (!allowed) return <Screen header={<StoreHeader back title="Inventory" />}><Card><Text style={ui.muted}>Checking access…</Text></Card></Screen>;

  return (
    <Screen header={<StoreHeader back title="📦 Inventory" />}>
      <Field label="" placeholder="🔎 Search by name, SKU or barcode" value={search} onChangeText={setSearch} autoCapitalize="none" />

      {search.trim() === '' ? (
        <Card><Text style={ui.muted}>Search for a product to edit its price or stock.</Text></Card>
      ) : isFetching && results.length === 0 ? (
        <Card><Text style={ui.muted}>Searching…</Text></Card>
      ) : results.length === 0 ? (
        <Card><Text style={ui.muted}>No matching products.</Text></Card>
      ) : (
        results.map((p) => (
          <Card key={p.id} style={{ marginBottom: 10 }}>
            <Text style={ui.bodyStrong}>{p.name}</Text>
            <Text style={ui.muted}>{p.sku ? `SKU ${p.sku} · ` : ''}Price {money(p.price)} · Stock {p.stock} {p.unit}</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={ui.label}>New price ₹</Text>
                <TextInput value={edits[p.id]?.price ?? ''} onChangeText={(t) => setEdit(p.id, 'price', t.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" placeholder={p.price.toFixed(2)} placeholderTextColor="#a3928a" style={st.input} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={ui.label}>New stock</Text>
                <TextInput value={edits[p.id]?.stock ?? ''} onChangeText={(t) => setEdit(p.id, 'stock', t.replace(/[^\d.-]/g, ''))} keyboardType="decimal-pad" placeholder={String(p.stock)} placeholderTextColor="#a3928a" style={st.input} />
              </View>
            </View>
            <Button small title={bulk.isPending ? 'Saving…' : '💾 Save'} loading={bulk.isPending} onPress={() => save(p)} style={{ marginTop: 10 }} />
          </Card>
        ))
      )}
    </Screen>
  );
}

const st = {
  input: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#fff', color: colors.dark },
} as const;
