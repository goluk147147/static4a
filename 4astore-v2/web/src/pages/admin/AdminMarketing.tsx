import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchReach, ReachCustomer,
  fetchMarketingDashboard, fetchMarketingReports,
  fetchFestivals, createFestival, updateFestival, deleteFestival, MarketingFestival, FestivalInput,
  fetchTemplates, createTemplate, updateTemplate, deleteTemplate, MarketingTemplate,
  fetchCampaigns, createCampaign, updateCampaign, CampaignIncrements,
  setOptOut,
} from '../../lib/admin';
import { apiError } from '../../lib/api';
import { useProducts, useCategories, useSettings } from '../../lib/queries';
import { waLink, openWhatsApp } from '../../lib/whatsapp';
import { showToast } from '../../store/toast';
import EmojiPicker from '../../components/EmojiPicker';
import BannerStudio from './marketing/BannerStudio';
import VideoPromotions from './marketing/VideoPromotions';
import AutoSendComingSoon from './marketing/AutoSendComingSoon';
import MarketingSuggestionNudge from './marketing/SuggestionNudge';
import type { Product, Settings } from '../../types';

// Public site origin — WhatsApp's crawler hits these SPA URLs and nginx rewrites
// crawler UAs to the /api/og/* routes, so link previews render automatically.
// In production the SPA + API share one host, so window.location.origin is the
// store origin; fall back to the known canonical for safety.
export const SITE_ORIGIN =
  (typeof window !== 'undefined' && window.location.origin && !/localhost|127\.0\.0\.1/.test(window.location.origin))
    ? window.location.origin
    : 'https://4astore.com';

// Bilingual quick templates for the promo composer.
const TEMPLATES: [string, string][] = [
  ['Aaj ka offer', '🎉 Aaj ka offer / आज का ऑफर!\n4A Store par aaj special deals — abhi order karein. 🛒'],
  ['Naye products aa gaye', '✨ Naye products aa gaye! / नए प्रोडक्ट आ गए!\nTaaza stock dekhiye 4A Store par. 🛍️'],
  ['Aaj free delivery', '🚚 Aaj FREE delivery! / आज फ्री डिलीवरी!\nApne area me ghar baithe saman mangwayein. 📦'],
  ['Weekend sale', '🔥 Weekend Sale! / वीकेंड सेल!\n4A Store par bachat ke saath shopping karein. 💰'],
];

const MOBILE_MAX = 300;
const DEFAULT_BATCH = 10;

function fmtDate(v: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(v: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Days from today until an ISO date (negative = past). Null when no date. */
function daysUntil(v: string | null): number | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(d); target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

/** Mask a 10-digit mobile for display: 98XXXXXX10. */
function maskMobile(m: string): string {
  const d = String(m || '').replace(/\D/g, '');
  if (d.length < 6) return d;
  return `${d.slice(0, 2)}XXXXXX${d.slice(-2)}`;
}

async function copyText(text: string, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`✅ ${label}`, 'success');
    return true;
  } catch {
    showToast('Copy failed — please copy manually', 'error');
    return false;
  }
}

/**
 * fillTemplate — replace {{token}} placeholders with live data. When a value is
 * missing/empty, the token AND its dangling surrounding whitespace are removed,
 * so raw braces are NEVER shown. Shared with FEAT-004.
 *
 * Supported tokens: festival_name, product_name, product_image, selling_price,
 * discount, offer_expiry, product_url, store_name, store_phone, service_area,
 * app_url.
 */
export function fillTemplate(body: string, data: Record<string, string | number | null | undefined>): string {
  let out = String(body || '');
  out = out.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const v = data[key];
    if (v === null || v === undefined || String(v).trim() === '') return '\u0000'; // mark for cleanup
    return String(v);
  });
  // Remove the markers along with surrounding dangling whitespace so omitted
  // placeholders never leave double spaces or stray separators.
  out = out
    .replace(/[ \t]*\u0000[ \t]*/g, ' ')  // inline token → single space
    .replace(/ *\n/g, '\n')               // trim trailing spaces before newline
    .replace(/\n{3,}/g, '\n\n')           // collapse 3+ blank lines
    .replace(/[ \t]{2,}/g, ' ')           // collapse runs of spaces
    .trim();
  return out;
}

/** Build the placeholder data map from live sources. */
function templateData(opts: {
  festival?: MarketingFestival | null;
  product?: Product | null;
  settings?: Settings;
}): Record<string, string | number | null | undefined> {
  const { festival, product, settings } = opts;
  return {
    festival_name: festival?.name,
    product_name: product?.name,
    product_image: product?.image,
    selling_price: product ? `₹${product.price}` : undefined,
    discount: product && product.discount > 0 ? `${product.discount}%` : undefined,
    offer_expiry: undefined, // no server-side offer_expiry metadata yet
    product_url: product ? `${SITE_ORIGIN}/product/${product.id}` : undefined,
    store_name: '4A Store',
    store_phone: settings?.storePhone,
    service_area: settings?.serviceableVillages,
    app_url: SITE_ORIGIN,
  };
}

/** Compose a promo message for one product using REAL name/price/discount. */
function composeProductPromo(p: Product, hideMrp: boolean): string {
  const url = `${SITE_ORIGIN}/product/${p.id}`;
  // No leading emoji: on some devices/WhatsApp inputs a stray emoji renders as a
  // broken "" glyph. Keep the auto-composed promo clean ASCII + Hindi; the admin
  // can still add emoji manually from the composer if they want.
  const lines: string[] = [p.name];
  const showMrp = !hideMrp && p.mrp > p.price;
  if (p.discount > 0 && showMrp) {
    lines.push(`₹${p.price} (MRP ₹${p.mrp}, ${p.discount}% off)`);
  } else if (showMrp) {
    lines.push(`₹${p.price} (MRP ₹${p.mrp})`);
  } else {
    lines.push(`₹${p.price}`);
  }
  lines.push('Abhi order karein 4A Store par! / अभी ऑर्डर करें!');
  lines.push(url);
  return lines.join('\n');
}

const SUB_TABS: [string, string][] = [
  ['dashboard', '📊 Dashboard'],
  ['promotions', '🛍️ Product Promotions'],
  ['banners', '🎨 Banner Studio'],
  ['festivals', '🎊 Festival Calendar'],
  ['templates', '📝 Templates'],
  ['reach', '👥 Customer Reach'],
  ['composer', '✍️ Promo Message'],
  ['broadcast', '📤 Broadcast Helper'],
  ['links', '🔗 Share Links'],
  ['campaigns', '📈 History & Reports'],
  ['video', '🎬 Video (soon)'],
  ['autosend', '🤖 Auto-send / WhatsApp API'],
];
type SubTab = 'dashboard' | 'promotions' | 'banners' | 'festivals' | 'templates' | 'reach' | 'composer' | 'broadcast' | 'links' | 'campaigns' | 'video' | 'autosend';

export default function AdminMarketing() {
  const [sub, setSub] = useState<SubTab>('dashboard');

  // The composed promo message is shared across the composing + outreach tabs.
  const [message, setMessage] = useState(TEMPLATES[0][1]);
  // Customer selection (mobiles) is shared across Dashboard count + WhatsApp workflow.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ marginBottom: 14 }}>
        <h4 style={{ margin: '0 0 4px' }}>📣 Marketing Center</h4>
        <p style={{ fontSize: 13, color: 'var(--gray)', margin: 0 }}>
          FREE manual WhatsApp outreach / मुफ्त मैनुअल WhatsApp प्रचार. Har message aapke apne phone se jaata hai —
          koi paid API nahi, koi charge nahi. <strong>Link khulna ≠ message bheja gaya</strong> (link opened ≠ sent).
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        {SUB_TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setSub(key as SubTab)}
            style={{
              padding: '8px 16px',
              borderRadius: 999,
              border: '1px solid var(--border)',
              background: sub === key ? 'var(--primary)' : '#fff',
              color: sub === key ? '#fff' : 'var(--primary-dark)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {sub === 'dashboard' && <Dashboard selectedCount={selected.size} onGoto={setSub} />}
      {sub === 'promotions' && <ProductPromotions setMessage={setMessage} onComposed={() => setSub('reach')} />}
      {sub === 'banners' && <BannerStudio />}
      {sub === 'festivals' && <FestivalCalendar setMessage={setMessage} />}
      {sub === 'templates' && <TemplatesLibrary setMessage={setMessage} />}
      {sub === 'reach' && <ReachList message={message} selected={selected} setSelected={setSelected} />}
      {sub === 'composer' && <PromoComposer message={message} setMessage={setMessage} />}
      {sub === 'broadcast' && <BroadcastHelper message={message} />}
      {sub === 'links' && <ShareLinks />}
      {sub === 'campaigns' && <CampaignHistory />}
      {sub === 'video' && <VideoPromotions />}
      {sub === 'autosend' && <AutoSendComingSoon />}
    </div>
  );
}

/* ---------- Section: Dashboard ---------- */

function Dashboard({ selectedCount, onGoto }: { selectedCount: number; onGoto: (t: SubTab) => void }) {
  const q = useQuery({ queryKey: ['marketing-dashboard'], queryFn: fetchMarketingDashboard });
  const settings = useSettings().data;
  const hideMrp = !!settings?.hideMrp;

  if (q.isLoading) return <p style={{ color: 'var(--gray)' }}>Loading dashboard…</p>;
  if (q.isError) return <div style={errBox}>{apiError(q.error)}</div>;
  const d = q.data!;

  const needsCheck = (f: MarketingFestival) => f.needs_date_check || !f.festival_date;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <MarketingSuggestionNudge recommended={d.recommended} onGoto={onGoto} />

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => onGoto('promotions')} style={btnPrimary}>📣 Aaj ka offer bhejein</button>
        <button type="button" onClick={() => onGoto('festivals')} style={btnGhost}>🎊 Festival greeting</button>
        <button type="button" onClick={() => onGoto('broadcast')} style={btnGhost}>📤 Naya broadcast</button>
      </div>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <StatCard
          label="Upcoming festivals / आने वाले त्योहार"
          value={d.upcomingFestivals.length}
          onClick={() => onGoto('festivals')}
          ariaLabel="Upcoming festivals — open Festivals tab / आने वाले त्योहार"
        />
        <StatCard
          label="Discounted products / छूट वाले"
          value={d.recommended.discountedProducts.length}
          onClick={() => onGoto('promotions')}
          ariaLabel="Discounted products — open Promotions tab / छूट वाले"
        />
        <StatCard
          label="Out of stock / स्टॉक खत्म"
          value={d.recommended.lowStock.length}
          warn={d.recommended.lowStock.length > 0}
          onClick={() => onGoto('promotions')}
          ariaLabel="Out of stock — open Promotions tab / स्टॉक खत्म"
        />
        <StatCard label="Selected customers / चुने गए" value={selectedCount} />
      </div>

      <div style={card}>
        <strong style={cardTitle}>⭐ Aaj ke liye sujhaav / Today's recommendations</strong>
        {d.recommended.festivalsSoon.length === 0 && d.recommended.discountedProducts.length === 0 && (
          <p style={muted}>Abhi koi khaas sujhaav nahi / nothing special right now.</p>
        )}
        {d.recommended.festivalsSoon.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={subHead}>🎊 Festivals within 30 days / 30 din ke andar</div>
            <ul style={listReset}>
              {d.recommended.festivalsSoon.map((f) => (
                <li key={f.id} style={liRow}>
                  <span>{f.emoji ? `${f.emoji} ` : ''}{f.name}</span>
                  <span style={{ color: 'var(--gray)', fontSize: 12 }}>
                    {fmtDate(f.festival_date)}{needsCheck(f) ? ' ⚠️ verify date' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {d.recommended.discountedProducts.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={subHead}>🏷️ Discounted products (real price/MRP) / असली दाम</div>
            <ul style={listReset}>
              {d.recommended.discountedProducts.slice(0, 8).map((p) => (
                <li key={p.id} style={liRow}>
                  <span>{p.name}</span>
                  <span style={{ color: 'var(--gray)', fontSize: 12 }}>
                    ₹{Number(p.price)}{!hideMrp && Number(p.mrp) > Number(p.price) ? ` (MRP ₹${Number(p.mrp)}${Number(p.discount) > 0 ? `, ${Number(p.discount)}% off` : ''})` : ''}
                    {!p.in_stock ? ' • ❌ out of stock' : ''}
                  </span>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => onGoto('promotions')} style={{ ...btnGhost, marginTop: 6 }}>→ Promote a product</button>
          </div>
        )}
      </div>

      <div style={card}>
        <strong style={cardTitle}>🎊 Upcoming festivals / आगामी त्योहार</strong>
        <p style={{ ...muted, margin: '4px 0 8px' }}>
          ⚠️ Lunar dates har saal badalti hain — tareekh zaroor verify karein (verify dates).
        </p>
        {d.upcomingFestivals.length ? (
          <ul style={listReset}>
            {d.upcomingFestivals.map((f) => {
              const du = daysUntil(f.festival_date);
              return (
                <li key={f.id} style={liRow}>
                  <span>{f.emoji ? `${f.emoji} ` : ''}{f.name}</span>
                  <span style={{ color: 'var(--gray)', fontSize: 12 }}>
                    {fmtDate(f.festival_date)}
                    {du !== null && du >= 0 ? ` • ${du} din baaki` : ''}
                    {needsCheck(f) ? ' ⚠️ verify date' : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p style={muted}>Koi festival add nahi hua. Festival Calendar tab me jodein.</p>
        )}
        <button type="button" onClick={() => onGoto('festivals')} style={{ ...btnGhost, marginTop: 6 }}>→ Edit calendar</button>
      </div>

      <div style={card}>
        <strong style={cardTitle}>📈 Recent campaigns / हाल के कैंपेन</strong>
        {d.recentCampaigns.length ? (
          <ul style={listReset}>
            {d.recentCampaigns.map((c) => (
              <li key={c.id} style={liRow}>
                <span>{c.name}</span>
                <span style={{ color: 'var(--gray)', fontSize: 12 }}>{c.status} • {fmtDateTime(c.created_at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p style={muted}>Abhi tak koi campaign nahi / no campaigns yet.</p>
        )}
        <button type="button" onClick={() => onGoto('campaigns')} style={{ ...btnGhost, marginTop: 6 }}>→ History & reports</button>
      </div>
    </div>
  );
}

function StatCard({ label, value, warn, onClick, ariaLabel }: { label: string; value: number; warn?: boolean; onClick?: () => void; ariaLabel?: string }) {
  const [hover, setHover] = useState(false);

  const inner = (
    <>
      <div style={{ fontSize: 26, fontWeight: 800, color: warn ? '#b45309' : 'var(--primary-dark)' }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--gray)' }}>{label}</div>
    </>
  );

  if (!onClick) {
    return <div style={{ ...card, padding: 14 }}>{inner}</div>;
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel ?? label}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (e.key === ' ') e.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...card,
        padding: 14,
        cursor: 'pointer',
        boxShadow: hover ? '0 4px 14px rgba(0,0,0,0.12)' : card.boxShadow,
        transform: hover ? 'translateY(-1px)' : 'none',
        transition: 'box-shadow 0.15s, transform 0.15s',
      }}
    >
      {inner}
    </div>
  );
}

/* ---------- Section: Product Promotions / auto-fetch ---------- */

function ProductPromotions({ setMessage, onComposed }: { setMessage: (v: string) => void; onComposed: () => void }) {
  const products = useProducts().data ?? [];
  const categories = useCategories().data ?? [];
  const settings = useSettings().data;
  const hideMrp = !!settings?.hideMrp;

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [recent, setRecent] = useState(false);
  const [discountedOnly, setDiscountedOnly] = useState(false);
  const [inStockOnly, setInStockOnly] = useState(true);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const filtered = useMemo(() => {
    let list = products.slice();
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q));
    if (category) list = list.filter((p) => p.category === category);
    if (discountedOnly) list = list.filter((p) => p.discount > 0 || p.mrp > p.price);
    if (inStockOnly) list = list.filter((p) => p.in_stock);
    if (recent) {
      list.sort((a, b) => {
        const ad = (a as unknown as { created_at?: string }).created_at || '';
        const bd = (b as unknown as { created_at?: string }).created_at || '';
        return bd.localeCompare(ad);
      });
    }
    return list;
  }, [products, search, category, discountedOnly, inStockOnly, recent]);

  function toggle(id: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function composeSelected() {
    const chosen = products.filter((p) => picked.has(p.id));
    if (!chosen.length) { showToast('Pehle product chunein', 'error'); return; }
    const msg = chosen.map((p) => composeProductPromo(p, hideMrp)).join('\n\n');
    setMessage(msg);
    showToast(`✅ ${chosen.length} product promo composed`, 'success');
    onComposed();
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <p style={muted}>
        Product chunein — promo message asli naam / daam / discount se auto-ban jaata hai (koi price invent nahi hoti).
        Link: <code>{SITE_ORIGIN}/product/:id</code>.
      </p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label style={lbl}>Search / खोजें</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="product name…" style={inp} />
        </div>
        <div style={{ minWidth: 160 }}>
          <label style={lbl}>Category / श्रेणी</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={inp}>
            <option value="">All / सभी</option>
            {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13 }}>
        <label style={chk}><input type="checkbox" checked={recent} onChange={(e) => setRecent(e.target.checked)} /> Recently added</label>
        <label style={chk}><input type="checkbox" checked={discountedOnly} onChange={(e) => setDiscountedOnly(e.target.checked)} /> Discounted only</label>
        <label style={chk}><input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} /> Exclude out-of-stock</label>
      </div>

      <div style={{ ...tableWrap, maxHeight: 460, overflowY: 'auto' }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th></th>
              <th>Product / प्रोडक्ट</th>
              <th>Price</th>
              <th>Stock</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length ? filtered.map((p) => {
              const showMrp = !hideMrp && p.mrp > p.price;
              return (
                <tr key={p.id}>
                  <td><input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} /></td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {p.image ? <img src={p.image} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6 }} /> : null}
                      <span>{p.name}</span>
                    </div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                    ₹{p.price}
                    {showMrp && <span style={{ color: 'var(--gray)' }}> (MRP ₹{p.mrp}{p.discount > 0 ? `, ${p.discount}% off` : ''})</span>}
                  </td>
                  <td style={{ fontSize: 12 }}>{p.in_stock ? '✅' : '❌'}</td>
                </tr>
              );
            }) : (
              <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, color: 'var(--gray)' }}>No products match.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={composeSelected} disabled={!picked.size} style={btnPrimary}>
          ✍️ Compose promo ({picked.size})
        </button>
        {picked.size > 0 && <button type="button" onClick={() => setPicked(new Set())} style={btnGhost}>Clear</button>}
      </div>
    </div>
  );
}

/* ---------- Section: Festival & Holiday Calendar ---------- */

const emptyFestival: FestivalInput = { name: '', slug: '', festival_date: '', emoji: '', greeting_hi: '', is_active: true };

function FestivalCalendar({ setMessage }: { setMessage: (v: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['marketing-festivals'], queryFn: fetchFestivals });
  const [form, setForm] = useState<FestivalInput>(emptyFestival);
  const [editId, setEditId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const festivals = q.data ?? [];
  const next30 = festivals.filter((f) => { const d = daysUntil(f.festival_date); return d !== null && d >= 0 && d <= 30; });

  function reset() { setForm(emptyFestival); setEditId(null); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.slug.trim()) { showToast('Name aur slug zaroori hain', 'error'); return; }
    setBusy(true);
    try {
      const payload: FestivalInput = { ...form, festival_date: form.festival_date ? form.festival_date : null };
      if (editId) await updateFestival(editId, payload);
      else await createFestival(payload);
      await qc.invalidateQueries({ queryKey: ['marketing-festivals'] });
      await qc.invalidateQueries({ queryKey: ['marketing-dashboard'] });
      showToast(editId ? '✅ Festival updated' : '✅ Festival added', 'success');
      reset();
    } catch (err) {
      showToast(apiError(err), 'error');
    } finally { setBusy(false); }
  }

  function edit(f: MarketingFestival) {
    setEditId(f.id);
    setForm({
      name: f.name, slug: f.slug,
      festival_date: f.festival_date ? f.festival_date.slice(0, 10) : '',
      emoji: f.emoji || '', greeting_hi: f.greeting_hi || '',
      is_active: f.is_active, needs_date_check: f.needs_date_check, sort_order: f.sort_order,
    });
  }

  async function remove(id: number) {
    if (!window.confirm('Delete this festival? / हटाएं?')) return;
    try {
      await deleteFestival(id);
      await qc.invalidateQueries({ queryKey: ['marketing-festivals'] });
      showToast('🗑️ Deleted', 'success');
      if (editId === id) reset();
    } catch (err) { showToast(apiError(err), 'error'); }
  }

  function loadGreeting(f: MarketingFestival) {
    const greeting = f.greeting_hi || `${f.emoji ? f.emoji + ' ' : ''}${f.name} ki hardik shubhkamnayein! / ${f.name} की हार्दिक शुभकामनाएं!`;
    setMessage(greeting);
    showToast('✅ Greeting composer me load ho gaya', 'success');
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 12, padding: 14 }}>
        <strong style={{ color: '#8d5d00', fontSize: 13 }}>⚠️ Lunar dates vary / तारीख हर साल बदलती है</strong>
        <p style={{ margin: '6px 0 0', fontSize: 12, color: '#8d5d00' }}>
          Diwali, Holi, Eid jaise tyohaar har saal alag tareekh par aate hain. Date set karne se pehle verify karein.
        </p>
      </div>

      <form onSubmit={submit} style={card}>
        <strong style={cardTitle}>{editId ? '✏️ Edit festival' : '➕ Add festival'}</strong>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={lbl}>Name / नाम</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inp} placeholder="Diwali" />
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={lbl}>Slug</label>
            <input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} style={inp} placeholder="diwali" />
          </div>
          <div style={{ minWidth: 150 }}>
            <label style={lbl}>Date / तारीख</label>
            <input type="date" value={form.festival_date || ''} onChange={(e) => setForm({ ...form, festival_date: e.target.value })} style={inp} />
          </div>
          <div style={{ width: 80 }}>
            <label style={lbl}>Emoji</label>
            <input value={form.emoji || ''} onChange={(e) => setForm({ ...form, emoji: e.target.value })} style={inp} placeholder="🪔" />
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <label style={lbl}>Greeting (Hindi) — optional</label>
          <input value={form.greeting_hi || ''} onChange={(e) => setForm({ ...form, greeting_hi: e.target.value })} style={inp} placeholder="शुभ दीपावली!" />
        </div>
        <label style={{ ...chk, marginTop: 10 }}>
          <input type="checkbox" checked={form.is_active ?? true} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active
        </label>
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <button type="submit" disabled={busy} style={btnPrimary}>{editId ? 'Save' : 'Add'}</button>
          {editId && <button type="button" onClick={reset} style={btnGhost}>Cancel</button>}
        </div>
      </form>

      <div style={card}>
        <strong style={cardTitle}>📅 Next 30 days / अगले 30 दिन</strong>
        {next30.length ? (
          <ul style={listReset}>
            {next30.map((f) => (
              <li key={f.id} style={liRow}>
                <span>{f.emoji ? `${f.emoji} ` : ''}{f.name}</span>
                <span style={{ color: 'var(--gray)', fontSize: 12 }}>{fmtDate(f.festival_date)} • {daysUntil(f.festival_date)} din</span>
              </li>
            ))}
          </ul>
        ) : <p style={muted}>Agle 30 din me koi festival nahi.</p>}
      </div>

      <FestivalTemplatePicker festivals={festivals} setMessage={setMessage} />

      <div style={card}>
        <strong style={cardTitle}>🎊 All festivals / सभी त्योहार</strong>
        {q.isError && <div style={errBox}>{apiError(q.error)}</div>}
        <div style={{ ...tableWrap, marginTop: 10 }}>
          <table className="admin-table">
            <thead>
              <tr><th>Name</th><th>Date</th><th>Active</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {festivals.length ? festivals.map((f) => (
                <tr key={f.id}>
                  <td>{f.emoji ? `${f.emoji} ` : ''}{f.name}</td>
                  <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                    {fmtDate(f.festival_date)}{(f.needs_date_check || !f.festival_date) ? ' ⚠️' : ''}
                  </td>
                  <td>{f.is_active ? '✅' : '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button type="button" onClick={() => loadGreeting(f)} style={btnGhost}>💬 Greeting</button>
                      <button type="button" onClick={() => edit(f)} style={btnGhost}>✏️ Edit</button>
                      <button type="button" onClick={() => remove(f.id)} style={btnDanger}>🗑️</button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 20, color: 'var(--gray)' }}>
                  {q.isLoading ? 'Loading…' : 'Koi festival nahi.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Dropdown: pick a festival → loads its matching template (by festival_slug). */
function FestivalTemplatePicker({ festivals, setMessage }: { festivals: MarketingFestival[]; setMessage: (v: string) => void }) {
  const settings = useSettings().data;
  const [slug, setSlug] = useState('');
  const [loading, setLoading] = useState(false);

  async function pick(s: string) {
    setSlug(s);
    if (!s) return;
    const festival = festivals.find((f) => f.slug === s) || null;
    setLoading(true);
    try {
      const templates = await fetchTemplates({ festival_slug: s });
      if (!templates.length) { showToast('Is festival ke liye koi template nahi — Templates tab me jodein', 'error'); return; }
      const t = templates.find((x) => x.is_active) || templates[0];
      const filled = fillTemplate(t.body, templateData({ festival, settings }));
      setMessage(filled);
      showToast('✅ Template composer me load ho gaya', 'success');
    } catch (err) { showToast(apiError(err), 'error'); }
    finally { setLoading(false); }
  }

  return (
    <div style={card}>
      <strong style={cardTitle}>🎯 Festival template load karein</strong>
      <p style={{ ...muted, margin: '4px 0 8px' }}>Festival chunein — uska matching template (festival_slug) composer me aa jaayega.</p>
      <select value={slug} onChange={(e) => pick(e.target.value)} disabled={loading} style={inp}>
        <option value="">— Choose festival —</option>
        {festivals.map((f) => <option key={f.id} value={f.slug}>{f.emoji ? `${f.emoji} ` : ''}{f.name}</option>)}
      </select>
    </div>
  );
}

/* ---------- Section: Templates Library ---------- */

function TemplatesLibrary({ setMessage }: { setMessage: (v: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['marketing-templates'], queryFn: () => fetchTemplates() });
  const products = useProducts().data ?? [];
  const festivalsQ = useQuery({ queryKey: ['marketing-festivals'], queryFn: fetchFestivals });
  const settings = useSettings().data;

  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<{ title: string; category: string; festival_slug: string; lang: string; body: string; is_active: boolean }>(
    { title: '', category: 'general', festival_slug: '', lang: 'hinglish', body: '', is_active: true },
  );
  const [busy, setBusy] = useState(false);
  const [previewProduct, setPreviewProduct] = useState('');
  const [previewFestival, setPreviewFestival] = useState('');

  const templates = q.data ?? [];
  const festivals = festivalsQ.data ?? [];

  const grouped = useMemo(() => {
    const m = new Map<string, MarketingTemplate[]>();
    for (const t of templates) {
      const key = t.festival_slug ? `festival:${t.festival_slug}` : (t.category || 'general');
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(t);
    }
    return Array.from(m.entries());
  }, [templates]);

  function reset() {
    setForm({ title: '', category: 'general', festival_slug: '', lang: 'hinglish', body: '', is_active: true });
    setEditId(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.body.trim()) { showToast('Title aur body zaroori hain', 'error'); return; }
    setBusy(true);
    try {
      const payload = {
        title: form.title, category: form.category || 'general',
        festival_slug: form.festival_slug || null, lang: form.lang || 'hinglish',
        body: form.body, is_active: form.is_active,
      };
      if (editId) await updateTemplate(editId, payload);
      else await createTemplate(payload);
      await qc.invalidateQueries({ queryKey: ['marketing-templates'] });
      showToast(editId ? '✅ Template updated' : '✅ Template added', 'success');
      reset();
    } catch (err) { showToast(apiError(err), 'error'); }
    finally { setBusy(false); }
  }

  function edit(t: MarketingTemplate) {
    setEditId(t.id);
    setForm({ title: t.title, category: t.category || 'general', festival_slug: t.festival_slug || '', lang: t.lang || 'hinglish', body: t.body, is_active: t.is_active });
  }

  async function remove(id: number) {
    if (!window.confirm('Delete this template?')) return;
    try {
      await deleteTemplate(id);
      await qc.invalidateQueries({ queryKey: ['marketing-templates'] });
      showToast('🗑️ Deleted', 'success');
      if (editId === id) reset();
    } catch (err) { showToast(apiError(err), 'error'); }
  }

  function filledFor(body: string): string {
    const product = products.find((p) => String(p.id) === previewProduct) || null;
    const festival = festivals.find((f) => f.slug === previewFestival) || null;
    return fillTemplate(body, templateData({ product, festival, settings }));
  }

  function useTemplate(t: MarketingTemplate) {
    setMessage(filledFor(t.body));
    showToast('✅ Filled template composer me load ho gaya', 'success');
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ background: '#eef6ff', border: '1px solid #bcdcff', borderRadius: 12, padding: 14 }}>
        <strong style={{ color: '#1e40af', fontSize: 13 }}>🧩 Placeholders</strong>
        <p style={{ margin: '6px 0 0', fontSize: 12, color: '#1e40af' }}>
          Use <code>{'{{festival_name}} {{product_name}} {{selling_price}} {{discount}} {{product_url}} {{store_name}} {{store_phone}} {{service_area}} {{app_url}}'}</code>.
          Jo value nahi milti woh placeholder apne aap hat jaata hai — raw braces kabhi nahi dikhte.
        </p>
      </div>

      <div style={card}>
        <strong style={cardTitle}>🔎 Preview fill (live data)</strong>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={lbl}>Product</label>
            <select value={previewProduct} onChange={(e) => setPreviewProduct(e.target.value)} style={inp}>
              <option value="">— none —</option>
              {products.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={lbl}>Festival</label>
            <select value={previewFestival} onChange={(e) => setPreviewFestival(e.target.value)} style={inp}>
              <option value="">— none —</option>
              {festivals.map((f) => <option key={f.id} value={f.slug}>{f.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      <form onSubmit={submit} style={card}>
        <strong style={cardTitle}>{editId ? '✏️ Edit template' : '➕ Add template'}</strong>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={lbl}>Title</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={inp} placeholder="Diwali offer" />
          </div>
          <div style={{ minWidth: 140 }}>
            <label style={lbl}>Category</label>
            <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={inp} placeholder="general" />
          </div>
          <div style={{ minWidth: 150 }}>
            <label style={lbl}>Festival slug (optional)</label>
            <select value={form.festival_slug} onChange={(e) => setForm({ ...form, festival_slug: e.target.value })} style={inp}>
              <option value="">— none —</option>
              {festivals.map((f) => <option key={f.id} value={f.slug}>{f.name}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <label style={lbl}>Body / संदेश</label>
          <textarea rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })}
            style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }} placeholder="{{festival_name}} ki shubhkamnayein! {{product_name}} sirf {{selling_price}} me. {{product_url}}" />
        </div>
        <label style={{ ...chk, marginTop: 10 }}>
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active
        </label>
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <button type="submit" disabled={busy} style={btnPrimary}>{editId ? 'Save' : 'Add'}</button>
          {editId && <button type="button" onClick={reset} style={btnGhost}>Cancel</button>}
        </div>
      </form>

      {q.isError && <div style={errBox}>{apiError(q.error)}</div>}
      {grouped.length ? grouped.map(([group, list]) => (
        <div key={group} style={card}>
          <strong style={cardTitle}>{group.startsWith('festival:') ? `🎊 ${group.slice(9)}` : `🗂️ ${group}`}</strong>
          <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
            {list.map((t) => (
              <div key={t.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 13 }}>{t.title}{!t.is_active ? ' (inactive)' : ''}</strong>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button type="button" onClick={() => useTemplate(t)} style={btnWa}>✅ Use (filled)</button>
                    <button type="button" onClick={() => edit(t)} style={btnGhost}>✏️</button>
                    <button type="button" onClick={() => remove(t.id)} style={btnDanger}>🗑️</button>
                  </div>
                </div>
                <pre style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 12, color: 'var(--gray)' }}>{filledFor(t.body)}</pre>
              </div>
            ))}
          </div>
        </div>
      )) : (
        <p style={muted}>{q.isLoading ? 'Loading…' : 'Koi template nahi — upar se add karein.'}</p>
      )}
    </div>
  );
}

/* ---------- Section: Customer Reach + WhatsApp workflow ---------- */

function ReachList({ message, selected, setSelected }: { message: string; selected: Set<string>; setSelected: React.Dispatch<React.SetStateAction<Set<string>>> }) {
  const qc = useQueryClient();
  const [days, setDays] = useState<number>(0);
  const [search, setSearch] = useState('');
  const [village, setVillage] = useState('');
  const [pin, setPin] = useState('');
  const [applied, setApplied] = useState<{ days: number; q: string }>({ days: 0, q: '' });
  const [preset, setPreset] = useState<number>(DEFAULT_BATCH);
  const [review, setReview] = useState(false);
  const [optingOut, setOptingOut] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['marketing-reach', applied],
    queryFn: () => fetchReach({ days: applied.days || undefined, q: applied.q || undefined }),
  });

  function apply(e: React.FormEvent) {
    e.preventDefault();
    setApplied({ days, q: search.trim() });
  }

  const allRows = query.data ?? [];
  // Village/PIN narrow the server-filtered rows client-side (reach rows carry
  // name/mobile only — order village/PIN is matched via name/number here).
  const rows = useMemo(() => {
    let list = allRows;
    const v = village.trim().toLowerCase();
    const p = pin.trim();
    if (v) list = list.filter((r) => r.name.toLowerCase().includes(v));
    if (p) list = list.filter((r) => r.mobile.includes(p));
    return list;
  }, [allRows, village, pin]);

  function toggle(mobile: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(mobile)) next.delete(mobile); else next.add(mobile);
      return next;
    });
  }

  function applyPreset(n: number) {
    setPreset(n);
    const next = new Set<string>();
    rows.slice(0, n).forEach((r) => next.add(r.mobile));
    setSelected(next);
  }

  async function doOptOut(mobile: string) {
    setOptingOut(mobile);
    try {
      await setOptOut(mobile, true);
      setSelected((prev) => { const n = new Set(prev); n.delete(mobile); return n; });
      await qc.invalidateQueries({ queryKey: ['marketing-reach'] });
      showToast('✅ Opted out — ab outreach se hata diya', 'success');
    } catch (err) { showToast(apiError(err), 'error'); }
    finally { setOptingOut(null); }
  }

  const selectedRows = rows.filter((r) => selected.has(r.mobile));
  const batches = useMemo(() => {
    const out: ReachCustomer[][] = [];
    for (let i = 0; i < selectedRows.length; i += DEFAULT_BATCH) out.push(selectedRows.slice(i, i + DEFAULT_BATCH));
    return out;
  }, [selectedRows]);

  return (
    <>
      <ManualNote />

      {!message.trim() && (
        <div style={{ ...errBox, background: '#fff8e1', color: '#8d5d00', border: '1px solid #ffe082' }}>
          Pehle <strong>Promo Message / Templates / Product Promotions</strong> se message compose karein.
        </div>
      )}

      <form onSubmit={apply} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={lbl}>Name or mobile / नाम या मोबाइल</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ramesh / 9876…" style={inp} />
        </div>
        <div style={{ minWidth: 150 }}>
          <label style={lbl}>Ordered in last / पिछले</label>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={inp}>
            <option value={0}>Any time</option>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </div>
        <button type="submit" style={btnPrimary}>🔍 Filter</button>
      </form>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ minWidth: 150 }}>
          <label style={lbl}>Village/locality (name match)</label>
          <input value={village} onChange={(e) => setVillage(e.target.value)} placeholder="locality…" style={inp} />
        </div>
        <div style={{ minWidth: 120 }}>
          <label style={lbl}>PIN / mobile digits</label>
          <input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="e.g. 9876" style={inp} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--gray)' }}>Quick select:</span>
        {[1, 5, 10].map((n) => (
          <button key={n} type="button" onClick={() => applyPreset(n)} style={preset === n ? btnChipActive : btnChip}>Top {n}</button>
        ))}
        <button type="button" onClick={() => setSelected(new Set())} style={btnGhost}>Clear</button>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary-dark)', marginLeft: 'auto' }}>
          {selected.size} selected • {batches.length} batch{batches.length === 1 ? '' : 'es'} of ≤10
        </span>
      </div>

      {query.isError && <div style={errBox}>{apiError(query.error)}</div>}

      <div style={{ ...tableWrap, maxHeight: 460, overflowY: 'auto' }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th></th>
              <th>Name / नाम</th>
              <th>Mobile (masked)</th>
              <th>Orders</th>
              <th>Last order</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((c) => (
              <tr key={c.mobile}>
                <td><input type="checkbox" checked={selected.has(c.mobile)} onChange={() => toggle(c.mobile)} /></td>
                <td>{c.name}</td>
                <td style={{ whiteSpace: 'nowrap' }} title="Number masked for privacy">{maskMobile(c.mobile)}</td>
                <td style={{ textAlign: 'center' }}>{c.orders}</td>
                <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDate(c.lastOrderAt)}</td>
                <td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button type="button" onClick={() => openWhatsApp(c.mobile, message)} disabled={!message.trim()} style={btnWa}>💬 Chat</button>
                    <button type="button" onClick={() => copyText(c.mobile, 'Number copied')} style={btnGhost}>📋</button>
                    <button type="button" onClick={() => doOptOut(c.mobile)} disabled={optingOut === c.mobile} style={btnDanger}>🚫 Opt-out</button>
                  </div>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--gray)' }}>
                {query.isLoading ? 'Loading…' : 'Koi customer nahi mila / no customers found.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14, alignItems: 'center' }}>
        <button type="button" onClick={() => setReview(true)} disabled={!selected.size || !message.trim()} style={btnPrimary}>
          👀 Review & share ({selected.size})
        </button>
        <span style={{ fontSize: 12, color: 'var(--gray)' }}>{rows.length} customers • opted-out accounts hidden server-side</span>
      </div>

      {review && (
        <ReviewShare batches={batches} message={message} onClose={() => setReview(false)} />
      )}
    </>
  );
}

function ManualNote() {
  return (
    <div style={{ background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 12, padding: 14, marginBottom: 16 }}>
      <strong style={{ color: '#1b5e20', fontSize: 14 }}>ℹ️ MANUAL send / मैनुअल भेजना (FREE)</strong>
      <p style={{ margin: '6px 0 0', fontSize: 13, color: '#1b5e20' }}>
        Har customer ko <strong>ek-ek karke khud</strong> WhatsApp se bhejein — ye automated bulk nahi hai, koi paid API nahi.
        <strong> Link khulna matlab message bhej diya gaya NAHI hai</strong> (link opened ≠ sent). Batches of 10 me bhejein taaki number block na ho.
      </p>
    </div>
  );
}

/** Review screen (name / masked number / message preview) + batch share actions. */
function ReviewShare({ batches, message, onClose }: { batches: ReachCustomer[][]; message: string; onClose: () => void }) {
  const [busy, setBusy] = useState(false);

  const total = batches.reduce((n, b) => n + b.length, 0);
  const allMobiles = batches.flat().map((c) => c.mobile);

  // Record the campaign + an action-counter increment (best-effort, non-blocking).
  async function record(name: string, inc: CampaignIncrements) {
    try {
      const c = await createCampaign({
        name, category: 'whatsapp', customer_mobiles: allMobiles, message, status: 'prepared',
        notes: `Manual WhatsApp — ${total} customers, ${batches.length} batch(es). Link opened != sent.`,
      });
      await updateCampaign(c.id, { increments: inc });
    } catch { /* counters are best-effort */ }
  }

  async function shareGroup() {
    setBusy(true);
    await record('Group share', { share_opened: 1, batches_prepared: batches.length });
    openWhatsApp(null, message);
    setBusy(false);
  }

  async function copyMsg() {
    const okCopy = await copyText(message, 'Message copied');
    if (okCopy) await record('Copy message', { copied_count: 1, batches_prepared: batches.length });
  }

  function openWeb() {
    window.open(`https://web.whatsapp.com/send?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
    void record('Open WhatsApp Web', { share_opened: 1 });
  }

  return (
    <div style={modalOverlay} onClick={onClose}>
      <div style={modalBox} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={cardTitle}>👀 Review before sharing</strong>
          <button type="button" onClick={onClose} style={btnGhost}>✕</button>
        </div>

        <div style={{ background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 8, padding: 10, margin: '10px 0', fontSize: 12, color: '#1b5e20' }}>
          MANUAL / FREE — ek chat ek baar me. <strong>Link opened ≠ message sent/delivered.</strong>
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={lbl}>Message preview</label>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>{message}</pre>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button type="button" onClick={shareGroup} disabled={busy} style={btnWa}>💬 Share (pick chat/group)</button>
          <button type="button" onClick={copyMsg} style={btnGhost}>📋 Copy message</button>
          <button type="button" onClick={openWeb} style={btnGhost}>🌐 Open WhatsApp Web</button>
        </div>

        {batches.map((batch, bi) => (
          <div key={bi} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <strong style={{ fontSize: 13 }}>Batch {bi + 1} / {batches.length} ({batch.length})</strong>
            </div>
            <table className="admin-table">
              <thead><tr><th>Name</th><th>Mobile</th><th>Send</th></tr></thead>
              <tbody>
                {batch.map((c) => (
                  <tr key={c.mobile}>
                    <td>{c.name}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{maskMobile(c.mobile)}</td>
                    <td>
                      <a href={waLink(c.mobile, message)} target="_blank" rel="noreferrer"
                        style={{ ...btnWa, textDecoration: 'none', display: 'inline-block' }}>💬 WhatsApp</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        <p style={{ fontSize: 11, color: 'var(--gray)', textAlign: 'center' }}>
          Tap each row, send one at a time from your phone. {total} customers total.
        </p>
      </div>
    </div>
  );
}

/* ---------- Section: Promo Message Composer ---------- */

function PromoComposer({ message, setMessage }: { message: string; setMessage: (v: string) => void }) {
  const products = useProducts().data ?? [];
  const categories = useCategories().data ?? [];
  const textRef = useRef<HTMLTextAreaElement>(null);

  function appendLink(url: string) {
    setMessage((message ? `${message.replace(/\s+$/, '')}\n\n` : '') + url);
  }

  function pickProduct(id: string) {
    if (!id) return;
    const p = products.find((x) => String(x.id) === id);
    if (!p) return;
    appendLink(`${SITE_ORIGIN}/product/${id}`);
  }

  function pickCategory(slug: string) {
    if (!slug) return;
    appendLink(`${SITE_ORIGIN}/products?category=${encodeURIComponent(slug)}`);
  }

  function pickEmoji(emoji: string) {
    const el = textRef.current;
    const start = el?.selectionStart ?? message.length;
    const end = el?.selectionEnd ?? message.length;
    const next = (message.slice(0, start) + emoji + message.slice(end)).slice(0, MOBILE_MAX);
    setMessage(next);
    requestAnimationFrame(() => {
      if (el) {
        el.focus();
        const caret = Math.min(start + emoji.length, next.length);
        el.setSelectionRange(caret, caret);
      }
    });
  }

  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: 'var(--shadow)', maxWidth: 560 }}>
      <p style={{ fontSize: 12, color: 'var(--gray)', margin: '0 0 14px' }}>
        Yahan promo message likhein (Hindi + English + emoji). Yahi message Customer Reach aur Broadcast tab ke
        WhatsApp buttons me prefill hota hai.
      </p>

      <div style={{ marginBottom: 12 }}>
        <label style={lbl}>Quick templates / तैयार संदेश</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {TEMPLATES.map(([name, text]) => (
            <button key={name} type="button" onClick={() => setMessage(text)} style={btnChip}>{name}</button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <label style={lbl}>Message / संदेश ({message.length}/{MOBILE_MAX})</label>
        <textarea
          ref={textRef}
          rows={6}
          value={message}
          maxLength={MOBILE_MAX}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Aaj ka offer…"
          style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <EmojiPicker onPick={pickEmoji} />
          <span style={{ fontSize: 11, color: 'var(--gray)' }}>Emoji cursor ki jagah add hoga.</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label style={lbl}>Attach product link</label>
          <select defaultValue="" onChange={(e) => { pickProduct(e.target.value); e.target.value = ''; }} style={inp}>
            <option value="">— Choose product —</option>
            {products.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label style={lbl}>Attach category link</label>
          <select defaultValue="" onChange={(e) => { pickCategory(e.target.value); e.target.value = ''; }} style={inp}>
            <option value="">— Choose category —</option>
            {categories.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
          </select>
        </div>
      </div>
      <p style={{ fontSize: 11, color: 'var(--gray)', margin: '0 0 14px' }}>
        Product/category chunne par uska link message me jud jaata hai — WhatsApp me rich preview (image + title)
        apne aap dikhta hai.
      </p>

      <button type="button" onClick={() => openWhatsApp(null, message)} disabled={!message.trim()} style={btnWaBlock}>
        💬 Share on WhatsApp (group / no number) / ग्रुप में भेजें
      </button>
      <p style={{ fontSize: 11, color: 'var(--gray)', marginTop: 8, textAlign: 'center' }}>
        WhatsApp khulega — koi bhi chat ya group chunkar Send dabayein. Link khulna = bheja gaya NAHI.
      </p>
    </div>
  );
}

/* ---------- Section: Broadcast Helper ---------- */

function BroadcastHelper({ message }: { message: string }) {
  const [days, setDays] = useState<number>(0);
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState<{ days: number; q: string }>({ days: 0, q: '' });

  const query = useQuery({
    queryKey: ['marketing-reach', applied],
    queryFn: () => fetchReach({ days: applied.days || undefined, q: applied.q || undefined }),
  });

  function apply(e: React.FormEvent) {
    e.preventDefault();
    setApplied({ days, q: search.trim() });
  }

  const rows: ReachCustomer[] = query.data ?? [];

  return (
    <>
      <ManualNote />

      {!message.trim() && (
        <div style={{ ...errBox, background: '#fff8e1', color: '#8d5d00', border: '1px solid #ffe082' }}>
          Pehle <strong>Promo Message</strong> tab me message likhein — tabhi WhatsApp buttons me text prefill hoga.
        </div>
      )}

      <form onSubmit={apply} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label style={lbl}>Search / खोजें</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="name or mobile" style={inp} />
        </div>
        <div style={{ minWidth: 170 }}>
          <label style={lbl}>Ordered in last / पिछले</label>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={inp}>
            <option value={0}>Any time / कभी भी</option>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </div>
        <button type="submit" style={btnPrimary}>🔍 Filter</button>
      </form>

      {query.isError && <div style={errBox}>{apiError(query.error)}</div>}

      <div style={{ ...tableWrap, maxHeight: 480, overflowY: 'auto' }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Name / नाम</th>
              <th>Mobile</th>
              <th>Send</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((c, i) => (
                <tr key={c.mobile}>
                  <td style={{ color: 'var(--gray)' }}>{i + 1}</td>
                  <td>{c.name}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{maskMobile(c.mobile)}</td>
                  <td>
                    <a
                      href={waLink(c.mobile, message)}
                      target="_blank"
                      rel="noreferrer"
                      style={{ ...btnWa, textDecoration: 'none', display: 'inline-block' }}
                    >
                      💬 WhatsApp
                    </a>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', padding: 24, color: 'var(--gray)' }}>
                  {query.isLoading ? 'Loading…' : 'Koi customer nahi mila / no customers found.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > 0 && <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: 10 }}>{rows.length} customers — tap each, send one at a time. Link opened ≠ sent.</p>}
    </>
  );
}

/* ---------- Section: Shareable Promo Links ---------- */

function ShareLinks() {
  const products = useProducts().data ?? [];
  const categories = useCategories().data ?? [];
  const [productId, setProductId] = useState('');
  const [categorySlug, setCategorySlug] = useState('');

  const storeUrl = SITE_ORIGIN;
  const storeCaption = `🛒 4A Store — ghar baithe grocery order karein! / घर बैठे ग्रॉसरी ऑर्डर करें!\n${storeUrl}`;

  const product = products.find((p) => String(p.id) === productId);
  const productUrl = productId ? `${SITE_ORIGIN}/product/${productId}` : '';
  const productCaption = product
    ? `✨ ${product.name} — abhi 4A Store par! / अभी ऑर्डर करें!\n${productUrl}`
    : '';

  const category = categories.find((c) => c.slug === categorySlug);
  const categoryUrl = categorySlug ? `${SITE_ORIGIN}/products?category=${encodeURIComponent(categorySlug)}` : '';
  const categoryCaption = category
    ? `🛍️ ${category.name} — dekhiye 4A Store par! / देखें!\n${categoryUrl}`
    : '';

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 560 }}>
      <p style={{ fontSize: 12, color: 'var(--gray)', margin: 0 }}>
        Ready-to-share links — WhatsApp me rich preview (image + title) apne aap render hota hai (existing OG share).
      </p>

      <div style={card}>
        <strong style={{ fontSize: 14, color: 'var(--primary-dark)' }}>🏪 Store / स्टोर</strong>
        <div style={{ fontSize: 12, color: 'var(--gray)', wordBreak: 'break-all', margin: '6px 0 10px' }}>{storeUrl}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => openWhatsApp(null, storeCaption)} style={btnWa}>💬 Share on WhatsApp</button>
          <button type="button" onClick={() => copyText(storeUrl, 'Link copied')} style={btnGhost}>📋 Copy link</button>
        </div>
      </div>

      <div style={card}>
        <strong style={{ fontSize: 14, color: 'var(--primary-dark)' }}>🛍️ Product / प्रोडक्ट</strong>
        <select value={productId} onChange={(e) => setProductId(e.target.value)} style={{ ...inp, margin: '8px 0 10px' }}>
          <option value="">— Choose product —</option>
          {products.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
        </select>
        {productId && <div style={{ fontSize: 12, color: 'var(--gray)', wordBreak: 'break-all', marginBottom: 10 }}>{productUrl}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" disabled={!productId} onClick={() => openWhatsApp(null, productCaption)} style={btnWa}>💬 Share on WhatsApp</button>
          <button type="button" disabled={!productId} onClick={() => copyText(productUrl, 'Link copied')} style={btnGhost}>📋 Copy link</button>
        </div>
      </div>

      <div style={card}>
        <strong style={{ fontSize: 14, color: 'var(--primary-dark)' }}>🗂️ Category / श्रेणी</strong>
        <select value={categorySlug} onChange={(e) => setCategorySlug(e.target.value)} style={{ ...inp, margin: '8px 0 10px' }}>
          <option value="">— Choose category —</option>
          {categories.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
        </select>
        {categorySlug && <div style={{ fontSize: 12, color: 'var(--gray)', wordBreak: 'break-all', marginBottom: 10 }}>{categoryUrl}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" disabled={!categorySlug} onClick={() => openWhatsApp(null, categoryCaption)} style={btnWa}>💬 Share on WhatsApp</button>
          <button type="button" disabled={!categorySlug} onClick={() => copyText(categoryUrl, 'Link copied')} style={btnGhost}>📋 Copy link</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Section: Campaign History & Reports ---------- */

function CampaignHistory() {
  const campaignsQ = useQuery({ queryKey: ['marketing-campaigns'], queryFn: () => fetchCampaigns({ limit: 100 }) });
  const reportsQ = useQuery({ queryKey: ['marketing-reports'], queryFn: fetchMarketingReports });

  const campaigns = campaignsQ.data ?? [];
  const r = reportsQ.data;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={card}>
        <strong style={cardTitle}>📊 Reports / रिपोर्ट</strong>
        <p style={{ ...muted, margin: '4px 0 10px' }}>
          ⚠️ <strong>“WhatsApp links opened”</strong> ka matlab link khula — <strong>sent/delivered NAHI</strong>.
          Manual outreach me delivery track nahi hoti.
        </p>
        {reportsQ.isError && <div style={errBox}>{apiError(reportsQ.error)}</div>}
        {r ? (
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <ReportStat label="Campaigns created / कैंपेन बने" value={r.campaignsCreated} />
            <ReportStat label="Banners downloaded / बैनर" value={r.bannersDownloaded} />
            <ReportStat label="Messages copied / कॉपी किए" value={r.messagesCopied} />
            <ReportStat label="WhatsApp links opened (≠ sent)" value={r.waLinksOpened} />
            <ReportStat label="Products promoted / प्रचारित" value={r.productsPromoted} />
            <ReportStat label="Batches prepared / बैच" value={r.batchesPrepared} />
          </div>
        ) : (
          <p style={muted}>{reportsQ.isLoading ? 'Loading…' : 'No report data.'}</p>
        )}
      </div>

      <div style={card}>
        <strong style={cardTitle}>📈 Campaign history / कैंपेन इतिहास</strong>
        {campaignsQ.isError && <div style={errBox}>{apiError(campaignsQ.error)}</div>}
        <div style={{ ...tableWrap, marginTop: 10 }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Products</th>
                <th>Customers</th>
                <th>Status</th>
                <th>Created</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.length ? campaigns.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td style={{ fontSize: 12 }}>{c.category || '—'}</td>
                  <td style={{ textAlign: 'center' }}>{c.product_ids?.length || 0}</td>
                  <td style={{ textAlign: 'center' }}>{c.customer_mobiles?.length || 0}</td>
                  <td style={{ fontSize: 12 }}>{c.status}</td>
                  <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDateTime(c.created_at)}</td>
                  <td style={{ fontSize: 12, maxWidth: 220 }}>{c.notes || '—'}</td>
                </tr>
              )) : (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 20, color: 'var(--gray)' }}>
                  {campaignsQ.isLoading ? 'Loading…' : 'Abhi tak koi campaign nahi.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ReportStat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--primary-dark)' }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--gray)' }}>{label}</div>
    </div>
  );
}

/* ---------- shared styles ---------- */

const lbl: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--primary-dark)', marginBottom: 4 };
const inp: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '2px solid var(--border)', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' };
const btnPrimary: React.CSSProperties = { padding: '9px 18px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const btnWa: React.CSSProperties = { padding: '7px 14px', background: '#25D366', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const btnWaBlock: React.CSSProperties = { width: '100%', padding: '12px 18px', background: '#25D366', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer' };
const btnGhost: React.CSSProperties = { padding: '7px 12px', background: '#f1f5f9', color: 'var(--primary-dark)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const btnDanger: React.CSSProperties = { padding: '7px 12px', background: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const btnChip: React.CSSProperties = { padding: '6px 12px', background: 'var(--primary-light)', color: 'var(--primary-dark)', border: '1px solid var(--border)', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer' };
const btnChipActive: React.CSSProperties = { ...btnChip, background: 'var(--primary)', color: '#fff' };
const errBox: React.CSSProperties = { background: '#fee2e2', color: '#b91c1c', padding: 10, borderRadius: 8, marginBottom: 12 };
const tableWrap: React.CSSProperties = { overflowX: 'auto', background: '#fff', border: '1px solid var(--border)', borderRadius: 12 };
const card: React.CSSProperties = { background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 16, boxShadow: 'var(--shadow)' };
const cardTitle: React.CSSProperties = { fontSize: 14, color: 'var(--primary-dark)', display: 'block' };
const muted: React.CSSProperties = { fontSize: 12, color: 'var(--gray)' };
const subHead: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: 'var(--primary-dark)', margin: '4px 0' };
const listReset: React.CSSProperties = { listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 4 };
const liRow: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, padding: '3px 0', borderBottom: '1px solid #f1f5f9' };
const chk: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--primary-dark)', cursor: 'pointer' };
const modalOverlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, zIndex: 1000, overflowY: 'auto' };
const modalBox: React.CSSProperties = { background: '#fff', borderRadius: 12, padding: 20, maxWidth: 640, width: '100%', boxShadow: 'var(--shadow)' };
