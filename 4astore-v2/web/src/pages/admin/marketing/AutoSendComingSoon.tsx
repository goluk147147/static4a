/* ------------------------------------------------------------------ *
 * WhatsApp API (Cloud API — LIVE) config + real server-side send.
 * ------------------------------------------------------------------ *
 * - Marketing/promotional TEMPLATE messages (image header + dynamic
 *   text body) are sent SERVER-SIDE via the Meta Cloud API. Templates
 *   must be PRE-APPROVED in Meta; the header image must be a public
 *   https URL. This reaches customers even if they never saved our
 *   number — that is what approved templates allow.
 * - The access token stays SERVER-ONLY: it is saved into the admin
 *   settings blob (masked here) and the Node backend reads it per send.
 *   This UI never transmits the token on a send call.
 * - The FREE wa.me click-to-share flow (lib/whatsapp.ts) is UNTOUCHED
 *   and remains the default manual path. This is the ADDITIONAL paid
 *   API path.
 * ------------------------------------------------------------------ */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchAdminSettings,
  saveAdminSettings,
  fetchReach,
  sendWhatsAppTest,
  sendWhatsAppBroadcast,
  type WhatsappApiConfig,
  type ReachCustomer,
  type WhatsAppBroadcastResult,
} from '../../../lib/admin';
import { showToast } from '../../../store/toast';
import { apiError } from '../../../lib/api';

const DEFAULT_CFG: WhatsappApiConfig = {
  provider: 'none',
  baseUrl: '',
  token: '',
  phoneNumberId: '',
  wabaId: '',
  enabled: false,
};

// Mask a token for display — never show the raw value; keep only the last 4.
function maskToken(token: string): string {
  if (!token) return '';
  if (token.length <= 4) return '•'.repeat(token.length);
  return '•'.repeat(Math.min(token.length - 4, 20)) + token.slice(-4);
}

/** Split comma- or newline-separated body params into a trimmed string[]. */
function parseBodyParams(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export default function AutoSendComingSoon() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['admin-settings'], queryFn: fetchAdminSettings });

  const [cfg, setCfg] = useState<WhatsappApiConfig>(DEFAULT_CFG);
  // Track whether the user typed a new token this session. The stored token is
  // never shown raw; we display a masked placeholder and only overwrite it on
  // save when the user actually enters something.
  const [tokenDirty, setTokenDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data?.whatsappApi) {
      setCfg({ ...DEFAULT_CFG, ...data.whatsappApi });
      setTokenDirty(false);
    }
  }, [data]);

  const set = <K extends keyof WhatsappApiConfig>(k: K, v: WhatsappApiConfig[K]) =>
    setCfg((c) => ({ ...c, [k]: v }));

  const savedToken = data?.whatsappApi?.token || '';
  const liveReady = cfg.provider === 'cloud_api' && cfg.enabled;

  async function save() {
    setBusy(true);
    try {
      // Only send the token when the user actually changed it this session, so
      // saving other fields never wipes the stored token with a masked value.
      const payload: WhatsappApiConfig = {
        ...cfg,
        token: tokenDirty ? cfg.token : savedToken,
      };
      await saveAdminSettings({ whatsappApi: payload });
      showToast('WhatsApp API config saved / सेटिंग्स सेव हो गईं', 'success');
      qc.invalidateQueries({ queryKey: ['admin-settings'] });
      setTokenDirty(false);
    } catch (e) {
      showToast(apiError(e) || 'Failed to save WhatsApp API config', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 680 }}>
      <div style={banner}>
        <div style={{ fontSize: 34 }}>📲</div>
        <strong style={{ fontSize: 16, color: '#1b5e20' }}>WhatsApp API (Cloud API — LIVE)</strong>
        <p style={{ margin: '8px 0 0', fontSize: 13, color: '#1b5e20', lineHeight: 1.5 }}>
          Ab <strong>official Meta WhatsApp Cloud API</strong> se marketing <strong>template</strong> messages
          server-side bhej sakte hain — image + dynamic text. Approved template se un customers tak bhi
          pahunch hoti hai jinhone number save nahi kiya. Token server par hi rehta hai (masked), kabhi browser
          me expose nahi hota. <strong>Free wa.me manual share alag hai aur waise ka waise chalega.</strong>
        </p>
      </div>

      <div style={noteBox}>
        <strong style={{ fontSize: 12, color: '#8d5d00' }}>⚠️ Zaroori / Important</strong>
        <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, color: '#8d5d00', lineHeight: 1.6 }}>
          <li>Template Meta Business me <strong>pre-approved</strong> hona chahiye (IMAGE header + body {'{{1}}'} variables).</li>
          <li>Image ek <strong>public https URL</strong> honi chahiye — Meta usse khud fetch karta hai.</li>
          <li>Template ka <strong>exact name</strong> + <strong>language code</strong> (jaise <code>en</code>) wahi daalein jo Meta me approve hua.</li>
        </ul>
      </div>

      <div style={card}>
        <strong style={cardTitle}>⚙️ WhatsApp API settings / API सेटिंग्स</strong>
        <p style={{ ...muted, margin: '6px 0 10px', lineHeight: 1.5 }}>
          Credentials yahan bhariye. Provider <strong>WhatsApp Cloud API</strong> + <strong>Enabled</strong> on
          hone par hi send chalega.
        </p>

        <div style={{ display: 'grid', gap: 12 }}>
          <label style={field}>
            <span style={lbl}>Provider / प्रोवाइडर</span>
            <select
              style={inp}
              value={cfg.provider}
              onChange={(e) => set('provider', e.target.value as WhatsappApiConfig['provider'])}
            >
              <option value="none">Band / Off</option>
              <option value="cloud_api">WhatsApp Cloud API (Meta)</option>
              <option value="custom">Custom</option>
            </select>
          </label>

          <label style={field}>
            <span style={lbl}>Base URL / बेस URL</span>
            <input
              style={inp}
              type="text"
              placeholder="https://graph.facebook.com/v20.0"
              value={cfg.baseUrl}
              onChange={(e) => set('baseUrl', e.target.value)}
            />
            <span style={{ ...muted, fontSize: 11 }}>Khaali chhodenge to default: https://graph.facebook.com/v20.0</span>
          </label>

          <label style={field}>
            <span style={lbl}>Access token / एक्सेस टोकन</span>
            <input
              style={inp}
              type="password"
              autoComplete="off"
              placeholder={savedToken && !tokenDirty ? maskToken(savedToken) : 'Enter token'}
              value={tokenDirty ? cfg.token : ''}
              onChange={(e) => {
                setTokenDirty(true);
                set('token', e.target.value);
              }}
            />
            <span style={{ ...muted, fontSize: 11 }}>
              {savedToken && !tokenDirty
                ? `Saved token: ${maskToken(savedToken)} — kuch type karne par hi badlega. Server par hi store hota hai.`
                : 'Token kabhi raw dikhaya nahi jaata (masked) aur sirf server par rehta hai.'}
            </span>
          </label>

          <label style={field}>
            <span style={lbl}>Phone number ID / फ़ोन नंबर ID</span>
            <input
              style={inp}
              type="text"
              placeholder="123456789012345"
              value={cfg.phoneNumberId}
              onChange={(e) => set('phoneNumberId', e.target.value)}
            />
          </label>

          <label style={field}>
            <span style={lbl}>WhatsApp Business Account ID (WABA) / वाबा ID</span>
            <input
              style={inp}
              type="text"
              placeholder="100000000000000 (optional)"
              value={cfg.wabaId || ''}
              onChange={(e) => set('wabaId', e.target.value)}
            />
            <span style={{ ...muted, fontSize: 11 }}>Optional — reference ke liye. Send ke liye zaroori nahi.</span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={cfg.enabled}
              onChange={(e) => set('enabled', e.target.checked)}
            />
            <span style={lbl}>Enabled / चालू (default: OFF)</span>
          </label>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button style={btnPrimary} onClick={save} disabled={busy}>
              {busy ? 'Saving…' : '💾 Save config'}
            </button>
          </div>
        </div>
      </div>

      <SendTestCard liveReady={liveReady} />

      <WhatsAppCampaign liveReady={liveReady} />

      <p style={{ ...muted, fontSize: 11, textAlign: 'center' }}>
        Paid official API path. Free wa.me Broadcast Helper alag tab me waise ka waise hai. link opened ≠ sent.
      </p>
    </div>
  );
}

/* ---------- Send test (ONE message) ---------- */

function SendTestCard({ liveReady }: { liveReady: boolean }) {
  const [recipient, setRecipient] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [languageCode, setLanguageCode] = useState('en');
  const [imageUrl, setImageUrl] = useState('');
  const [bodyParamsRaw, setBodyParamsRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function run() {
    if (!recipient.trim() || !templateName.trim()) {
      showToast('Recipient mobile aur template name zaroori hain', 'error');
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const res = await sendWhatsAppTest({
        recipientPhone: recipient.trim(),
        templateName: templateName.trim(),
        languageCode: languageCode.trim() || 'en',
        imageUrl: imageUrl.trim() || undefined,
        bodyParams: parseBodyParams(bodyParamsRaw),
      });
      setResult({ ok: true, text: `✅ Sent — message id: ${res.messageId || '(none returned)'}` });
    } catch (e) {
      setResult({ ok: false, text: `❌ ${apiError(e) || 'Send failed'}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={card}>
      <strong style={cardTitle}>🧪 Send test / टेस्ट मैसेज</strong>
      <p style={{ ...muted, margin: '6px 0 10px', lineHeight: 1.5 }}>
        Ek number par approved template bhej ke check karein. Meta ka result/error neeche dikhega.
      </p>
      <div style={{ display: 'grid', gap: 12 }}>
        <label style={field}>
          <span style={lbl}>Test recipient mobile / टेस्ट नंबर</span>
          <input style={inp} type="text" placeholder="9876543210" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
        </label>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ ...field, flex: 1, minWidth: 180 }}>
            <span style={lbl}>Template name / टेम्पलेट नाम</span>
            <input style={inp} type="text" placeholder="promo_image_v1" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
          </label>
          <label style={{ ...field, width: 120 }}>
            <span style={lbl}>Language / भाषा</span>
            <input style={inp} type="text" placeholder="en" value={languageCode} onChange={(e) => setLanguageCode(e.target.value)} />
          </label>
        </div>
        <label style={field}>
          <span style={lbl}>Image URL (public https) / इमेज URL — optional</span>
          <input style={inp} type="url" placeholder="https://4astore.com/promo.jpg" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
        </label>
        <label style={field}>
          <span style={lbl}>Body params / बॉडी वैल्यू ({'{{1}}, {{2}}'}…) — comma ya line se alag</span>
          <input style={inp} type="text" placeholder="Ramesh, 20%" value={bodyParamsRaw} onChange={(e) => setBodyParamsRaw(e.target.value)} />
        </label>
        <div>
          <button
            style={{ ...btnPrimary, opacity: liveReady ? 1 : 0.5, cursor: liveReady && !busy ? 'pointer' : 'not-allowed' }}
            onClick={run}
            disabled={!liveReady || busy}
            title={liveReady ? '' : 'Pehle provider=Cloud API + Enabled on karke save karein'}
          >
            {busy ? 'Sending…' : '🧪 Send test'}
          </button>
          {!liveReady && (
            <span style={{ ...muted, fontSize: 11, marginLeft: 10 }}>Provider=Cloud API + Enabled on + save ke baad chalega.</span>
          )}
        </div>
        {result && (
          <div style={{ ...resultBox, borderColor: result.ok ? '#a5d6a7' : '#ef9a9a', background: result.ok ? '#e8f5e9' : '#ffebee', color: result.ok ? '#1b5e20' : '#b71c1c' }}>
            {result.text}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- WhatsApp Campaign (paid API broadcast) ---------- */

function WhatsAppCampaign({ liveReady }: { liveReady: boolean }) {
  const [templateName, setTemplateName] = useState('');
  const [languageCode, setLanguageCode] = useState('en');
  const [imageUrl, setImageUrl] = useState('');
  const [bodyParamsRaw, setBodyParamsRaw] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<WhatsAppBroadcastResult | null>(null);

  const reachQ = useQuery({ queryKey: ['marketing-reach', 'wa-campaign'], queryFn: () => fetchReach() });
  const customers: ReachCustomer[] = reachQ.data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => c.name.toLowerCase().includes(q) || c.mobile.includes(q));
  }, [customers, search]);

  function toggle(mobile: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(mobile)) next.delete(mobile);
      else next.add(mobile);
      return next;
    });
  }
  function selectAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of filtered) next.add(c.mobile);
      return next;
    });
  }
  function clearSelection() {
    setSelected(new Set());
  }

  async function send() {
    if (!templateName.trim()) {
      showToast('Template name zaroori hai', 'error');
      return;
    }
    const recipients = Array.from(selected);
    if (recipients.length === 0) {
      showToast('Kam se kam ek customer chunein', 'error');
      return;
    }
    if (recipients.length > 500) {
      showToast('Ek baar me max 500 — kam karein', 'error');
      return;
    }
    setBusy(true);
    setSummary(null);
    try {
      const res = await sendWhatsAppBroadcast({
        templateName: templateName.trim(),
        languageCode: languageCode.trim() || 'en',
        imageUrl: imageUrl.trim() || undefined,
        bodyParams: parseBodyParams(bodyParamsRaw),
        recipients,
      });
      setSummary(res);
      showToast(`Done — ${res.sent}/${res.total} sent`, res.failed === 0 ? 'success' : 'info');
    } catch (e) {
      showToast(apiError(e) || 'Broadcast failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={card}>
      <strong style={cardTitle}>📣 Send WhatsApp campaign (paid API) / कैंपेन भेजें</strong>
      <p style={{ ...muted, margin: '6px 0 10px', lineHeight: 1.5 }}>
        Approved template ko kai customers ko bhejein. Ye <strong>paid API</strong> path hai — free wa.me
        Broadcast Helper alag tab me hai. Rate-limit ke saath sequential bhejta hai (default ~1s gap).
      </p>

      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ ...field, flex: 1, minWidth: 180 }}>
            <span style={lbl}>Template name / टेम्पलेट नाम</span>
            <input style={inp} type="text" placeholder="promo_image_v1" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
          </label>
          <label style={{ ...field, width: 120 }}>
            <span style={lbl}>Language / भाषा</span>
            <input style={inp} type="text" placeholder="en" value={languageCode} onChange={(e) => setLanguageCode(e.target.value)} />
          </label>
        </div>
        <label style={field}>
          <span style={lbl}>Image URL (public https) / इमेज URL — optional</span>
          <input style={inp} type="url" placeholder="https://4astore.com/promo.jpg" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
        </label>
        <label style={field}>
          <span style={lbl}>Body params / बॉडी वैल्यू ({'{{1}}'}…) — comma ya line se alag</span>
          <input style={inp} type="text" placeholder="4A Store, 20%" value={bodyParamsRaw} onChange={(e) => setBodyParamsRaw(e.target.value)} />
          <span style={{ ...muted, fontSize: 11 }}>Sabhi recipients ke liye same body params jaate hain.</span>
        </label>

        <div style={field}>
          <span style={lbl}>Recipients / ग्राहक ({selected.size} selected)</span>
          <input style={inp} type="text" placeholder="Search name or mobile…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, margin: '8px 0', flexWrap: 'wrap' }}>
            <button type="button" style={btnGhost} onClick={selectAllFiltered} disabled={!filtered.length}>Select all (filtered)</button>
            <button type="button" style={btnGhost} onClick={clearSelection} disabled={!selected.size}>Clear</button>
          </div>
          {reachQ.isLoading && <p style={muted}>Loading customers…</p>}
          {reachQ.isError && <div style={{ ...resultBox, borderColor: '#ef9a9a', background: '#ffebee', color: '#b71c1c' }}>{apiError(reachQ.error)}</div>}
          {!reachQ.isLoading && !reachQ.isError && (
            <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              {filtered.length ? filtered.map((c) => (
                <label key={c.mobile} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                  <input type="checkbox" checked={selected.has(c.mobile)} onChange={() => toggle(c.mobile)} />
                  <span style={{ flex: 1 }}>{c.name}</span>
                  <span style={{ color: 'var(--gray)', fontSize: 12 }}>{c.mobile}</span>
                </label>
              )) : (
                <p style={{ ...muted, padding: 12, textAlign: 'center' }}>No customers match.</p>
              )}
            </div>
          )}
        </div>

        <div>
          <button
            style={{ ...btnPrimary, opacity: liveReady ? 1 : 0.5, cursor: liveReady && !busy ? 'pointer' : 'not-allowed' }}
            onClick={send}
            disabled={!liveReady || busy}
            title={liveReady ? '' : 'Pehle provider=Cloud API + Enabled on karke save karein'}
          >
            {busy ? `Sending to ${selected.size}…` : `📣 Send to ${selected.size}`}
          </button>
          {!liveReady && (
            <span style={{ ...muted, fontSize: 11, marginLeft: 10 }}>Provider=Cloud API + Enabled on + save ke baad chalega.</span>
          )}
        </div>

        {summary && (
          <div style={{ ...resultBox, borderColor: summary.failed === 0 ? '#a5d6a7' : '#ffcc80', background: summary.failed === 0 ? '#e8f5e9' : '#fff8e1', color: '#333' }}>
            <strong>Total {summary.total} • Sent {summary.sent} • Failed {summary.failed}</strong>
            {summary.failed > 0 && (
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12 }}>
                {summary.results.filter((r) => !r.ok).map((r, i) => (
                  <li key={`${r.mobile}-${i}`}>{r.mobile}: {r.error || 'failed'}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const banner: React.CSSProperties = { background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 12, padding: 20, textAlign: 'center' };
const noteBox: React.CSSProperties = { background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 12, padding: 14 };
const card: React.CSSProperties = { background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 16, boxShadow: 'var(--shadow)' };
const cardTitle: React.CSSProperties = { fontSize: 14, color: 'var(--primary-dark)', display: 'block' };
const muted: React.CSSProperties = { fontSize: 12, color: 'var(--gray)' };
const field: React.CSSProperties = { display: 'grid', gap: 4 };
const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--text)' };
const inp: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13 };
const btnPrimary: React.CSSProperties = { padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const btnGhost: React.CSSProperties = { padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: '#fff', color: 'var(--text)', fontSize: 12, fontWeight: 600, cursor: 'pointer' };
const resultBox: React.CSSProperties = { padding: '10px 12px', borderRadius: 8, border: '1px solid', fontSize: 13, lineHeight: 1.5 };
