import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchAdminSettings, saveAdminSettings, fetchAnnouncement, saveAnnouncement, saveFestival, bumpCache, downloadText,
  AdminSettings as SettingsT,
} from '../../lib/admin';
import { apiError } from '../../lib/api';
import { useConfig, useProducts, useSettings } from '../../lib/queries';
import { usePages } from '../../lib/pages';
import { resolveFooter, saveFooter, resetFooter, FooterConfig } from '../../lib/footer';
import { FooterView } from '../../components/SiteFooter';
import { showToast } from '../../store/toast';
import { showConfirm } from '../../store/confirm';
import { useAdminOrders, useAdminUsers, ADMIN_ORDERS_KEY } from './adminData';

const SUBS = [
  { key: 'store', label: '🏪 Store & Payment' },
  { key: 'announce', label: '📢 Announcement' },
  { key: 'footer', label: '🦶 Footer' },
  { key: 'festival', label: '🎉 Festival' },
  { key: 'cache', label: '🔄 Cache / Update' },
  { key: 'data', label: '💾 Data' },
] as const;
type SubKey = (typeof SUBS)[number]['key'];

const STORE_FALLBACK = { latitude: 24.580164, longitude: 84.114194 }; // assets/js/store-location.js

const lbl: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--primary-dark)', marginBottom: 4 };
const inp: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '2px solid var(--border)', borderRadius: 8, fontSize: 14 };
const hint: React.CSSProperties = { fontSize: 11, color: 'var(--gray)', marginTop: 4 };
const albl: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--primary-dark)', marginBottom: 4 };

// Session-persistent sub tab (original `let settingsSub`).
let lastSub: SubKey = 'store';

function StoreSettings() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['admin-settings'], queryFn: fetchAdminSettings });
  const [s, setS] = useState<Record<keyof SettingsT, string | boolean> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    setS({
      storeEmail: data.storeEmail || '', deliveryCharge: String(data.deliveryCharge ?? 0), freeDeliveryAbove: String(data.freeDeliveryAbove ?? 0),
      upiId: data.upiId || '', upiName: data.upiName || '', hideMrp: !!data.hideMrp, storePhone: data.storePhone || '',
      storeAddress: data.storeAddress || '', storeLatitude: String(data.storeLatitude ?? STORE_FALLBACK.latitude),
      storeLongitude: String(data.storeLongitude ?? STORE_FALLBACK.longitude), serviceableVillages: data.serviceableVillages || '',
      handlingCharge: String(data.handlingCharge ?? 0),
      deliveryChargeEnabled: data.deliveryChargeEnabled !== false,
      handlingChargeEnabled: !!data.handlingChargeEnabled,
      staffOrderAlertsEnabled: data.staffOrderAlertsEnabled !== false,
    });
  }, [data]);

  if (isLoading || !s) return <p style={{ color: 'var(--gray)' }}>Loading settings...</p>;
  const set = (k: keyof SettingsT, v: string | boolean) => setS((c) => (c ? { ...c, [k]: v } : c));
  const str = (k: keyof SettingsT) => String(s[k] ?? '');

  async function save() {
    const email = str('storeEmail').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showToast('Please enter a valid email address', 'error');
    setBusy(true);
    try {
      await saveAdminSettings({
        storeEmail: email,
        deliveryCharge: Number(str('deliveryCharge')) || 0,
        freeDeliveryAbove: Number(str('freeDeliveryAbove')) || 0,
        handlingCharge: Number(str('handlingCharge')) || 0,
        deliveryChargeEnabled: !!s!.deliveryChargeEnabled,
        handlingChargeEnabled: !!s!.handlingChargeEnabled,
        staffOrderAlertsEnabled: !!s!.staffOrderAlertsEnabled,
        upiId: str('upiId').trim(),
        upiName: str('upiName').trim(),
        hideMrp: !!s!.hideMrp,
        storePhone: str('storePhone').trim(),
        storeAddress: str('storeAddress').trim(),
        storeLatitude: Number(str('storeLatitude')),
        storeLongitude: Number(str('storeLongitude')),
        serviceableVillages: str('serviceableVillages').trim(),
      });
      showToast('Store settings saved', 'success');
      qc.invalidateQueries({ queryKey: ['admin-settings'] });
      qc.invalidateQueries({ queryKey: ['settings'] });
    } catch (e) {
      showToast(apiError(e) || 'Failed to save settings', 'error');
    } finally {
      setBusy(false);
    }
  }

  const field = (k: keyof SettingsT, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}, note?: React.ReactNode, flex = 1, minWidth = 180) => (
    <div style={{ flex, minWidth }}>
      <label style={lbl} htmlFor={`set_${k}`}>{label}</label>
      <input id={`set_${k}`} value={str(k)} onChange={(e) => set(k, e.target.value)} style={inp} {...extra} />
      {note && <p style={hint}>{note}</p>}
    </div>
  );

  return (
    <>
      <h4 style={{ marginBottom: 6 }}>🏪 Store &amp; Payment Settings</h4>
      <p style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 16 }}>Order notification email, delivery charges and UPI payment details. These apply across the store.</p>
      <div style={{ maxWidth: 520, display: 'grid', gap: 14 }}>
        {field('storeEmail', '📧 Order Notification Email', { type: 'email', placeholder: 'you@example.com' }, 'New orders are automatically emailed to this address.')}

        {/* Charges — each fee has an on/off toggle so the shop can enable/disable it */}
        <div style={{ background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 10, padding: 14, display: 'grid', gap: 12 }}>
          <strong style={{ fontSize: 13, color: 'var(--primary-dark)' }}>💰 Charges</strong>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--primary-dark)' }}>
            <input type="checkbox" checked={!!s.deliveryChargeEnabled} onChange={(e) => set('deliveryChargeEnabled', e.target.checked)} style={{ width: 18, height: 18, cursor: 'pointer' }} />
            🚚 Delivery charge enabled
          </label>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', opacity: s.deliveryChargeEnabled ? 1 : 0.5 }}>
            {field('deliveryCharge', 'Delivery Fee (₹)', { type: 'number', min: 0, disabled: !s.deliveryChargeEnabled }, undefined, 1, 150)}
            {field('freeDeliveryAbove', 'Free Delivery Above (₹)', { type: 'number', min: 0, disabled: !s.deliveryChargeEnabled }, undefined, 1, 150)}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--primary-dark)', marginTop: 4 }}>
            <input type="checkbox" checked={!!s.handlingChargeEnabled} onChange={(e) => set('handlingChargeEnabled', e.target.checked)} style={{ width: 18, height: 18, cursor: 'pointer' }} />
            📦 Handling charge enabled
          </label>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', opacity: s.handlingChargeEnabled ? 1 : 0.5 }}>
            {field('handlingCharge', 'Handling Fee (₹)', { type: 'number', min: 0, disabled: !s.handlingChargeEnabled }, 'Har order par ek flat handling/packaging charge jodta hai.', 1, 150)}
          </div>
        </div>

        {/* Staff new-order loud alert toggle */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--primary-dark)', background: '#fff3e6', padding: 12, borderRadius: 8 }}>
          <input type="checkbox" checked={!!s.staffOrderAlertsEnabled} onChange={(e) => set('staffOrderAlertsEnabled', e.target.checked)} style={{ width: 18, height: 18, cursor: 'pointer' }} />
          🔔 Loud new-order alert (admin app) — beep + vibration
        </label>
        <p style={{ ...hint, marginTop: -6 }}>Off karne par naya order ki push aayegi par bina tez awaaz/vibration ke (silent channel).</p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {field('upiId', '💳 UPI ID', { placeholder: 'yourname@bank' }, <>Used for the payment QR code &amp; UPI app on checkout.</>)}
          {field('upiName', '🏷️ UPI Name (Payee)', { placeholder: '4astore' }, undefined, 1, 150)}
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {field('storePhone', '📞 Store Phone', { placeholder: '8210874123' }, <>Shown on ad creatives &amp; support.</>)}
          {field('storeAddress', '📍 Store Address', { placeholder: 'Gajana Road, Chandargarh...' }, undefined, 2, 220)}
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {field('storeLatitude', '📍 Store Latitude', { type: 'number', step: '0.000001' })}
          {field('storeLongitude', '📍 Store Longitude', { type: 'number', step: '0.000001' })}
        </div>
        <p style={{ ...hint, marginTop: -6 }}>यह fixed store origin delivery distance, rider ETA, navigation और maps में इस्तेमाल होगा।</p>
        {field('serviceableVillages', '🏡 Serviceable Villages / Gaon', { placeholder: 'Chandargarh, Nabinagar' }, 'Comma se alag karein. Checkout pe customer ka gaon verify hoga (spelling mistake auto-correct + toast).')}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--primary-dark)', background: '#fff3e6', padding: 12, borderRadius: 8 }}>
          <input type="checkbox" checked={!!s.hideMrp} onChange={(e) => set('hideMrp', e.target.checked)} style={{ width: 18, height: 18, cursor: 'pointer' }} />
          🙈 Hide MRP &amp; discount (Play Store pricing-safe mode)
        </label>
        <p style={{ ...hint, marginTop: -6 }}>On karne pe strike-through MRP aur discount % kahin nahi dikhega — sirf selling price. Play Store submit ke waqt safe rehta hai.</p>
        <button type="button" onClick={save} disabled={busy} style={{ justifySelf: 'start', padding: '11px 26px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          💾 {busy ? 'Saving…' : 'Save Store Settings'}
        </button>
      </div>
    </>
  );
}

function AnnouncementSettings() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['admin-announcement'], queryFn: fetchAnnouncement });
  const [a, setA] = useState({ text: '', image: '', target: 'all', ctaText: '', ctaLink: '', enabled: false });

  useEffect(() => {
    if (data) setA({ text: data.text || '', image: data.image || '', target: data.target || 'all', ctaText: data.ctaText || '', ctaLink: data.ctaLink || '', enabled: !!data.enabled });
  }, [data]);

  if (isLoading) return <p style={{ color: 'var(--gray)' }}>Loading announcement...</p>;

  const clearSwCaches = () => {
    if ('caches' in window) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => null);
  };

  async function save() {
    const payload = { ...a, text: a.text.trim(), image: a.image.trim(), target: a.target.trim() || 'all', ctaText: a.ctaText.trim(), ctaLink: a.ctaLink.trim() };
    if (!payload.text && !payload.image) return showToast('Please type a message or add an image', 'error');
    try {
      const res = await saveAnnouncement(payload);
      clearSwCaches();
      showToast(`📢 Saved (v${res.announcement.id})! Home page pe popup + voice dikhega.`, 'success');
      qc.invalidateQueries({ queryKey: ['admin-announcement'] });
      qc.invalidateQueries({ queryKey: ['announcement'] });
    } catch (e) {
      showToast(apiError(e) || 'Failed to save announcement', 'error');
    }
  }

  async function stop() {
    try {
      await saveAnnouncement({ text: '', image: '', target: 'all', ctaText: '', ctaLink: '', enabled: false });
      setA({ text: '', image: '', target: 'all', ctaText: '', ctaLink: '', enabled: false });
      showToast('🔇 Announcement stopped', 'info');
      qc.invalidateQueries({ queryKey: ['admin-announcement'] });
      qc.invalidateQueries({ queryKey: ['announcement'] });
    } catch (e) {
      showToast(apiError(e) || 'Failed (server error)', 'error');
    }
  }

  return (
    <>
      <h4 style={{ marginBottom: 6 }}>📢 Notification / Announcement (Popup + Voice)</h4>
      <p style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 12 }}>Home page khulte hi ek popup dikhega (image + text) aur voice bolega — web + app dono. Ek baar per message.</p>
      <div style={{ maxWidth: 560 }}>
        <label style={albl} htmlFor="annText">Message (text / voice)</label>
        <textarea id="annText" rows={3} value={a.text} onChange={(e) => setA({ ...a, text: e.target.value })} placeholder="Aaj ka offer! *20% OFF* sabhi hari sabziyon par."
          style={{ ...inp, fontFamily: 'inherit', resize: 'vertical' }} />
        <p style={hint}>💡 Kisi shabd ko highlight karne ke liye uske aage-piche star lagayein: <code>*20% OFF*</code></p>

        <label style={{ ...albl, margin: '10px 0 4px' }} htmlFor="annImage">Image URL (optional)</label>
        <input id="annImage" value={a.image} onChange={(e) => setA({ ...a, image: e.target.value })} placeholder="https://... (offer poster)" style={inp} />

        <label style={{ ...albl, margin: '10px 0 4px' }} htmlFor="annTarget">Kise bhejein?</label>
        <input id="annTarget" value={a.target} onChange={(e) => setA({ ...a, target: e.target.value })} placeholder="all (sabko) ya ek mobile number" style={inp} />
        <p style={hint}>"all" = sabhi users ko. Ya ek mobile number (jaise 9876543210) = sirf us user ko.</p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={albl} htmlFor="annCtaText">Button Text (optional)</label>
            <input id="annCtaText" value={a.ctaText} onChange={(e) => setA({ ...a, ctaText: e.target.value })} placeholder="Shop Now" style={inp} />
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={albl} htmlFor="annCtaLink">Button Link</label>
            <input id="annCtaLink" value={a.ctaLink} onChange={(e) => setA({ ...a, ctaLink: e.target.value })} placeholder="products.html ya https://..." style={inp} />
          </div>
        </div>
        <p style={hint}>Button dikhega tabhi jab text + link dono ho. Jaise "Shop Now" → products.html</p>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--primary-dark)', margin: '10px 0' }}>
          <input type="checkbox" checked={a.enabled} onChange={(e) => setA({ ...a, enabled: e.target.checked })} /> Chalu karein (enable)
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={save} style={{ padding: '10px 22px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>📢 Save &amp; Announce</button>
          <button type="button" onClick={stop} style={{ padding: '10px 22px', background: '#e53935', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>🔇 Stop Announcement</button>
        </div>
      </div>
    </>
  );
}

// Common footer shown on every storefront page (config.footer). Legal links: Admin → Pages.
function FooterSettings() {
  const qc = useQueryClient();
  const configQ = useConfig();
  const upiId = useSettings().data?.upiId || 'Q623952089@ybl';
  const legal = (usePages().data ?? []).filter((p) => p.showInFooter);
  const [f, setF] = useState<FooterConfig | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (configQ.data && !f) setF(resolveFooter(configQ.data.footer));
  }, [configQ.data, f]);

  if (configQ.isLoading || !f) return <p style={{ color: 'var(--gray)' }}>Loading footer...</p>;
  const set = <K extends keyof FooterConfig>(k: K, v: FooterConfig[K]) => setF((c) => (c ? { ...c, [k]: v } : c));
  const setLink = (i: number, k: 'label' | 'url', v: string) => set('links', f.links.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const moveLink = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= f.links.length) return;
    const next = [...f.links];
    [next[i], next[j]] = [next[j], next[i]];
    set('links', next);
  };

  async function save() {
    const clean: FooterConfig = {
      ...f!,
      links: f!.links.filter((l) => l.label.trim() || l.url.trim()).map((l) => ({ label: l.label.trim(), url: l.url.trim() })),
      deliveryLines: f!.deliveryLines.map((l) => l.trim()).filter(Boolean),
    };
    const bad = clean.links.find((l) => !l.label || !/^(\/(?!\/)|https?:\/\/|tel:|mailto:)/i.test(l.url));
    if (bad) return showToast(`Link "${bad.label || bad.url}": label zaroori hai, URL / ya https:// ya tel: se shuru ho`, 'error');
    setBusy(true);
    try {
      await saveFooter(clean);
      setF(clean);
      showToast('Footer saved — sabhi pages pe update ho gaya', 'success');
      qc.invalidateQueries({ queryKey: ['config'] });
    } catch (e) {
      showToast(apiError(e) || 'Failed to save footer', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    const ok = await showConfirm('Footer ko original default pe wapas le jaayein?', { title: 'Reset footer', confirmText: 'Reset' });
    if (!ok) return;
    try {
      await resetFooter();
      setF(resolveFooter(null));
      showToast('Footer reset to default', 'info');
      qc.invalidateQueries({ queryKey: ['config'] });
    } catch (e) {
      showToast(apiError(e) || 'Failed', 'error');
    }
  }

  const box: React.CSSProperties = { background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 14 };
  const small: React.CSSProperties = { ...inp, padding: '8px 10px', fontSize: 13 };
  const mini = (bg = '#eef1f4', color = '#333'): React.CSSProperties => ({ padding: '6px 9px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600, background: bg, color });

  return (
    <>
      <h4 style={{ marginBottom: 6 }}>🦶 Footer (sabhi pages pe common)</h4>
      <p style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 16 }}>
        Yahan badlav karte hi website ke har page ka footer update ho jaata hai. <strong>Legal &amp; Support</strong> ke links <strong>Admin → 📄 Pages</strong> se aate hain.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 14 }}>
        <div style={box}>
          <label style={albl} htmlFor="ft_aboutTitle">Column 1 — heading</label>
          <input id="ft_aboutTitle" value={f.aboutTitle} onChange={(e) => set('aboutTitle', e.target.value)} style={small} />
          <label style={{ ...albl, marginTop: 8 }} htmlFor="ft_aboutText">About text</label>
          <textarea id="ft_aboutText" rows={4} value={f.aboutText} onChange={(e) => set('aboutText', e.target.value)} style={{ ...small, fontFamily: 'inherit', resize: 'vertical' }} />
        </div>

        <div style={box}>
          <label style={albl} htmlFor="ft_addressTitle">Column 2 — heading</label>
          <input id="ft_addressTitle" value={f.addressTitle} onChange={(e) => set('addressTitle', e.target.value)} style={small} />
          <label style={{ ...albl, marginTop: 8 }} htmlFor="ft_addressText">Address (har line alag)</label>
          <textarea id="ft_addressText" rows={4} value={f.addressText} onChange={(e) => set('addressText', e.target.value)} style={{ ...small, fontFamily: 'inherit', resize: 'vertical' }} />
          <label style={{ ...albl, marginTop: 8 }} htmlFor="ft_phone">📞 Phone</label>
          <input id="ft_phone" value={f.phone} inputMode="tel" onChange={(e) => set('phone', e.target.value.replace(/[^0-9+ -]/g, ''))} style={small} />
        </div>

        <div style={box}>
          <label style={albl} htmlFor="ft_linksTitle">Column 3 — heading</label>
          <input id="ft_linksTitle" value={f.linksTitle} onChange={(e) => set('linksTitle', e.target.value)} style={small} />
          <div style={{ ...albl, marginTop: 8 }}>Links (label + URL, jaise /products ya https://...)</div>
          {f.links.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
              <input value={l.label} placeholder="Label" aria-label={`Link ${i + 1} label`} onChange={(e) => setLink(i, 'label', e.target.value)} style={{ ...small, flex: 1 }} />
              <input value={l.url} placeholder="/products" aria-label={`Link ${i + 1} URL`} onChange={(e) => setLink(i, 'url', e.target.value)} style={{ ...small, flex: 1 }} />
              <button type="button" title="Up" aria-label="Move up" onClick={() => moveLink(i, -1)} style={mini()}>↑</button>
              <button type="button" title="Down" aria-label="Move down" onClick={() => moveLink(i, 1)} style={mini()}>↓</button>
              <button type="button" title="Remove" aria-label="Remove link" onClick={() => set('links', f.links.filter((_, j) => j !== i))} style={mini('#fee2e2', '#b91c1c')}>✕</button>
            </div>
          ))}
          {f.links.length < 12 && <button type="button" onClick={() => set('links', [...f.links, { label: '', url: '/' }])} style={mini('var(--primary)', '#fff')}>➕ Add link</button>}
        </div>

        <div style={box}>
          <label style={albl} htmlFor="ft_legalTitle">Column 4 — heading</label>
          <input id="ft_legalTitle" value={f.legalTitle} onChange={(e) => set('legalTitle', e.target.value)} style={small} />
          <p style={hint}>Links: {legal.map((p) => p.title).join(', ') || '—'} (Admin → 📄 Pages se badlein)</p>

          <label style={{ ...albl, marginTop: 12 }} htmlFor="ft_deliveryTitle">Column 5 — heading</label>
          <input id="ft_deliveryTitle" value={f.deliveryTitle} onChange={(e) => set('deliveryTitle', e.target.value)} style={small} />
          <div style={{ ...albl, marginTop: 8 }}>Lines (<code>{'{{upiId}}'}</code> = Settings wali UPI ID)</div>
          {f.deliveryLines.map((line, i) => (
            <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
              <input value={line} aria-label={`Delivery line ${i + 1}`} onChange={(e) => set('deliveryLines', f.deliveryLines.map((x, j) => (j === i ? e.target.value : x)))} style={{ ...small, flex: 1 }} />
              <button type="button" aria-label="Remove line" onClick={() => set('deliveryLines', f.deliveryLines.filter((_, j) => j !== i))} style={mini('#fee2e2', '#b91c1c')}>✕</button>
            </div>
          ))}
          {f.deliveryLines.length < 8 && <button type="button" onClick={() => set('deliveryLines', [...f.deliveryLines, ''])} style={mini('var(--primary)', '#fff')}>➕ Add line</button>}

          <label style={{ ...albl, marginTop: 12 }} htmlFor="ft_copy">Copyright line (<code>{'{{year}}'}</code> = current year)</label>
          <input id="ft_copy" value={f.copyright} onChange={(e) => set('copyright', e.target.value)} style={small} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '16px 0' }}>
        <button type="button" onClick={save} disabled={busy} style={{ padding: '11px 26px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          💾 {busy ? 'Saving…' : 'Save Footer'}
        </button>
        <button type="button" onClick={reset} style={{ padding: '11px 20px', background: '#666', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}>↺ Reset to default</button>
      </div>

      <h4 style={{ margin: '8px 0' }}>👁️ Live preview</h4>
      <p style={{ ...hint, marginBottom: 8 }}>Phone (600px se chhoti screen) pe original design ki tarah footer chhupa rehta hai — wahan bottom menu dikhta hai.</p>
      <div style={{ borderRadius: 12, overflow: 'hidden', pointerEvents: 'none' }} aria-hidden="true">
        <FooterView footer={f} legal={legal} upiId={upiId} />
      </div>
    </>
  );
}

const FESTIVAL_OPTIONS: [string, string][] = [
  ['', '🏪 Default (No Festival)'], ['diwali', '🪔 Diwali'], ['navratri', '🕉️ Navratri'], ['eid', '☪️ Eid'],
  ['christmas', '🎄 Christmas / New Year'], ['holi', '🎨 Holi'], ['ipl', '🏏 IPL Season'], ['rakhi', '🪢 Raksha Bandhan'],
  ['independence', '🇮🇳 Independence Day'],
];

function FestivalSettings() {
  const qc = useQueryClient();
  const current = useConfig().data?.currentFestival || '';
  const [val, setVal] = useState(current);
  useEffect(() => setVal(current), [current]);

  async function save() {
    try {
      await saveFestival(val);
      showToast(`Festival updated to: ${val || 'Default'}`, 'success');
      qc.invalidateQueries({ queryKey: ['config'] });
    } catch (e) {
      showToast(apiError(e) || 'Failed to save festival', 'error');
    }
  }

  return (
    <>
      <h4 style={{ marginBottom: 6 }}>🎉 Festival / Theme Settings</h4>
      <p style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 16 }}>Change the current festival to show relevant banners on the homepage. Leave empty for default banners.</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20, maxWidth: 520 }}>
        <select value={val} onChange={(e) => setVal(e.target.value)} aria-label="Festival" style={{ padding: '10px 16px', border: '2px solid var(--border)', borderRadius: 8, fontSize: 14, flex: 1, minWidth: 200 }}>
          {FESTIVAL_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button type="button" onClick={save} style={{ padding: '10px 24px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>💾 Save Festival</button>
      </div>
      <div style={{ background: 'var(--primary-light)', padding: 16, borderRadius: 8, maxWidth: 520 }}>
        <p style={{ fontSize: 12, color: 'var(--primary-dark)', fontWeight: 600 }}>ℹ️ How it works:</p>
        <p style={{ fontSize: 12, color: '#666', marginTop: 4 }}>When you select a festival, the homepage will show festival-specific banners along with the default ones. Banners are configured in the <strong>Banners</strong> tab (festival field).</p>
      </div>
    </>
  );
}

function CacheSettings() {
  async function push() {
    const ok = await showConfirm('Sabhi users ko naya code / cache clear bhejein?', { title: 'Push site update', confirmText: 'Push update' });
    if (!ok) return;
    try {
      const res = await bumpCache();
      localStorage.setItem('4astore_asset_version', String(res.assetVersion));
      showToast(`Update pushed! All users will get fresh code (v${res.assetVersion}).`, 'success');
    } catch (e) {
      showToast(apiError(e) || 'Failed to push update', 'error');
    }
  }
  return (
    <>
      <h4 style={{ marginBottom: 6 }}>🔄 Push Update / Clear Cache</h4>
      <p style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 12, maxWidth: 600 }}>Jab bhi aap naya code (files) server pe daalein, ye button dabayein. Sabhi users ko browser me automatically naya code mil jaayega (purana cache clear ho jaayega).</p>
      <button type="button" onClick={push} style={{ padding: '11px 26px', background: '#e65100', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>🔄 Clear Cache &amp; Update All Users</button>
    </>
  );
}

function DataSettings() {
  const qc = useQueryClient();
  const orders = useAdminOrders().data ?? [];
  const users = useAdminUsers().data ?? [];
  const products = useProducts().data ?? [];

  async function reset(kind: 'orders' | 'users') {
    const ok = await showConfirm(kind === 'orders' ? 'Reload orders from the server?' : 'Reload users from the server?', { title: kind === 'orders' ? 'Reset orders' : 'Reset users', confirmText: kind === 'orders' ? 'Reset orders' : 'Reset users' });
    if (!ok) return;
    await qc.invalidateQueries({ queryKey: kind === 'orders' ? ADMIN_ORDERS_KEY : ['admin-users'] });
    showToast(kind === 'orders' ? 'Orders reset to server data' : 'Users reset to server data', 'info');
  }

  function exportData(type: 'users' | 'orders' | 'products' | 'all') {
    const stamp = new Date().toISOString().split('T')[0];
    const data = type === 'users' ? users : type === 'orders' ? orders : type === 'products' ? products : { users, orders, products, exportDate: new Date().toISOString() };
    const filename = type === 'all' ? `4astore_backup_${stamp}.json` : `${type}.json`;
    // BigInt-safe: ids already arrive as numbers/strings from the API.
    downloadText(filename, JSON.stringify(data, null, 2), 'application/json');
    showToast(`📥 ${filename} downloaded successfully`, 'success');
  }

  const b = (bg: string): React.CSSProperties => ({ padding: '10px 16px', background: bg, color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 });
  return (
    <>
      <h4 style={{ marginBottom: 12 }}>🗑️ Data Management</h4>
      <button type="button" onClick={() => reset('orders')} style={{ ...b('var(--accent)'), padding: '10px 20px', marginRight: 8 }}>🗑️ Reset Orders (from server)</button>
      <button type="button" onClick={() => reset('users')} style={{ ...b('#666'), padding: '10px 20px' }}>🗑️ Reset Users (from server)</button>

      <h4 style={{ marginTop: 24, marginBottom: 12 }}>💾 Export Data (Download as JSON)</h4>
      <p style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 12 }}>Download current data as a JSON backup. Passwords are never included.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => exportData('users')} style={b('#1565c0')}>📥 Export Users</button>
        <button type="button" onClick={() => exportData('orders')} style={b('#2e7d32')}>📥 Export Orders</button>
        <button type="button" onClick={() => exportData('products')} style={b('#ef6c00')}>📥 Export Products</button>
        <button type="button" onClick={() => exportData('all')} style={b('var(--primary)')}>📥 Export All Data</button>
      </div>

      <h4 style={{ marginTop: 24, marginBottom: 12 }}>📤 Import Data</h4>
      <p style={{ fontSize: 13, color: 'var(--gray)', maxWidth: 620 }}>
        Purane admin me import sirf browser cache (localStorage) badalta tha, server data nahi. Ab data MySQL me hai, isliye import server-side
        script se hota hai: <code>api-node/scripts/import-legacy-json.ts</code> (catalogue). Users/orders import ke liye pehle migration review zaroori hai.
      </p>
    </>
  );
}

// Port of the original renderSettingsTab() with its 5 sub-modules.
export default function AdminSettings() {
  const [sub, setSub] = useState<SubKey>(lastSub);
  const open = (k: SubKey) => {
    lastSub = k;
    setSub(k);
  };

  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
        {SUBS.map((s) => (
          <button type="button" key={s.key} onClick={() => open(s.key)} aria-pressed={sub === s.key}
            style={{
              padding: '9px 16px', border: `1px solid ${sub === s.key ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 20, cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: sub === s.key ? 'var(--primary)' : 'white', color: sub === s.key ? 'white' : 'var(--primary-dark)',
            }}>
            {s.label}
          </button>
        ))}
      </div>
      <div>
        {sub === 'store' && <StoreSettings />}
        {sub === 'announce' && <AnnouncementSettings />}
        {sub === 'footer' && <FooterSettings />}
        {sub === 'festival' && <FestivalSettings />}
        {sub === 'cache' && <CacheSettings />}
        {sub === 'data' && <DataSettings />}
      </div>
    </>
  );
}
