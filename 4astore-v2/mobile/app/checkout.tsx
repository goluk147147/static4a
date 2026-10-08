import React, { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import StoreHeader from '../src/components/StoreHeader';
import ProductImage from '../src/components/ProductImage';
import PaymentSheet from '../src/components/PaymentSheet';
import { Button, Card, Field, GradientButton, Screen, SummaryRow, styles as ui } from '../src/components/ui';
import { useAuth } from '../src/store/auth';
import { useCart } from '../src/store/cart';
import { useProducts, useCategories, useSettings } from '../src/queries';
import { api, apiError, ApiError } from '../src/api';
import { loadLocal, saveLocal, upsertLocal, syncFromServer, queuePending, flushPending } from '../src/store/addresses';
import { buildAddressPayload } from '../src/addressPayload';
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
  // Issue 2: when the account already has a known email, show it as confirmed/read-only
  // with a small "change" affordance that flips to the editable Field. Email stays
  // OPTIONAL and never blocks proceed().
  const [emailEditing, setEmailEditing] = useState(false);
  const knownEmail = (user?.recovery_email || user?.email || '').trim();

  const [saved, setSaved] = useState<SavedAddress[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [villageOpen, setVillageOpen] = useState(false);
  const [savingAddr, setSavingAddr] = useState(false);
  const [loadingAddr, setLoadingAddr] = useState(true);
  const [payOpen, setPayOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [customer, setCustomer] = useState<any>(null);

  // Editor keyboard handling: own the editor's ScrollView so the focused Village field can be
  // scrolled above the Android soft keyboard (the field sits far down the form). `villageY` is the
  // field wrapper's y-offset captured on layout; `onFocus` scrolls to it so the field + its in-flow
  // dropdown stay visible above the keyboard and the options are scrollable/tappable.
  const editorScroll = useRef<ScrollView | null>(null);
  const villageY = useRef(0);

  useEffect(() => {
    if (ready && !user) router.replace({ pathname: '/login', params: { next: '/checkout' } } as never);
  }, [ready, user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Account switched (logout → login as someone else while this screen stayed mounted):
  // wipe the previous account's form + address state so it is never shown or submitted.
  const formOwner = useRef<number | null>(null);
  useEffect(() => {
    const id = user?.id ?? null;
    if (formOwner.current !== null && formOwner.current !== id) {
      setName(''); setMobile(''); setEmail(''); setAddress(''); setLandmark(''); setCity('');
      setPincode('824301'); setLabel('Other'); setSaved([]); setSelectedId(null);
      setCustomer(null); setPayOpen(false); setEmailEditing(false); setLoadingAddr(true);
    }
    formOwner.current = id;
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    // Only a real 10-digit mobile is a usable default (Google accounts start with a `g<digits>` placeholder).
    const ownMobile = /^[6-9]\d{9}$/.test(user.mobile || '') ? user.mobile : '';
    setName((v) => v || user.name || '');
    setMobile((v) => v || ownMobile || '');
    setEmail((v) => v || user.recovery_email || user.email || '');
  }, [user]);

  useEffect(() => {
    if (!user || !items.length) return;
    const userId = user.id;
    let cancelled = false;
    (async () => {
      // Local-first: serve the last-known addresses INSTANTLY, no network await.
      const list = await loadLocal(userId);
      if (cancelled) return;
      setSaved(list);
      if (list.length) fill(list.find((a) => Number(a.is_default) === 1) || list[0]);
      else setEditorOpen(true);
      setLoadingAddr(false);

      // Background: refresh from server and flush any writes queued while offline.
      // Keep the current selection if that address still exists on the server.
      syncFromServer(userId).then((srv) => {
        if (cancelled || !srv) return;
        setSaved(srv);
        setSelectedId((prev) => (prev != null && !srv.some((a) => a.id === prev) ? (srv[0]?.id ?? null) : prev));
      });
      flushPending(userId).then((flushed) => {
        if (cancelled || !flushed) return;
        setSaved(flushed);
      });
    })();
    return () => {
      cancelled = true;
    };
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

  async function saveFromEditor() {
    const m = mobile.replace(/\D+/g, '');
    if (!name.trim() || !/^[6-9]\d{9}$/.test(m) || !address.trim() || !city.trim() || pincode.trim() !== '824301') {
      return showToast('कृपया नाम, मोबाइल, पूरा पता, गाँव और सही पिन कोड भरें।', 'error');
    }
    const v = verifyVillage(city, villages);
    if (v.status !== 'exact') return showToast('Select a village from the list / कृपया सूची में से गाँव चुनें।', 'error');
    setCity(v.match);
    if (!user) return;
    const userId = user.id;

    setSavingAddr(true);
    const c = buildCustomer(v.match);
    // Optimistic local row: reuse the selected id on edit, else a NEGATIVE temp id.
    const addr: SavedAddress = {
      id: selectedId ?? -Date.now(),
      label,
      receiver_name: c.name,
      phone: c.mobile,
      house_no: c.address,
      landmark: c.landmark,
      city: c.city,
      pincode: c.pincode,
      latitude: c.deliveryLat,
      longitude: c.deliveryLng,
      full_address: [c.address, c.city, c.pincode].filter(Boolean).join(', '),
    };
    const list = await upsertLocal(userId, addr);
    setSaved(list);
    setSelectedId(addr.id);
    setEditorOpen(false);
    setSavingAddr(false);
    showToast('Address saved / पता सहेजा गया।', 'success');

    // Fire the server write in the background — never block the Save button on it.
    // A NEGATIVE id is an optimistic temp row the server has never seen, so it must go
    // up as a CREATE with id:undefined — never send a temp id to the server.
    const payload = buildAddressPayload(c, label, selectedId);
    api.post('/addresses', payload)
      .then(async (res) => {
        const serverAddr = res.address as SavedAddress;
        if (!serverAddr) return;
        // Reconcile: drop the optimistic temp row, keep the server's real one.
        const current = await loadLocal(userId);
        const next = [serverAddr, ...current.filter((a) => a.id !== addr.id && a.id !== serverAddr.id)];
        await saveLocal(userId, next);
        setSaved(next);
        setSelectedId((prev) => (prev === addr.id ? serverAddr.id : prev));
      })
      .catch(() => queuePending(userId, payload));
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

    // Persist an inline-entered address that was never explicitly "Save Address"-ed:
    // when no POSITIVE selectedId exists (null or a negative temp), save it exactly
    // like saveFromEditor so the saved list is not empty on the next visit. When an
    // existing saved address (selectedId > 0) was chosen, nothing is re-saved.
    // The network write is NOT awaited — payment still opens instantly.
    if (user && !(selectedId != null && selectedId > 0)) {
      const userId = user.id;
      const addr: SavedAddress = {
        id: selectedId ?? -Date.now(),
        label,
        receiver_name: c.name,
        phone: c.mobile,
        house_no: c.address,
        landmark: c.landmark,
        city: c.city,
        pincode: c.pincode,
        latitude: c.deliveryLat,
        longitude: c.deliveryLng,
        full_address: [c.address, c.city, c.pincode].filter(Boolean).join(', '),
      };
      const list = await upsertLocal(userId, addr);
      setSaved(list);
      setSelectedId(addr.id);

      const payload = buildAddressPayload(c, label, selectedId);
      api.post('/addresses', payload)
        .then(async (res) => {
          const serverAddr = res.address as SavedAddress;
          if (!serverAddr) return;
          // Reconcile: drop the optimistic temp row, keep the server's real one.
          const current = await loadLocal(userId);
          const next = [serverAddr, ...current.filter((a) => a.id !== addr.id && a.id !== serverAddr.id)];
          await saveLocal(userId, next);
          setSaved(next);
          setSelectedId((prev) => (prev === addr.id ? serverAddr.id : prev));
        })
        .catch(() => queuePending(userId, payload));
    }

    // Proceed must open payment instantly, never network-block.
    setCustomer(c);
    setPayOpen(true);
  }

  async function confirmOrder(utr: string, screenshot: string): Promise<string | null> {
    if (!customer) return 'Customer details missing';
    setPlacing(true);
    // Generate the orderId on the CLIENT (same shape the server uses: '4A' + 8 uppercase hex) so a
    // slow create can be recovered idempotently — the server upserts on o.orderId, so a retry is an
    // upsert, not a 409 "payment reference already used".
    const clientOrderId = '4A' + genHex8();
    const orderItems = items.map((i) => ({ id: Number(i.id), name: i.name, weight: i.weight ?? '', price: Number(i.price), quantity: i.quantity }));
    try {
      const payload = {
        order: {
          orderId: clientOrderId,
          customer, addressLabel: label,
          items: orderItems,
          subtotal: totals.subtotal, discount: totals.discount, deliveryCharge: totals.deliveryCharge, handlingCharge: totals.handlingCharge, totalAmount: totals.total,
          paymentMethod: 'UPI', paymentReference: utr,
        },
      };
      // Raise the order-placement POST timeout to 30 s (all other requests stay at 15 s) so a
      // slow-but-successful create isn't aborted mid-flight.
      const d = await api.post('/orders', payload, { timeoutMs: 30000 });
      const orderId = d.order.order_id as string;
      navigateToSuccess(orderId, orderItems, screenshot);
      return null;
    } catch (e) {
      // On a timeout/abort (ApiError status 0), the order may well have been created server-side.
      // Do a bounded idempotent recovery: GET the order by the client-generated id; if it exists,
      // treat the placement as SUCCESS instead of showing a false timeout.
      if (e instanceof ApiError && e.status === 0) {
        try {
          const r = await api.get(`/orders/${encodeURIComponent(clientOrderId)}`);
          if (r?.order?.order_id) {
            navigateToSuccess(r.order.order_id as string, orderItems, screenshot);
            return null;
          }
        } catch {
          // Recovery lookup failed too → fall through to the normal timeout/retry message.
        }
      }
      return apiError(e);
    } finally {
      setPlacing(false);
    }
  }

  // Shared success path: fire-and-forget the screenshot upload, clear the cart, close the sheet,
  // and navigate to /order-success. Used by both the normal success and the timeout-recovery path.
  function navigateToSuccess(orderId: string, orderItems: unknown, screenshot: string) {
    api.post(`/orders/${encodeURIComponent(orderId)}/screenshot`, { image: screenshot }).catch(() => null);
    clear();
    setPayOpen(false);
    router.replace({ pathname: '/order-success', params: { orderId, name: customer.name, total: String(totals.total), address: [customer.address, customer.city, customer.pincode].filter(Boolean).join(', '), items: JSON.stringify(orderItems) } } as never);
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
          {settings?.deliveryChargeEnabled !== false && (
            <SummaryRow label="Delivery" value={totals.deliveryCharge === 0 ? 'FREE' : `₹${totals.deliveryCharge}`} />
          )}
          {totals.handlingCharge > 0 && <SummaryRow label="Handling charge" value={`₹${totals.handlingCharge}`} />}
          <View style={ui.divider} />
          <SummaryRow label="Total" value={`₹${totals.total}`} bold />
        </View>
      </Card>

      <GradientButton title="📱 Proceed to UPI Payment / UPI भुगतान जारी रखें →" onPress={proceed} disabled={loadingAddr} style={{ marginTop: 18 }} />

      {/* Address editor — owns its own KeyboardAvoidingView + ScrollView (instead of the shared
          `Screen`) so the focused Village field can be scrolled above the Android soft keyboard. */}
      <Modal visible={editorOpen} animationType="slide" onRequestClose={() => setEditorOpen(false)}>
        <View style={{ flex: 1, backgroundColor: colors.lightGray }}>
          <StoreHeader back title="डिलीवरी का पता भरें" />
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView
              ref={editorScroll}
              contentContainerStyle={{ padding: 14, paddingBottom: 32 }}
              keyboardShouldPersistTaps="handled"
            >
              <Card>
                <Field label="Full Name (पूरा नाम) *" value={name} onChangeText={setName} error={fg('name')} errorText="कृपया अपना नाम लिखें" />
                <Field label="Mobile Number (मोबाइल) *" value={mobile} onChangeText={(t) => setMobile(t.replace(/\D/g, ''))} keyboardType="phone-pad" maxLength={10} error={fg('mobile')} errorText="सही 10 अंकों का मोबाइल नंबर" />
                {knownEmail && !emailEditing ? (
                  <View style={{ marginBottom: 12 }}>
                    <Text style={[ui.muted, { marginBottom: 6 }]}>Email (ईमेल)</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <Text style={{ flex: 1, color: colors.dark }}>✅ {email || knownEmail}</Text>
                      <Button small outline title="बदलें / change" onPress={() => setEmailEditing(true)} />
                    </View>
                  </View>
                ) : (
                  <Field label="Email (ईमेल)" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
                )}
                <Field label="Complete Address (पूरा पता) *" value={address} onChangeText={setAddress} multiline error={fg('address')} errorText="कृपया अपना पूरा पता लिखें" placeholder="घर नंबर, टोला/मोहल्ला, गाँव और सड़क" />
                <Field label="Landmark (पास की जगह)" value={landmark} onChangeText={setLandmark} placeholder="जैसे — स्कूल के पास" />
                <View
                  style={{ marginBottom: 12 }}
                  onLayout={(e) => { villageY.current = e.nativeEvent.layout.y; }}
                >
                  <Field
                    label="Village (गाँव) *"
                    value={city}
                    onChangeText={(t) => { setCity(t); setVillageOpen(true); }}
                    onFocus={() => {
                      setVillageOpen(true);
                      // Lift the focused Village field (and its in-flow dropdown) above the keyboard.
                      setTimeout(() => editorScroll.current?.scrollTo({ y: Math.max(villageY.current - 8, 0), animated: true }), 50);
                    }}
                    error={fg('city')}
                    errorText="कृपया अपना गाँव चुनें"
                    placeholder="🔎 गाँव का नाम लिखें या चुनें"
                  />
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
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
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

// 8 uppercase hex chars — matches the server's crypto.randomBytes(4).toString('hex').toUpperCase().
function genHex8(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += Math.floor(Math.random() * 16).toString(16).toUpperCase();
  return s;
}

const st = StyleSheet.create({
  dropdown: { marginTop: 4, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, zIndex: 20, elevation: 6 },
  vopt: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#f6eadb' },
});
