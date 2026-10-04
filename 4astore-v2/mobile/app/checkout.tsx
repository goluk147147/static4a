import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import StoreHeader from '../src/components/StoreHeader';
import ProductImage from '../src/components/ProductImage';
import PaymentSheet from '../src/components/PaymentSheet';
import { Button, Card, Field, GradientButton, Screen, SummaryRow, styles as ui } from '../src/components/ui';
import { useAuth } from '../src/store/auth';
import { useCart } from '../src/store/cart';
import { useProducts, useCategories, useSettings } from '../src/queries';
import { api, apiError } from '../src/api';
import { showToast, showConfirm } from '../src/store/ui';
import { cartTotals, cartHasAgeRestricted, getServiceableVillages, verifyVillage, resolveDeliveryCoordinates } from '../src/checkout';
import { DEFAULT_UPI_ID } from '../src/config';
import { colors, radius } from '../src/theme';
import type { SavedAddress } from '../src/types';

type Label = 'Home' | 'Work' | 'Other';
const LABELS: Label[] = ['Home', 'Work', 'Other'];
const labelIcon = (l: string) => (l === 'Home' ? '🏠' : l === 'Work' ? '🏢' : '📍');

export default function Checkout() {
  const router = useRouter();
  const { user, ready } = useAuth();
  const { items, clear } = useCart();
  const products = useProducts().data ?? [];
  const categories = useCategories().data ?? [];
  const settings = useSettings().data;
  const villages = useMemo(() => getServiceableVillages(settings), [settings]);
  const totals = cartTotals(items, products, settings, user);
  const byId = useMemo(() => new Map(products.map((p) => [Number(p.id), p])), [products]);

  // Saved address list + which one is selected for this order.
  const [saved, setSaved] = useState<SavedAddress[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loadingAddr, setLoadingAddr] = useState(true);

  // Editor form (used for both "add new" and "edit existing").
  const [editorOpen, setEditorOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null); // null = creating new
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [landmark, setLandmark] = useState('');
  const [city, setCity] = useState('');
  const [pincode, setPincode] = useState('824301');
  const [label, setLabel] = useState<Label>('Home');
  const [errors, setErrors] = useState<Set<string>>(new Set());
  const [villageOpen, setVillageOpen] = useState(false);

  const [savingAddr, setSavingAddr] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [proceeding, setProceeding] = useState(false);
  const [customer, setCustomer] = useState<any>(null);

  const selected = useMemo(() => saved.find((a) => a.id === selectedId) || null, [saved, selectedId]);

  useEffect(() => {
    if (ready && !user) router.replace({ pathname: '/login', params: { next: '/checkout' } } as never);
  }, [ready, user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load saved addresses once (per user). Keeps selection; opens the editor only if none exist.
  async function loadAddresses(selectFirst = false): Promise<SavedAddress[]> {
    try {
      const d = await api.get('/addresses');
      const list = (d.addresses || []) as SavedAddress[];
      setSaved(list);
      if (selectFirst && list.length) {
        const def = list.find((a) => Number(a.is_default) === 1) || list[0];
        setSelectedId((cur) => cur ?? def.id);
      }
      return list;
    } catch (e) {
      showToast(apiError(e), 'error');
      return [];
    }
  }

  useEffect(() => {
    if (!user || !items.length) return;
    let cancelled = false;
    (async () => {
      setLoadingAddr(true);
      const list = await loadAddresses(true);
      if (cancelled) return;
      setLoadingAddr(false);
      if (!list.length) openNewEditor(); // nothing saved yet → straight to the form
    })();
    return () => { cancelled = true; };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const mark = (k: string) => setErrors((p) => new Set(p).add(k));
  const villageMatches = useMemo(() => {
    const t = city.trim().toLowerCase();
    return t ? villages.filter((v) => v.toLowerCase().includes(t)) : villages;
  }, [city, villages]);

  // ---- editor open helpers ----
  function openNewEditor() {
    setEditId(null);
    setErrors(new Set());
    setName(user?.name || '');
    setMobile(user?.mobile || '');
    setEmail(user?.recovery_email || user?.email || '');
    setAddress('');
    setLandmark('');
    setCity('');
    setPincode('824301');
    setLabel('Home');
    setVillageOpen(false);
    setEditorOpen(true);
  }
  function openEditEditor(a: SavedAddress) {
    setEditId(a.id);
    setErrors(new Set());
    setName(a.receiver_name || user?.name || '');
    setMobile(a.phone || user?.mobile || '');
    setEmail(user?.recovery_email || user?.email || '');
    setAddress(a.house_no || '');
    setLandmark(a.landmark || '');
    setCity(a.city || '');
    setPincode(a.pincode || '824301');
    setLabel((a.label as Label) || 'Other');
    setVillageOpen(false);
    setEditorOpen(true);
  }

  function buildCustomerFromAddress(a: SavedAddress) {
    const hasCoords = a.latitude != null && Number.isFinite(Number(a.latitude));
    const coords = hasCoords
      ? { lat: Number(a.latitude), lng: Number(a.longitude) }
      : resolveDeliveryCoordinates(settings, a.house_no || '', a.city || '', a.pincode || '824301');
    return {
      name: a.receiver_name || user?.name || '', mobile: (a.phone || user?.mobile || '').replace(/\D+/g, ''),
      email: user?.recovery_email || user?.email || '', address: a.house_no || '', landmark: a.landmark || '',
      city: a.city || '', pincode: a.pincode || '824301', deliveryLat: coords.lat, deliveryLng: coords.lng,
      deliverySource: 'manual' as const,
    };
  }

  // ---- save (create/update) from the editor ----
  async function saveFromEditor() {
    if (savingAddr) return;
    const m = mobile.replace(/\D+/g, '');
    setErrors(new Set());
    let ok = true;
    if (!name.trim()) { mark('name'); ok = false; }
    if (!/^[6-9]\d{9}$/.test(m)) { mark('mobile'); ok = false; }
    if (!address.trim()) { mark('address'); ok = false; }
    if (!city.trim()) { mark('city'); ok = false; }
    if (pincode.trim() !== '824301') { mark('pincode'); ok = false; }
    if (!ok) return showToast('कृपया नाम, मोबाइल, पूरा पता, गाँव और सही पिन कोड भरें।', 'error');

    const v = verifyVillage(city, villages);
    if (v.status === 'invalid') { mark('city'); return showToast(`❌ "${city}" में डिलीवरी नहीं है। गाँव: ${villages.join(', ')}`, 'error'); }
    if (v.status === 'suggest') { setCity(v.match); mark('city'); return showToast(`🔎 क्या आपका मतलब "${v.match}" है? ठीक किया है, फिर Save दबाएँ।`, 'info'); }
    const villageLabel = v.match;
    setCity(villageLabel);

    const coords = resolveDeliveryCoordinates(settings, address.trim(), villageLabel, pincode.trim());
    const payload = {
      action: editId ? 'update' : 'create', id: editId ?? undefined, label,
      receiver_name: name.trim(), phone: m, house_no: address.trim(), landmark: landmark.trim(), city: villageLabel,
      district: 'Aurangabad', state: 'Bihar', pincode: pincode.trim(), latitude: coords.lat, longitude: coords.lng,
      full_address: [address.trim(), villageLabel, pincode.trim()].filter(Boolean).join(', '),
    };

    setSavingAddr(true);
    try {
      const s = (await api.post('/addresses', payload)).address as SavedAddress;
      // Update the local list from the API's own response — no extra blocking GET.
      setSaved((prev) => {
        const rest = prev.filter((a) => a.id !== s.id);
        return [s, ...rest];
      });
      setSelectedId(s.id);
      setEditorOpen(false);
      showToast('✅ पता सहेजा गया / Address saved.', 'success');
      void loadAddresses(); // quiet background sync
    } catch (e) {
      showToast(apiError(e), 'error');
    } finally {
      setSavingAddr(false);
    }
  }

  // ---- proceed to payment ----
  async function proceed() {
    if (proceeding) return;
    if (!selected) {
      if (!saved.length) { openNewEditor(); return showToast('पहले डिलीवरी का पता जोड़ें।', 'info'); }
      return showToast('कृपया एक पता चुनें।', 'info');
    }
    if (selected.pincode !== '824301') return showToast('🚀 Delivery केवल पिन 824301 पर उपलब्ध है।', 'error');

    if (cartHasAgeRestricted(items, products, categories)) {
      const ok = await showConfirm('आपके कार्ट में आयु-प्रतिबंधित सामान है। तंबाकू से कैंसर होता है। क्या आपकी उम्र 18+ है?', { title: 'Age confirmation', confirmText: 'Yes, continue' });
      if (!ok) return showToast('18+ hone par hi ye item order ho sakta hai.', 'error');
    }

    // Selected address is ALREADY saved on the server → no slow save call here. Just build the
    // customer object and open payment instantly (fixes the "Proceed does nothing / slow" issue).
    setProceeding(true);
    try {
      setCustomer(buildCustomerFromAddress(selected));
      setPayOpen(true);
    } finally {
      setProceeding(false);
    }
  }

  async function confirmOrder(utr: string, screenshot: string): Promise<string | null> {
    if (!customer) return 'Customer details missing';
    setPlacing(true);
    try {
      const payload = {
        order: {
          customer, addressLabel: selected?.label || label,
          items: items.map((i) => ({ id: Number(i.id), name: i.name, weight: i.weight ?? '', price: Number(i.price), quantity: i.quantity })),
          subtotal: totals.subtotal, discount: totals.discount, deliveryCharge: totals.deliveryCharge, handlingCharge: totals.handlingCharge, totalAmount: totals.total,
          paymentMethod: 'UPI', paymentReference: utr,
        },
      };
      const d = await api.post('/orders', payload);
      const orderId = d.order.order_id as string;
      api.post(`/orders/${encodeURIComponent(orderId)}/screenshot`, { image: screenshot }).catch(() => null);
      clear();
      setPayOpen(false);
      router.replace({ pathname: '/order-success', params: { orderId, name: customer.name, total: String(totals.total), address: [customer.address, customer.city, customer.pincode].filter(Boolean).join(', '), items: JSON.stringify(payload.order.items) } } as never);
      return null;
    } catch (e) {
      return apiError(e);
    } finally {
      setPlacing(false);
    }
  }

  if (!items.length) {
    return (
      <Screen header={<StoreHeader back title="Checkout" />}>
        <Card style={{ alignItems: 'center', paddingVertical: 36 }}>
          <Text style={{ fontSize: 56 }}>🛒</Text>
          <Text style={ui.h3}>आपका कार्ट खाली है</Text>
          <GradientButton title="Browse Products / सामान देखें →" onPress={() => router.push('/products')} style={{ marginTop: 14 }} />
        </Card>
      </Screen>
    );
  }

  const fg = (k: string) => errors.has(k);

  return (
    <Screen header={<StoreHeader back title="📝 Checkout / ऑर्डर विवरण" />}>
      {/* ---- Saved addresses (choose one) + add new ---- */}
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <Text style={ui.h3}>🏠 Delivery Address / पता</Text>
          <Button small outline title="➕ Naya" onPress={openNewEditor} />
        </View>

        {loadingAddr ? (
          <View style={{ paddingVertical: 20, alignItems: 'center' }}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[ui.muted, { marginTop: 6 }]}>पते लोड हो रहे हैं…</Text>
          </View>
        ) : saved.length === 0 ? (
          <Pressable onPress={openNewEditor} style={st.addNew} accessibilityRole="button">
            <Text style={{ color: colors.primary, fontWeight: '800' }}>➕ Add delivery address / डिलीवरी पता जोड़ें</Text>
          </Pressable>
        ) : (
          saved.map((a) => {
            const active = a.id === selectedId;
            return (
              <Pressable key={a.id} onPress={() => setSelectedId(a.id)} style={[st.addr, active && st.addrActive]} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                <View style={[st.radio, active && st.radioOn]}>{active && <View style={st.radioDot} />}</View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '800', color: colors.dark }}>{labelIcon(a.label)} {a.label} · {a.receiver_name}</Text>
                  <Text style={{ color: '#555', marginTop: 2 }}>{[a.house_no, a.city, a.pincode].filter(Boolean).join(', ')}</Text>
                  {!!a.phone && <Text style={[ui.muted, { marginTop: 2 }]}>📞 {a.phone}</Text>}
                </View>
                <Button small outline title="✏️" onPress={() => openEditEditor(a)} />
              </Pressable>
            );
          })
        )}
      </Card>

      {/* ---- Order summary ---- */}
      <Card style={{ marginTop: 14 }}>
        <Text style={[ui.h3, { marginBottom: 10 }]}>📦 Order Summary / ऑर्डर का सारांश</Text>
        {items.map((i) => {
          const cat = byId.get(i.id);
          return (
            <View key={i.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <ProductImage name={i.name} weight={i.weight} category={i.category || cat?.category} image={i.image || cat?.image} height={44} style={{ width: 44 }} compact />
              <Text style={{ flex: 1, color: colors.dark }}>{i.name} × {i.quantity}</Text>
              <Text style={{ color: colors.dark }}>₹{Number(i.price) * i.quantity}</Text>
            </View>
          );
        })}
        <View style={{ marginTop: 8 }}>
          <SummaryRow label="Subtotal" value={`₹${totals.subtotal}`} />
          <SummaryRow label="Discount" value={`-₹${totals.discount}`} color={colors.primary} />
          {settings?.deliveryChargeEnabled !== false && (
            <SummaryRow label="Delivery" value={totals.deliveryCharge === 0 ? 'FREE' : `₹${totals.deliveryCharge}`} />
          )}
          {totals.handlingCharge > 0 && <SummaryRow label="Handling charge" value={`₹${totals.handlingCharge}`} />}
          <View style={ui.divider} />
          <SummaryRow label="Total" value={`₹${totals.total}`} bold />
        </View>
      </Card>

      <GradientButton
        title={proceeding ? '⏳ कृपया प्रतीक्षा करें…' : '📱 Proceed to UPI Payment / UPI भुगतान →'}
        onPress={proceed}
        loading={proceeding}
        disabled={proceeding || loadingAddr}
        style={{ marginTop: 18 }}
      />

      {/* ---- Address editor (add / edit) ---- */}
      <Modal visible={editorOpen} animationType="slide" onRequestClose={() => setEditorOpen(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Screen header={<StoreHeader back title={editId ? 'पता बदलें / Edit address' : 'नया पता / New address'} />} contentStyle={{ paddingBottom: 240 }}>
            <Card>
              <Field label="Full Name (पूरा नाम) *" value={name} onChangeText={setName} error={fg('name')} errorText="कृपया अपना नाम लिखें" />
              <Field label="Mobile Number (मोबाइल) *" value={mobile} onChangeText={(t) => setMobile(t.replace(/\D/g, ''))} keyboardType="phone-pad" maxLength={10} error={fg('mobile')} errorText="सही 10 अंकों का मोबाइल नंबर" />
              <Field label="Email (ईमेल)" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
              <Field label="Complete Address (पूरा पता) *" value={address} onChangeText={setAddress} multiline error={fg('address')} errorText="कृपया अपना पूरा पता लिखें" placeholder="घर नंबर, टोला/मोहल्ला, गाँव और सड़क" />
              <Field label="Landmark (पास की जगह)" value={landmark} onChangeText={setLandmark} placeholder="जैसे — स्कूल के पास" />
              <View style={{ marginBottom: 12 }}>
                <Field label="Village (गाँव) *" value={city} onChangeText={(t) => { setCity(t); setVillageOpen(true); }} onFocus={() => setVillageOpen(true)} error={fg('city')} errorText="कृपया अपना गाँव चुनें" placeholder="🔎 गाँव का नाम लिखें या चुनें" />
                {villageOpen && (
                  <View style={st.dropdown}>
                    <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={{ maxHeight: 200 }}>
                      {villageMatches.length ? villageMatches.map((v) => (
                        <Pressable key={v} onPress={() => { setCity(v); setVillageOpen(false); }} style={st.vopt} accessibilityRole="button"><Text style={{ color: colors.dark }}>📍 {v}</Text></Pressable>
                      )) : <Text style={{ padding: 12, color: colors.accent }}>❌ इस गाँव में डिलीवरी उपलब्ध नहीं है</Text>}
                    </ScrollView>
                  </View>
                )}
              </View>
              <Field label="PIN Code (पिन कोड) *" value={pincode} onChangeText={(t) => setPincode(t.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={6} error={fg('pincode')} errorText="डिलीवरी केवल पिन 824301 पर" />
              <Text style={[ui.muted, { marginBottom: 6 }]}>Address label / पते का प्रकार</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {LABELS.map((l) => (
                  <Button key={l} small outline={label !== l} title={`${labelIcon(l)} ${l}`} onPress={() => setLabel(l)} style={{ flex: 1 }} />
                ))}
              </View>
              <GradientButton title={savingAddr ? '⏳ Saving…' : '💾 Save Address / पता सहेजें'} loading={savingAddr} disabled={savingAddr} onPress={saveFromEditor} style={{ marginTop: 16 }} />
            </Card>
          </Screen>
        </KeyboardAvoidingView>
      </Modal>

      {payOpen && customer && (
        <PaymentSheet
          total={totals.total}
          customerName={customer.name}
          upiId={settings?.upiId || DEFAULT_UPI_ID}
          upiName={settings?.upiName || '4A Store'}
          busy={placing}
          onConfirm={confirmOrder}
          onCancel={() => setPayOpen(false)}
        />
      )}
    </Screen>
  );
}

const st = StyleSheet.create({
  addr: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, marginBottom: 8 },
  addrActive: { borderColor: colors.primary, backgroundColor: '#fff6ec' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  addNew: { padding: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.primary, borderRadius: radius.md, alignItems: 'center' },
  // In-flow (not absolute) so it pushes content and never hides behind the keyboard.
  dropdown: { marginTop: 4, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, elevation: 2, overflow: 'hidden' },
  vopt: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#f6eadb' },
});
