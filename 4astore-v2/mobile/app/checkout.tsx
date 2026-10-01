import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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

  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [landmark, setLandmark] = useState('');
  const [city, setCity] = useState('');
  const [pincode, setPincode] = useState('824301');
  const [label, setLabel] = useState<Label>('Other');
  const [errors, setErrors] = useState<Set<string>>(new Set());

  const [saved, setSaved] = useState<SavedAddress[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [villageOpen, setVillageOpen] = useState(false);
  const [savingAddr, setSavingAddr] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [customer, setCustomer] = useState<any>(null);

  useEffect(() => {
    if (ready && !user) router.replace({ pathname: '/login', params: { next: '/checkout' } } as never);
  }, [ready, user]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user) return;
    setName((v) => v || user.name || '');
    setMobile((v) => v || user.mobile || '');
    setEmail((v) => v || user.recovery_email || user.email || '');
  }, [user]);

  async function loadAddresses() {
    try {
      const d = await api.get('/addresses');
      const list = (d.addresses || []) as SavedAddress[];
      setSaved(list);
      return list;
    } catch {
      return [];
    }
  }
  useEffect(() => {
    if (!user || !items.length) return;
    (async () => {
      const list = await loadAddresses();
      if (list.length) fill(list.find((a) => Number(a.is_default) === 1) || list[0]);
      else setEditorOpen(true);
    })();
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function fill(a: SavedAddress) {
    setSelectedId(a.id);
    setName(a.receiver_name || '');
    setMobile(a.phone || '');
    setAddress(a.house_no || '');
    setLandmark(a.landmark || '');
    setCity(a.city || '');
    setPincode(a.pincode || '824301');
    setLabel((a.label as Label) || 'Other');
  }

  const mark = (k: string) => setErrors((p) => new Set(p).add(k));
  const villageMatches = useMemo(() => {
    const t = city.trim().toLowerCase();
    return t ? villages.filter((v) => v.toLowerCase().includes(t)) : villages;
  }, [city, villages]);

  function buildCustomer(villageLabel: string) {
    const sel = saved.find((a) => a.id === selectedId);
    const hasCoords = sel && sel.latitude != null && Number.isFinite(Number(sel.latitude));
    const coords = hasCoords ? { lat: Number(sel!.latitude), lng: Number(sel!.longitude) } : resolveDeliveryCoordinates(settings, address.trim(), villageLabel, pincode.trim());
    return {
      name: name.trim(), mobile: mobile.replace(/\D+/g, ''), email: email.trim(), address: address.trim(),
      landmark: landmark.trim(), city: villageLabel, pincode: pincode.trim(),
      deliveryLat: coords.lat, deliveryLng: coords.lng, deliverySource: 'manual' as const,
    };
  }

  async function saveAddress(c: any, lbl: Label) {
    const payload = {
      action: selectedId ? 'update' : 'create', id: selectedId ?? undefined, label: lbl,
      receiver_name: c.name, phone: c.mobile, house_no: c.address, landmark: c.landmark, city: c.city,
      district: 'Aurangabad', state: 'Bihar', pincode: c.pincode, latitude: c.deliveryLat, longitude: c.deliveryLng,
      full_address: [c.address, c.city, c.pincode].filter(Boolean).join(', '),
    };
    return (await api.post('/addresses', payload)).address as SavedAddress;
  }

  async function saveFromEditor() {
    const m = mobile.replace(/\D+/g, '');
    if (!name.trim() || !/^[6-9]\d{9}$/.test(m) || !address.trim() || !city.trim() || pincode.trim() !== '824301') {
      return showToast('कृपया नाम, मोबाइल, पूरा पता, गाँव और सही पिन कोड भरें।', 'error');
    }
    const v = verifyVillage(city, villages);
    if (v.status !== 'exact') return showToast('Select a village from the list / कृपया सूची में से गाँव चुनें।', 'error');
    setCity(v.match);
    setSavingAddr(true);
    try {
      const c = buildCustomer(v.match);
      const s = await saveAddress(c, label);
      setSelectedId(s?.id ?? selectedId);
      setEditorOpen(false);
      await loadAddresses();
      showToast('Address saved / पता सहेजा गया।', 'success');
    } catch (e) {
      showToast(`${apiError(e)} / पता सहेजा नहीं जा सका।`, 'error');
    } finally {
      setSavingAddr(false);
    }
  }

  async function proceed() {
    setErrors(new Set());
    const m = mobile.replace(/\D+/g, '');
    if (!address.trim()) { setEditorOpen(true); return showToast('डिलीवरी का पता भरें।', 'info'); }
    let valid = true;
    if (!name.trim()) { mark('name'); valid = false; }
    if (!/^[6-9]\d{9}$/.test(m)) { mark('mobile'); valid = false; }
    if (!city.trim()) { mark('city'); valid = false; }
    if (pincode.trim() !== '824301') { mark('pincode'); valid = false; showToast('🚀 Delivery केवल पिन 824301 पर उपलब्ध है।', 'error'); }
    if (!valid) { setEditorOpen(true); return showToast('कृपया सभी ज़रूरी जानकारी भरें।', 'error'); }

    const vr = verifyVillage(city, villages);
    if (vr.status === 'invalid') { mark('city'); setEditorOpen(true); return showToast(`❌ "${city}" में डिलीवरी नहीं है। गाँव: ${villages.join(', ')}`, 'error'); }
    if (vr.status === 'suggest') { setCity(vr.match); mark('city'); setEditorOpen(true); return showToast(`🔎 क्या आपका मतलब "${vr.match}" है? ठीक किया है, फिर पुष्टि करें।`, 'info'); }
    setCity(vr.match);

    if (cartHasAgeRestricted(items, products, categories)) {
      const ok = await showConfirm('आपके कार्ट में आयु-प्रतिबंधित सामान है। तंबाकू से कैंसर होता है। क्या आपकी उम्र 18+ है?', { title: 'Age confirmation', confirmText: 'Yes, continue' });
      if (!ok) return showToast('18+ hone par hi ye item order ho sakta hai.', 'error');
    }

    const c = buildCustomer(vr.match);
    try {
      const s = await saveAddress(c, label);
      if (s?.id) setSelectedId(s.id);
    } catch { /* non-blocking, same as web */ }
    setCustomer(c);
    setPayOpen(true);
  }

  async function confirmOrder(utr: string, screenshot: string): Promise<string | null> {
    if (!customer) return 'Customer details missing';
    setPlacing(true);
    try {
      const payload = {
        order: {
          customer, addressLabel: label,
          items: items.map((i) => ({ id: Number(i.id), name: i.name, weight: i.weight ?? '', price: Number(i.price), quantity: i.quantity })),
          subtotal: totals.subtotal, discount: totals.discount, deliveryCharge: totals.deliveryCharge, totalAmount: totals.total,
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
  const addr = [address, city, pincode].filter(Boolean).join(', ');

  return (
    <Screen header={<StoreHeader back title="📝 Checkout / ऑर्डर विवरण" />}>
      <Card>
        <Text style={ui.h3}>🏠 Delivery Details / डिलीवरी का विवरण</Text>
        <View style={{ backgroundColor: '#e8f5e9', borderRadius: radius.sm, padding: 12, marginVertical: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '800', color: colors.dark }}>📍 Deliver to / यहाँ डिलीवरी</Text>
              <Text style={{ color: '#555', marginTop: 4 }}>{selectedId ? `${label}\n${addr}` : address ? addr : 'नया address भरें'}</Text>
            </View>
            <Button small outline title="बदलें / Edit" onPress={() => setEditorOpen(true)} />
          </View>
        </View>
      </Card>

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
          <SummaryRow label="Delivery" value={totals.deliveryCharge === 0 ? 'FREE' : `₹${totals.deliveryCharge}`} />
          <View style={ui.divider} />
          <SummaryRow label="Total" value={`₹${totals.total}`} bold />
        </View>
      </Card>

      <GradientButton title="📱 Proceed to UPI Payment / UPI भुगतान जारी रखें →" onPress={proceed} style={{ marginTop: 18 }} />

      {/* Address editor */}
      <Modal visible={editorOpen} animationType="slide" onRequestClose={() => setEditorOpen(false)}>
        <Screen header={<StoreHeader back title="डिलीवरी का पता भरें" />}>
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
                  <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 180 }}>
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
              {(['Home', 'Work', 'Other'] as Label[]).map((l) => (
                <Button key={l} small outline={label !== l} title={l === 'Home' ? '🏠 Home' : l === 'Work' ? '🏢 Work' : '📍 Other'} onPress={() => setLabel(l)} style={{ flex: 1 }} />
              ))}
            </View>
            <GradientButton title={savingAddr ? '⏳ Saving…' : '💾 Save Address / पता सहेजें'} loading={savingAddr} onPress={saveFromEditor} style={{ marginTop: 16 }} />
          </Card>
        </Screen>
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
  dropdown: { position: 'absolute', top: 70, left: 0, right: 0, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, zIndex: 20, elevation: 6 },
  vopt: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#f6eadb' },
});
