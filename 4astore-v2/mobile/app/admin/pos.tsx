import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import StoreHeader from '../../src/components/StoreHeader';
import { Button, Card, Field, GradientButton, Screen, Stepper, styles as ui } from '../../src/components/ui';
import { useAuth, canAdmin } from '../../src/store/auth';
import { apiError } from '../../src/api';
import { showToast } from '../../src/store/ui';
import { colors, radius } from '../../src/theme';
import {
  CreateBillPayload,
  PosProduct,
  fetchPosBillById,
  isDecimalUnit,
  posLookupExact,
  round2,
  round3,
  useCreateBill,
  useHoldBill,
  usePosProductSearch,
} from '../../src/pos';

interface CartLine {
  key: string;
  productId: number | null;
  name: string;
  sku: string | null;
  unit: string;
  quantity: number;
  rate: number;
  taxRate: number;
  isManual: boolean;
}

const money = (n: number) => `₹${Number(n).toFixed(2)}`;
const uuid = () => Crypto.randomUUID();
const lineBase = (l: CartLine) => round2(l.quantity * l.rate);
const lineTax = (l: CartLine) => round2(lineBase(l) * (l.taxRate / 100));
const lineTotal = (l: CartLine) => round2(lineBase(l) + lineTax(l));

/**
 * Mobile POS / billing screen (design §3) — single-column, thumb-reachable:
 * search / scan at top, the live cart below, and a sticky-feeling checkout
 * card at the bottom. The idempotency key is created once per cart (useRef)
 * and reused on every retry so a double-tap / retry never deducts stock twice
 * (acceptance d). The server recomputes authoritative totals on checkout.
 */
export default function AdminPos() {
  const router = useRouter();
  const { user, ready } = useAuth();
  const allowed = canAdmin(user, 'pos');
  const params = useLocalSearchParams<{ reopen?: string }>();

  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState('');
  const [discount, setDiscount] = useState('');
  const [custName, setCustName] = useState('');
  const [custMobile, setCustMobile] = useState('');
  const [payMethod, setPayMethod] = useState<'cash' | 'upi' | 'other'>('cash');

  const idemKey = useRef<string>(uuid());
  const { data: results = [], isFetching } = usePosProductSearch(search);
  const createBill = useCreateBill();
  const holdBill = useHoldBill();

  useEffect(() => {
    if (ready && !allowed) router.replace({ pathname: '/login', params: { next: '/admin/pos' } } as never);
  }, [ready, allowed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reopen a held bill via ?reopen=<id>.
  useEffect(() => {
    const id = Number(params.reopen);
    if (!params.reopen || !Number.isFinite(id)) return;
    fetchPosBillById(id)
      .then((bill) => {
        setCart(
          bill.items.map((it) => ({
            key: uuid(),
            productId: it.product_id,
            name: it.name,
            sku: it.sku,
            unit: it.unit,
            quantity: it.quantity,
            rate: it.rate,
            taxRate: it.tax_rate,
            isManual: it.is_manual,
          }))
        );
        setDiscount(String(bill.discount || ''));
        setCustName(bill.customer_name || '');
        setCustMobile(bill.customer_mobile || '');
        showToast('Held bill reopened', 'info');
      })
      .catch((e) => showToast(apiError(e), 'error'));
  }, [params.reopen]);

  const subtotal = round2(cart.reduce((s, l) => s + lineBase(l), 0));
  const taxTotal = round2(cart.reduce((s, l) => s + lineTax(l), 0));
  const clampedDiscount = Math.min(Math.max(0, Number(discount) || 0), subtotal);
  const grandTotal = round2(subtotal - clampedDiscount + taxTotal);

  function addProduct(p: PosProduct) {
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === p.id && !l.isManual);
      if (existing) return prev.map((l) => (l === existing ? { ...l, quantity: round3(l.quantity + 1) } : l));
      return [
        ...prev,
        { key: uuid(), productId: p.id, name: p.name, sku: p.sku, unit: p.unit, quantity: 1, rate: p.price, taxRate: p.tax_rate, isManual: false },
      ];
    });
    setSearch('');
  }

  function addManualLine() {
    setCart((prev) => [...prev, { key: uuid(), productId: null, name: '', sku: null, unit: 'pcs', quantity: 1, rate: 0, taxRate: 0, isManual: true }]);
  }

  const update = (key: string, patch: Partial<CartLine>) => setCart((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: string) => setCart((prev) => prev.filter((l) => l.key !== key));
  function stepQty(l: CartLine, dir: 1 | -1) {
    const step = isDecimalUnit(l.unit) ? 0.1 : 1;
    update(l.key, { quantity: round3(Math.max(step, l.quantity + dir * step)) });
  }

  async function scan() {
    const term = search.trim();
    if (!term) return;
    try {
      const p = await posLookupExact(term);
      if (p) addProduct(p);
      else showToast(`No product for "${term}"`, 'error');
    } catch (e) {
      showToast(apiError(e), 'error');
    }
  }

  function validate(): string | null {
    if (!cart.length) return 'Add at least one item.';
    for (const l of cart) {
      if (!l.name.trim()) return 'A manual item needs a name.';
      if (!(l.quantity > 0)) return 'Quantity must be greater than 0.';
    }
    return null;
  }

  function payload(status: 'completed' | 'held'): CreateBillPayload {
    return {
      status,
      idempotencyKey: idemKey.current,
      customer: {
        ...(custName.trim() ? { name: custName.trim() } : {}),
        ...(custMobile.trim() ? { mobile: custMobile.trim() } : {}),
      },
      items: cart.map((l) => ({
        productId: l.productId,
        name: l.name.trim(),
        unit: l.unit,
        quantity: l.quantity,
        rate: l.isManual ? l.rate : undefined,
        taxRate: l.isManual ? l.taxRate : undefined,
        isManual: l.isManual,
      })),
      discount: clampedDiscount,
      payment: { method: payMethod },
    };
  }

  function reset() {
    setCart([]);
    setDiscount('');
    setCustName('');
    setCustMobile('');
    setPayMethod('cash');
    idemKey.current = uuid();
  }

  async function charge() {
    const err = validate();
    if (err) return showToast(err, 'error');
    try {
      const res = await createBill.mutateAsync(payload('completed'));
      showToast(res.idempotent ? `Bill ${res.bill.bill_no} (already saved)` : `✅ Bill ${res.bill.bill_no} saved`, 'success');
      const billNo = res.bill.bill_no;
      reset();
      if (billNo) router.push(`/admin/pos-bill/${billNo}`);
    } catch (e) {
      showToast(apiError(e), 'error');
    }
  }

  async function hold() {
    const err = validate();
    if (err) return showToast(err, 'error');
    try {
      const res = await holdBill.mutateAsync(payload('held'));
      showToast(`Bill held (#${res.bill.id})`, 'info');
      reset();
    } catch (e) {
      showToast(apiError(e), 'error');
    }
  }

  const busy = createBill.isPending || holdBill.isPending;
  const showResults = useMemo(() => search.trim().length > 0, [search]);

  if (!allowed) return <Screen header={<StoreHeader back title="New Bill" />}><Card><Text style={ui.muted}>Checking access…</Text></Card></Screen>;

  return (
    <Screen header={<StoreHeader back title="🧾 New Bill (POS)" />}>
      <Card>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Field label="" placeholder="🔎 Search or scan — name, SKU, barcode" value={search} onChangeText={setSearch} autoCapitalize="none" returnKeyType="search" onSubmitEditing={scan} style={{ marginBottom: 0 }} />
          </View>
          <Button small title="Add" onPress={scan} style={{ marginBottom: 12 }} />
        </View>
        <Button small outline title="➕ Manual item" onPress={addManualLine} />

        {showResults && (
          <View style={{ marginTop: 10 }}>
            {isFetching && results.length === 0 ? (
              <Text style={ui.muted}>Searching…</Text>
            ) : results.length === 0 ? (
              <Text style={ui.muted}>No matching products.</Text>
            ) : (
              results.map((p) => (
                <Pressable key={p.id} onPress={() => addProduct(p)} style={st.resultRow} accessibilityRole="button">
                  <View style={{ flex: 1 }}>
                    <Text style={ui.bodyStrong}>{p.name}</Text>
                    <Text style={ui.muted}>{p.sku ? `SKU ${p.sku} · ` : ''}Stock {p.stock} {p.unit}</Text>
                  </View>
                  <Text style={ui.price}>{money(p.price)}</Text>
                </Pressable>
              ))
            )}
          </View>
        )}
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Text style={ui.h3}>Current Bill</Text>
        {cart.length === 0 ? (
          <Text style={[ui.muted, { marginTop: 8 }]}>No items yet. Search and add products above.</Text>
        ) : (
          cart.map((l) => (
            <View key={l.key} style={st.cartLine}>
              <View style={{ flex: 1 }}>
                {l.isManual ? (
                  <TextInput value={l.name} onChangeText={(t) => update(l.key, { name: t })} placeholder="Item name" placeholderTextColor="#a3928a" style={st.inlineInput} />
                ) : (
                  <Text style={ui.bodyStrong}>{l.name}</Text>
                )}
                {l.isManual ? (
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                    <TextInput value={String(l.rate)} onChangeText={(t) => update(l.key, { rate: Number(t) || 0 })} keyboardType="decimal-pad" placeholder="Rate" placeholderTextColor="#a3928a" style={[st.inlineInput, { width: 70 }]} />
                    <TextInput value={l.unit} onChangeText={(t) => update(l.key, { unit: t })} placeholder="unit" placeholderTextColor="#a3928a" style={[st.inlineInput, { width: 56 }]} />
                  </View>
                ) : (
                  <Text style={ui.muted}>{money(l.rate)} / {l.unit}</Text>
                )}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 }}>
                  <Stepper qty={l.quantity} onMinus={() => stepQty(l, -1)} onPlus={() => stepQty(l, 1)} label={l.name} />
                  {isDecimalUnit(l.unit) && (
                    <TextInput value={String(l.quantity)} onChangeText={(t) => update(l.key, { quantity: round3(Math.max(0, Number(t) || 0)) })} keyboardType="decimal-pad" style={[st.inlineInput, { width: 70 }]} />
                  )}
                  <Text style={{ marginLeft: 'auto', fontWeight: '800', color: colors.dark }}>{money(lineTotal(l))}</Text>
                  <Pressable onPress={() => remove(l.key)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove item">
                    <Text style={{ color: colors.accent, fontSize: 18 }}>✕</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ))
        )}
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Field label="Customer name (optional)" value={custName} onChangeText={setCustName} />
        <Field label="Mobile (optional)" value={custMobile} onChangeText={(t) => setCustMobile(t.replace(/\D/g, ''))} keyboardType="phone-pad" maxLength={10} />
        <Field label="Discount ₹" value={discount} onChangeText={(t) => setDiscount(t.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" />

        <Text style={ui.label}>Payment</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          {(['cash', 'upi', 'other'] as const).map((m) => (
            <Button key={m} small outline={payMethod !== m} title={m === 'cash' ? '💵 Cash' : m === 'upi' ? '📲 UPI' : '🔁 Other'} onPress={() => setPayMethod(m)} style={{ flex: 1 }} />
          ))}
        </View>

        <View style={st.totals}>
          <Row label="Subtotal" value={money(subtotal)} />
          {clampedDiscount > 0 && <Row label="Discount" value={`− ${money(clampedDiscount)}`} />}
          {taxTotal > 0 && <Row label="Tax" value={money(taxTotal)} />}
          <Row label="Payable" value={money(grandTotal)} bold />
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <Button title="Hold" outline onPress={hold} disabled={busy || !cart.length} style={{ flex: 0.5 }} />
          <GradientButton title={busy ? 'Saving…' : `Charge ${money(grandTotal)}`} loading={busy} onPress={charge} disabled={!cart.length} style={{ flex: 1 }} />
        </View>
      </Card>
    </Screen>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
      <Text style={bold ? ui.totalText : ui.muted}>{label}</Text>
      <Text style={bold ? ui.totalText : { color: colors.dark }}>{value}</Text>
    </View>
  );
}

const st = {
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0e6d8' },
  cartLine: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f3ece0' },
  inlineInput: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#fff', color: colors.dark },
  totals: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, marginTop: 4 },
} as const;
