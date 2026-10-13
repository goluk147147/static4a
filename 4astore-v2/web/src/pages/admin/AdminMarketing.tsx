import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchReach, ReachCustomer } from '../../lib/admin';
import { apiError } from '../../lib/api';
import { useProducts, useCategories } from '../../lib/queries';
import { waLink, openWhatsApp } from '../../lib/whatsapp';
import { showToast } from '../../store/toast';
import EmojiPicker from '../../components/EmojiPicker';

// Public site origin — WhatsApp's crawler hits these SPA URLs and nginx rewrites
// crawler UAs to the /api/og/* routes, so link previews render automatically.
// In production the SPA + API share one host, so window.location.origin is the
// store origin; fall back to the known canonical for safety.
const SITE_ORIGIN =
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

function fmtDate(v: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function copyText(text: string, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`✅ ${label}`, 'success');
  } catch {
    showToast('Copy failed — please copy manually', 'error');
  }
}

const SUB_TABS: [string, string][] = [
  ['reach', '👥 Customer Reach'],
  ['composer', '✍️ Promo Message'],
  ['broadcast', '📤 Broadcast Helper'],
  ['links', '🔗 Share Links'],
];

export default function AdminMarketing() {
  const [sub, setSub] = useState<'reach' | 'composer' | 'broadcast' | 'links'>('reach');

  // The composed promo message is shared across Reach, Composer and Broadcast.
  const [message, setMessage] = useState(TEMPLATES[0][1]);

  return (
    <div style={{ maxWidth: 920 }}>
      <div style={{ marginBottom: 14 }}>
        <h4 style={{ margin: '0 0 4px' }}>📣 Marketing (WhatsApp)</h4>
        <p style={{ fontSize: 13, color: 'var(--gray)', margin: 0 }}>
          FREE manual WhatsApp outreach / मुफ्त मैनुअल WhatsApp प्रचार. Har message aapke apne phone se jaata hai —
          koi paid API nahi, koi charge nahi.
        </p>
      </div>

      {/* Sub-tab switcher */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        {SUB_TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setSub(key as typeof sub)}
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

      {sub === 'reach' && <ReachList message={message} />}
      {sub === 'composer' && <PromoComposer message={message} setMessage={setMessage} />}
      {sub === 'broadcast' && <BroadcastHelper message={message} />}
      {sub === 'links' && <ShareLinks />}
    </div>
  );
}

/* ---------- Section 1: Customer Reach List ---------- */

function ReachList({ message }: { message: string }) {
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

  const rows = query.data ?? [];

  return (
    <>
      <form onSubmit={apply} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label style={lbl}>Search / खोजें (name or mobile)</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. Ramesh / 9876…" style={inp} />
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

      <p style={{ fontSize: 12, color: 'var(--gray)', margin: '0 0 10px' }}>
        Sirf asli 10-digit WhatsApp numbers / only real 10-digit WhatsApp numbers (Google-only accounts hidden).
        Har row ka <strong>WhatsApp</strong> button aapka current promo message (Promo Message tab) prefill karta hai.
      </p>

      {query.isError && <div style={errBox}>{apiError(query.error)}</div>}

      <div style={tableWrap}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name / नाम</th>
              <th>Mobile</th>
              <th>Last order</th>
              <th>Orders</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((c) => (
                <tr key={c.mobile}>
                  <td>{c.name}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{c.mobile}</td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDate(c.lastOrderAt)}</td>
                  <td style={{ textAlign: 'center' }}>{c.orders}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button type="button" onClick={() => openWhatsApp(c.mobile, message)} style={btnWa}>💬 WhatsApp</button>
                      <button type="button" onClick={() => copyText(c.mobile, 'Number copied')} style={btnGhost}>📋 Copy</button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--gray)' }}>
                  {query.isLoading ? 'Loading…' : 'Koi customer nahi mila / no customers found.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > 0 && <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: 10 }}>{rows.length} customers</p>}
    </>
  );
}

/* ---------- Section 2: Promo Message Composer ---------- */

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
        WhatsApp khulega — koi bhi chat ya group chunkar Send dabayein.
      </p>
    </div>
  );
}

/* ---------- Section 3: Broadcast Helper ---------- */

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
      <div style={{ background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 12, padding: 14, marginBottom: 16 }}>
        <strong style={{ color: '#1b5e20', fontSize: 14 }}>ℹ️ Manual send / मैनुअल भेजना (FREE)</strong>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: '#1b5e20' }}>
          Niche har customer ka WhatsApp button hai. Button dabane par WhatsApp aapke promo message ke saath khulta
          hai — aap <strong>ek-ek karke khud Send</strong> dabate hain apne phone se. Ye automated bulk nahi hai,
          koi paid API nahi — bilkul free. Batches me bhejein taaki number block na ho.
        </p>
      </div>

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
                  <td style={{ whiteSpace: 'nowrap' }}>{c.mobile}</td>
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
      {rows.length > 0 && <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: 10 }}>{rows.length} customers — tap each, send one at a time.</p>}
    </>
  );
}

/* ---------- Section 4: Shareable Promo Links ---------- */

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

      {/* Store */}
      <div style={card}>
        <strong style={{ fontSize: 14, color: 'var(--primary-dark)' }}>🏪 Store / स्टोर</strong>
        <div style={{ fontSize: 12, color: 'var(--gray)', wordBreak: 'break-all', margin: '6px 0 10px' }}>{storeUrl}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => openWhatsApp(null, storeCaption)} style={btnWa}>💬 Share on WhatsApp</button>
          <button type="button" onClick={() => copyText(storeUrl, 'Link copied')} style={btnGhost}>📋 Copy link</button>
        </div>
      </div>

      {/* Product */}
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

      {/* Category */}
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

      {/* Coming soon note */}
      <div style={{ background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 12, padding: 14 }}>
        <strong style={{ color: '#8d5d00', fontSize: 13 }}>🏷️ Coupons & referrals — coming soon</strong>
        <p style={{ margin: '6px 0 0', fontSize: 12, color: '#8d5d00' }}>
          Discount codes aur referral abhi available nahi hain (schema me discount support nahi hai). Baad me add
          kiye jaa sakte hain.
        </p>
      </div>
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
const btnChip: React.CSSProperties = { padding: '6px 12px', background: 'var(--primary-light)', color: 'var(--primary-dark)', border: '1px solid var(--border)', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer' };
const errBox: React.CSSProperties = { background: '#fee2e2', color: '#b91c1c', padding: 10, borderRadius: 8, marginBottom: 12 };
const tableWrap: React.CSSProperties = { overflowX: 'auto', background: '#fff', border: '1px solid var(--border)', borderRadius: 12 };
const card: React.CSSProperties = { background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 16, boxShadow: 'var(--shadow)' };
