import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useCart } from '../../store/cart';
import { useAuth } from '../../store/auth';
import { useProducts, useCategories, useSettings } from '../../lib/queries';
import { api, apiError } from '../../lib/api';
import { showToast } from '../../store/toast';
import { showConfirm } from '../../store/confirm';
import {
  cartTotals,
  cartHasAgeRestricted,
  getServiceableVillages,
  verifyVillage,
} from '../../lib/checkout';
import type { SavedAddress, Settings } from '../../types';
import PaymentModal from './PaymentModal';
import { productImageSrc, onProductImageError } from '../../lib/productImage';
import Portal from '../../components/Portal';
import OrderSuccess, { PlacedOrder } from './OrderSuccess';
import './checkout.css';

type Label = 'Home' | 'Work' | 'Other';
type FieldKey = 'name' | 'mobile' | 'address' | 'city' | 'pincode';

interface CustomerInfo {
  name: string;
  mobile: string;
  email: string;
  address: string;
  landmark: string;
  city: string;
  pincode: string;
  deliveryLat: number;
  deliveryLng: number;
  deliverySource: 'manual';
}

/** Original resolveDeliveryCoordinates(): known local names → store point, else a small stable offset. */
function resolveDeliveryCoordinates(settings: Settings | undefined, address: string, city: string, pincode: string) {
  const lat = Number(settings?.storeLatitude ?? 24.580164);
  const lng = Number(settings?.storeLongitude ?? 84.114194);
  const text = `${address} ${city} ${pincode}`.toLowerCase();
  const known = ['chandargarh', 'chandragarh', 'nabinagar', 'gajana', 'gajna', 'aurangabad', 'bihar', '824301'];
  if (known.some((k) => text.includes(k))) return { lat, lng };
  const seed = text.split('').reduce((s, ch) => s + ch.charCodeAt(0), 0);
  return {
    lat: Number((lat + ((seed % 17) - 8) / 10000).toFixed(6)),
    lng: Number((lng + ((seed % 19) - 9) / 10000).toFixed(6)),
  };
}

export default function Checkout() {
  const navigate = useNavigate();
  const { user, ready } = useAuth();
  const { items, clear } = useCart();
  const products = useProducts().data ?? [];
  const categories = useCategories().data ?? [];
  const settings = useSettings().data;
  const villages = useMemo(() => getServiceableVillages(settings), [settings]);
  const totals = cartTotals(items, products, settings, user);

  // ---- form fields (same ids/labels as the original page) ----
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [landmark, setLandmark] = useState('');
  const [city, setCity] = useState('');
  const [pincode, setPincode] = useState('824301');
  const [label, setLabel] = useState<Label>('Other');
  const [errors, setErrors] = useState<Set<FieldKey>>(new Set());

  // ---- saved addresses ----
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [addressesLoaded, setAddressesLoaded] = useState(false);
  const [selectedAddressId, setSelectedAddressId] = useState<number | null>(null);
  const [selectedText, setSelectedText] = useState<{ label: string; text: string } | null>(null);
  const [panelVisible, setPanelVisible] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [addressSearch, setAddressSearch] = useState('');
  const [villageOpen, setVillageOpen] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const [statusText, setStatusText] = useState('पता स्वयं भरें।');
  const addressFieldRef = useRef<HTMLTextAreaElement | null>(null);
  const cityWrapRef = useRef<HTMLDivElement | null>(null);

  // ---- payment / success ----
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);

  const markError = (key: FieldKey) => setErrors((prev) => new Set(prev).add(key));
  const fg = (key: FieldKey) => `form-group${errors.has(key) ? ' error' : ''}`;

  // Login is required (original: requireLogin()).
  useEffect(() => {
    if (ready && !user) navigate('/login?next=/checkout');
  }, [ready, user, navigate]);

  // Prefill customer (original: loadSavedCustomer()).
  useEffect(() => {
    if (!user) return;
    setName((v) => v || user.name || '');
    setMobile((v) => v || user.mobile || '');
    setEmail((v) => v || user.recovery_email || user.email || '');
  }, [user]);

  // Lock page scroll while any modal is open.
  useEffect(() => {
    const open = pickerOpen || editorOpen || payOpen;
    document.body.classList.toggle('modal-open', open);
    return () => document.body.classList.remove('modal-open');
  }, [pickerOpen, editorOpen, payOpen]);

  // Close the village dropdown when clicking outside it.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (cityWrapRef.current && !cityWrapRef.current.contains(e.target as Node)) setVillageOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  async function loadSavedAddresses(): Promise<SavedAddress[]> {
    try {
      const { data } = await api.get('/addresses');
      const list = (data.addresses || []) as SavedAddress[];
      setSavedAddresses(list);
      return list;
    } catch {
      setSavedAddresses([]);
      return [];
    } finally {
      setAddressesLoaded(true);
    }
  }

  function fillFromAddress(a: SavedAddress) {
    setSelectedAddressId(a.id);
    setName(a.receiver_name || '');
    setMobile(a.phone || '');
    setAddress(a.house_no || '');
    setLandmark(a.landmark || '');
    setCity(a.city || '');
    setPincode(a.pincode || '824301');
    setLabel((a.label as Label) || 'Other');
    setSelectedText({ label: a.label, text: a.full_address || '' });
  }

  function selectSavedAddress(a: SavedAddress) {
    fillFromAddress(a);
    setAddressSearch('');
    setPickerOpen(false);
  }

  function openNewAddress(announce = true, list = savedAddresses) {
    setSelectedAddressId(null);
    setAddress('');
    setLandmark('');
    setCity('');
    setPincode('824301');
    setLabel('Other');
    setSelectedText({ label: '', text: 'नया address नीचे भरें' });
    setPanelVisible(list.length > 0);
    setPickerOpen(false);
    setEditorOpen(true);
    setTimeout(() => addressFieldRef.current?.focus(), 80);
    if (announce) showToast('नया डिलीवरी पता भरें और ऑर्डर के साथ सहेजें।', 'info');
  }

  function editSavedAddress(a: SavedAddress) {
    fillFromAddress(a);
    setPickerOpen(false);
    setEditorOpen(true);
  }

  /** Original prepareManualAddressMode(): pick default saved address, else open the editor. */
  async function prepareManualAddressMode(openPicker = true) {
    const list = addressesLoaded ? savedAddresses : await loadSavedAddresses();
    if (!list.length) {
      setPanelVisible(false);
      openNewAddress(false, list);
      return;
    }
    setPanelVisible(true);
    const preferred = list.find((a) => Number(a.is_default) === 1) || list[0];
    fillFromAddress(preferred);
    if (openPicker) setPickerOpen(true);
  }

  // First load: saved address → show summary panel; none → manual mode (opens editor).
  useEffect(() => {
    if (!user || !items.length) return;
    (async () => {
      const list = await loadSavedAddresses();
      if (list.length) {
        const preferred = list.find((a) => Number(a.is_default) === 1) || list[0];
        fillFromAddress(preferred);
        setPanelVisible(true);
      } else {
        setStatusText('आपके चुने हुए पते पर डिलीवरी होगी।');
        openNewAddress(false, list);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  function toggleAddressPicker() {
    if (!savedAddresses.length) return openNewAddress();
    setAddressSearch('');
    setPickerOpen(true);
  }

  function chooseManualMode() {
    setStatusText('आपके चुने हुए पते पर डिलीवरी होगी।');
    void prepareManualAddressMode();
  }

  // ---- village combobox ----
  const villageMatches = useMemo(() => {
    const t = city.trim().toLocaleLowerCase();
    return t ? villages.filter((v) => v.toLocaleLowerCase().includes(t)) : villages;
  }, [city, villages]);

  function selectVillage(v: string) {
    setCity(v);
    setVillageOpen(false);
    setErrors((prev) => {
      const next = new Set(prev);
      next.delete('city');
      return next;
    });
  }

  function onVillageKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!villageOpen) return;
    if (e.key === 'Enter' && villageMatches.length) {
      e.preventDefault();
      selectVillage(villageMatches[0]);
    } else if (e.key === 'Escape') {
      setVillageOpen(false);
    }
  }

  // ---- saving an address (same payload shape as the original saveCheckoutAddress) ----
  async function saveAddress(c: CustomerInfo, lbl: Label) {
    const payload = {
      action: selectedAddressId ? 'update' : 'create',
      id: selectedAddressId ?? undefined,
      label: lbl,
      receiver_name: c.name,
      phone: c.mobile,
      house_no: c.address,
      landmark: c.landmark,
      city: c.city,
      district: 'Aurangabad',
      state: 'Bihar',
      pincode: c.pincode,
      latitude: c.deliveryLat,
      longitude: c.deliveryLng,
      full_address: [c.address, c.city, c.pincode].filter(Boolean).join(', '),
    };
    const { data } = await api.post('/addresses', payload);
    return data.address as SavedAddress;
  }

  function buildCustomer(villageLabel: string): CustomerInfo {
    const selected = savedAddresses.find((a) => a.id === selectedAddressId);
    const hasSavedCoords = selected && Number.isFinite(Number(selected.latitude)) && Number.isFinite(Number(selected.longitude)) && selected.latitude !== null;
    const coords = hasSavedCoords
      ? { lat: Number(selected!.latitude), lng: Number(selected!.longitude) }
      : resolveDeliveryCoordinates(settings, address.trim(), villageLabel, pincode.trim());
    return {
      name: name.trim(),
      mobile: mobile.replace(/\D+/g, ''),
      email: email.trim(),
      address: address.trim(),
      landmark: landmark.trim(),
      city: villageLabel,
      pincode: pincode.trim(),
      deliveryLat: coords.lat,
      deliveryLng: coords.lng,
      deliverySource: 'manual',
    };
  }

  /** Original saveAddressFromEditor(). */
  async function saveAddressFromEditor() {
    const cleanMobile = mobile.replace(/\D+/g, '');
    if (!name.trim() || !/^[6-9]\d{9}$/.test(cleanMobile) || !address.trim() || !city.trim() || pincode.trim() !== '824301') {
      showToast('Please fill in your name, mobile, full address, village and PIN code / कृपया नाम, मोबाइल, पूरा पता, गाँव और सही पिन कोड भरें।', 'error');
      return;
    }
    const village = verifyVillage(city, villages);
    if (village.status !== 'exact') {
      showToast('Select a village from the available list / कृपया सूची में से गाँव चुनें।', 'error');
      return;
    }
    setCity(village.match);
    setSavingAddress(true);
    try {
      const c = buildCustomer(village.match);
      const saved = await saveAddress(c, label);
      setCustomerInfo(c);
      setSelectedAddressId(saved?.id ?? selectedAddressId);
      setSelectedText({ label, text: [c.address, c.city, c.pincode].join(', ') });
      setPanelVisible(true);
      setEditorOpen(false);
      void loadSavedAddresses();
      showToast('Address saved successfully / पता सफलतापूर्वक सहेजा गया।', 'success');
    } catch (e) {
      showToast(`${apiError(e)} / पता सहेजा नहीं जा सका।`, 'error');
    } finally {
      setSavingAddress(false);
    }
  }

  /** Original proceedToPayment(): validate, verify village, 18+ check, save address, open UPI modal. */
  async function proceedToPayment() {
    setErrors(new Set());
    const cleanMobile = mobile.replace(/\D+/g, '');

    if (!address.trim()) {
      markError('address');
      await prepareManualAddressMode();
      showToast('डिलीवरी का पता चुनें या नया पता जोड़ें।', 'info');
      return;
    }

    let valid = true;
    if (!name.trim()) { markError('name'); valid = false; }
    if (!/^[6-9]\d{9}$/.test(cleanMobile)) { markError('mobile'); valid = false; }
    if (!city.trim()) { markError('city'); valid = false; }
    if (pincode.trim() !== '824301') {
      markError('pincode');
      showToast('🚀 Delivery is available only for PIN 824301 / डिलीवरी केवल पिन कोड 824301 पर उपलब्ध है।', 'error');
      valid = false;
    }
    if (!valid) {
      showToast('Please fill in all required fields / कृपया सभी ज़रूरी जानकारी भरें।', 'error');
      if (!editorOpen) setEditorOpen(true);
      return;
    }

    // Village verification with spelling auto-correct (original behaviour).
    const vr = verifyVillage(city, villages);
    if (vr.status === 'invalid') {
      markError('city');
      setEditorOpen(true);
      showToast(`❌ Delivery is unavailable in "${city}". Available villages / "${city}" में डिलीवरी उपलब्ध नहीं है। डिलीवरी वाले गाँव: ${villages.join(', ')}`, 'error');
      return;
    }
    if (vr.status === 'suggest') {
      setCity(vr.match);
      markError('city');
      setEditorOpen(true);
      showToast(`🔎 Did you mean "${vr.match}"? We corrected it; please confirm again / क्या आपका मतलब "${vr.match}" है? नाम ठीक किया है, कृपया फिर से पुष्टि करें।`, 'info');
      return;
    }
    setCity(vr.match);

    if (cartHasAgeRestricted(items, products, categories)) {
      const okAge = await showConfirm('Your cart contains an age-restricted item. Tobacco causes cancer. Are you 18 or older? / आपके कार्ट में आयु-प्रतिबंधित सामान है। तंबाकू से कैंसर होता है। क्या आपकी उम्र 18 वर्ष या उससे अधिक है?', {
        title: 'Age confirmation', confirmText: 'Yes, continue',
      });
      if (!okAge) {
        showToast('You must be 18 or older to order this item / इस सामान का ऑर्डर देने के लिए आपकी उम्र 18 वर्ष या उससे अधिक होनी चाहिए।', 'error');
        return;
      }
    }

    const c = buildCustomer(vr.match);
    try {
      const saved = await saveAddress(c, label);
      if (saved?.id) setSelectedAddressId(saved.id);
    } catch (e) {
      if (selectedAddressId) {
        showToast('Saved address could not be updated. Please try again / सहेजा हुआ पता अपडेट नहीं हुआ। कृपया फिर से कोशिश करें।', 'error');
        return;
      }
      // A new address that fails to save doesn't block the order (same as the original).
      console.warn('Address save failed:', apiError(e));
    }
    setCustomerInfo(c);
    setPayOpen(true);
  }

  /** Called by the payment modal once a 12-digit UTR was detected from the screenshot. */
  async function confirmOrder(utr: string, screenshot: string): Promise<string | null> {
    if (!customerInfo) return 'Customer details missing';
    setPlacing(true);
    try {
      const payload = {
        order: {
          customer: customerInfo,
          addressLabel: label,
          items: items.map((i) => ({ id: Number(i.id), name: i.name, weight: i.weight ?? '', price: Number(i.price), quantity: i.quantity })),
          subtotal: totals.subtotal,
          discount: totals.discount,
          deliveryCharge: totals.deliveryCharge,
          totalAmount: totals.total,
          paymentMethod: 'UPI',
          paymentReference: utr,
        },
      };
      const { data } = await api.post('/orders', payload);
      const orderId = data.order.order_id as string;
      // Screenshot upload is best-effort (the original also uploaded it asynchronously).
      api.post(`/orders/${encodeURIComponent(orderId)}/screenshot`, { image: screenshot }).catch(() =>
        console.warn('Screenshot upload failed')
      );
      setPlaced({
        orderId,
        customer: customerInfo,
        items: payload.order.items,
        totalAmount: totals.total,
        deliveryAddress: [customerInfo.address, customerInfo.city, customerInfo.pincode].filter(Boolean).join(', '),
      });
      clear();
      setPayOpen(false);
      window.scrollTo({ top: 0 });
      return null;
    } catch (e) {
      return apiError(e);
    } finally {
      setPlacing(false);
    }
  }

  // ---------------- render ----------------

  if (placed) return <OrderSuccess order={placed} storePhone={settings?.storePhone} />;

  if (!items.length) {
    return (
      <div className="checkout-page">
        <Helmet><title>Checkout - 4A Store</title></Helmet>
        <div className="empty-cart">
          <div className="empty-icon">🛒</div>
          <h3>Your cart is empty / आपका कार्ट खाली है</h3>
          <p>Add items to your cart before checkout / चेकआउट से पहले कार्ट में सामान जोड़ें।</p>
          <Link to="/products" className="btn-primary">Browse Products / सामान देखें →</Link>
        </div>
      </div>
    );
  }

  const byId = new Map(products.map((p) => [Number(p.id), p]));
  const filteredAddresses = savedAddresses.filter((a) => {
    const q = addressSearch.trim().toLowerCase();
    return !q || [a.label, a.full_address, a.landmark, a.city, a.pincode].some((v) => String(v || '').toLowerCase().includes(q));
  });

  return (
    <div className="checkout-page">
      <Helmet><title>Checkout - 4A Store</title></Helmet>
      <h2 style={{ marginBottom: 20 }}>📝 Checkout / ऑर्डर विवरण</h2>

      <div className="checkout-form">
        <h3>🏠 Delivery Details / डिलीवरी का विवरण</h3>

        <div className="location-choice-card">
          <strong>डिलीवरी का पता कैसे चुनेंगे?</strong>
          <div className="location-choice-actions">
            <button type="button" onClick={chooseManualMode} style={{ background: '#e8f5e9' }}>✍️ पता स्वयं भरें</button>
          </div>
          <div id="deliveryLocationStatus" style={{ color: statusText.startsWith('आपके') ? '#2e7d32' : undefined }}>{statusText}</div>
        </div>

        {panelVisible && (
          <div className="address-summary">
            <div className="address-summary-head">
              <strong>📍 Deliver to / यहाँ डिलीवरी करें</strong>
              {savedAddresses.length > 0 && (
                <button type="button" className="address-change-btn" onClick={toggleAddressPicker}>Change / बदलें ▾</button>
              )}
            </div>
            <div style={{ fontSize: 13, color: '#555' }}>
              {selectedText?.label && <><strong>{selectedText.label}</strong><br /></>}
              {selectedText?.text}
            </div>
          </div>
        )}

        <Portal>
        {/* Saved address picker */}
        <div className={`address-picker-modal${pickerOpen ? ' open' : ''}`} onClick={(e) => e.target === e.currentTarget && setPickerOpen(false)}>
          <div className="address-picker-sheet" role="dialog" aria-modal="true" aria-label="डिलीवरी का पता चुनें">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div>
                <h3>डिलीवरी का पता चुनें</h3>
                <p style={{ margin: 0, color: 'var(--gray)', fontSize: 12 }}>सहेजा हुआ पता चुनें या नया पता जोड़ें</p>
              </div>
              <button type="button" aria-label="पता सूची बंद करें" onClick={() => setPickerOpen(false)} style={{ border: 0, background: 'none', fontSize: 24, color: 'var(--gray)', cursor: 'pointer' }}>×</button>
            </div>
            <input className="address-search" type="search" placeholder="🔎 घर, काम या गाँव का पता खोजें" value={addressSearch} onChange={(e) => setAddressSearch(e.target.value)} />
            <div className="address-picker-list">
              {filteredAddresses.length ? (
                filteredAddresses.map((a) => (
                  <div
                    key={a.id}
                    className={`address-option${a.id === selectedAddressId ? ' selected' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => selectSavedAddress(a)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && selectSavedAddress(a)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                      <span style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                        <input type="radio" name="savedAddressChoice" readOnly checked={a.id === selectedAddressId} style={{ marginTop: 3, accentColor: 'var(--primary)' }} aria-label={a.label} />
                        <span>
                          <strong>{a.label}</strong>
                          <br />
                          <span style={{ fontSize: 12, color: '#666' }}>{a.full_address}</span>
                        </span>
                      </span>
                      <button type="button" onClick={(e) => { e.stopPropagation(); editSavedAddress(a); }} style={{ border: 0, background: 'none', color: 'var(--primary-dark)', fontWeight: 800, cursor: 'pointer', padding: 2 }}>बदलें</button>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ padding: 14, textAlign: 'center', color: 'var(--gray)', fontSize: 13 }}>कोई मिलता-जुलता पता नहीं मिला।</div>
              )}
              <button type="button" className="address-new-btn" onClick={() => openNewAddress()}>＋ नया पता जोड़ें</button>
            </div>
          </div>
        </div>

        {/* Address editor */}
        <div className={`address-editor-modal${editorOpen ? ' open' : ''}`} onClick={(e) => e.target === e.currentTarget && setEditorOpen(false)}>
          <div className="address-editor-sheet" role="dialog" aria-modal="true" aria-label="डिलीवरी का पता भरें">
            <div className="address-editor-head">
              <div>
                <h3>डिलीवरी का पता भरें</h3>
                <p>पता सहेजें ताकि अगली बार जल्दी ऑर्डर कर सकें</p>
              </div>
              <button type="button" onClick={() => setEditorOpen(false)} aria-label="पता फ़ॉर्म बंद करें">×</button>
            </div>
            <div className="address-editor-content">
              <div className="form-row">
                <div className={fg('name')}>
                  <label htmlFor="custName">Full Name (पूरा नाम) *</label>
                  <input type="text" id="custName" placeholder="Enter your full name / अपना पूरा नाम लिखें" value={name} onChange={(e) => setName(e.target.value)} />
                  <div className="error-msg">Please enter your name / कृपया अपना नाम लिखें</div>
                </div>
                <div className={fg('mobile')}>
                  <label htmlFor="custMobile">Mobile Number (मोबाइल नंबर) *</label>
                  <input type="tel" id="custMobile" placeholder="10-digit mobile number / 10 अंकों का मोबाइल नंबर" maxLength={10} value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))} />
                  <div className="error-msg">Enter a valid 10-digit mobile number / कृपया सही 10 अंकों का मोबाइल नंबर लिखें</div>
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="custEmail">Email Address (ईमेल)</label>
                <input type="email" id="custEmail" placeholder="Email (optional) / ईमेल (वैकल्पिक)" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className={fg('address')}>
                <label htmlFor="custAddress">Complete Address (पूरा पता) *</label>
                <textarea id="custAddress" ref={addressFieldRef} rows={3} placeholder="घर नंबर, टोला/मोहल्ला, गाँव और सड़क का पूरा पता लिखें" value={address} onChange={(e) => setAddress(e.target.value)} />
                <div className="error-msg">Please enter your address / कृपया अपना पूरा पता लिखें</div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="custLandmark">Landmark (पास की मशहूर जगह)</label>
                  <input type="text" id="custLandmark" placeholder="जैसे — स्कूल के पास, मंदिर के बगल में, चौक के पास" value={landmark} onChange={(e) => setLandmark(e.target.value)} />
                </div>
                <div className={fg('city')} style={{ position: 'relative' }} ref={cityWrapRef}>
                  <label htmlFor="custCity">Village (गाँव) *</label>
                  <input
                    type="text"
                    id="custCity"
                    placeholder="🔎 गाँव का नाम लिखें या सूची से चुनें"
                    autoComplete="off"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-controls="villageDropdown"
                    aria-expanded={villageOpen}
                    value={city}
                    onChange={(e) => { setCity(e.target.value); setVillageOpen(true); }}
                    onFocus={() => setVillageOpen(true)}
                    onKeyDown={onVillageKeyDown}
                  />
                  <div id="villageDropdown" className={`village-dropdown${villageOpen ? ' open' : ''}`} role="listbox">
                    {villageMatches.length ? (
                      villageMatches.map((v) => (
                        <button key={v} type="button" className="village-option" role="option" aria-selected={v === city} onClick={() => selectVillage(v)}>📍 {v}</button>
                      ))
                    ) : (
                      <div className="village-empty">❌ This village is not serviceable / इस गाँव में डिलीवरी उपलब्ध नहीं है</div>
                    )}
                  </div>
                  <div className="error-msg">Please select your village / कृपया अपना गाँव चुनें</div>
                </div>
              </div>
              <div className={fg('pincode')}>
                <label htmlFor="custPincode">PIN Code (पिन कोड) *</label>
                <input type="text" id="custPincode" placeholder="6-digit PIN Code / 6 अंकों का पिन कोड" maxLength={6} value={pincode} onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))} />
                <div className="error-msg">Delivery is available only for PIN Code 824301 / डिलीवरी केवल पिन कोड 824301 पर उपलब्ध है</div>
              </div>
              <fieldset className="address-label-options">
                <legend>Address label / पते का प्रकार</legend>
                {([['Home', '🏠 Home / घर'], ['Work', '🏢 Work / काम'], ['Other', '📍 Other / अन्य']] as [Label, string][]).map(([value, text]) => (
                  <label key={value}>
                    <input type="radio" name="addressLabel" value={value} checked={label === value} onChange={() => setLabel(value)} /> {text}
                  </label>
                ))}
              </fieldset>
            </div>
            <div className="address-editor-actions">
              <button type="button" className="save-address-btn" onClick={saveAddressFromEditor} disabled={savingAddress}>
                {savingAddress ? '⏳ Saving… / सहेजा जा रहा है…' : '💾 Save Address / पता सहेजें'}
              </button>
            </div>
          </div>
        </div>
        </Portal>

        {/* Order summary (same markup as the original renderOrderSummary) */}
        <div className="order-summary-checkout" style={{ marginTop: 20 }}>
          <h4 style={{ marginBottom: 12 }}>📦 Order Summary / ऑर्डर का सारांश</h4>
          {items.map((item) => {
            const catalog = byId.get(item.id);
            const imgProduct = { id: item.id, name: item.name, weight: item.weight, category: item.category || catalog?.category, image: item.image || catalog?.image };
            return (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', fontSize: 14, borderBottom: '1px solid var(--border)' }}>
                <img src={productImageSrc(imgProduct)} alt={item.name} style={{ width: 48, height: 48, objectFit: 'contain', borderRadius: 7, background: '#f7fafc' }} onError={onProductImageError(imgProduct)} />
                <span style={{ flex: 1 }}>{item.name} × {item.quantity}</span>
                <span>₹{Number(item.price) * item.quantity}</span>
              </div>
            );
          })}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontSize: 13, color: 'var(--gray)' }}><span>Subtotal</span><span>₹{totals.subtotal}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, color: 'var(--primary)' }}><span>Discount</span><span>-₹{totals.discount}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}><span>Delivery</span><span>{totals.deliveryCharge === 0 ? 'FREE' : `₹${totals.deliveryCharge}`}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0 0', fontSize: 18, fontWeight: 700, borderTop: '2px solid var(--border)', marginTop: 8, color: 'var(--primary-dark)' }}><span>Total</span><span>₹{totals.total}</span></div>
        </div>

        <button className="btn-checkout" onClick={proceedToPayment} style={{ marginTop: 20 }}>
          📱 Proceed to UPI Payment / UPI भुगतान जारी रखें →
        </button>
      </div>

      {payOpen && customerInfo && (
        <Portal>
        <PaymentModal
          total={totals.total}
          customerName={customerInfo.name}
          upiId={settings?.upiId || 'Q623952089@ybl'}
          upiName={settings?.upiName || '4A Store'}
          busy={placing}
          onConfirm={confirmOrder}
          onCancel={() => setPayOpen(false)}
        />
        </Portal>
      )}
    </div>
  );
}
