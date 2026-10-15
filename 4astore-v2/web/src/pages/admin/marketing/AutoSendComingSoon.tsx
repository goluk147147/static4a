/* ------------------------------------------------------------------ *
 * Auto-send / WhatsApp API — HONEST scaffold + PREP-ONLY config form.
 * ------------------------------------------------------------------ *
 * - Automatic WhatsApp sending needs the PAID WhatsApp Business /
 *   Cloud API. The free wa.me click-to-share used elsewhere in this
 *   Marketing Center only OPENS a chat — it NEVER auto-sends.
 * - The config form below only SAVES the API settings (prep). It does
 *   NOT send anything: lib/whatsapp.ts (free wa.me) stays the only
 *   active send path, and lib/waSender.ts is dormant. The "Send test"
 *   button never fires a real network request.
 * ------------------------------------------------------------------ */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchAdminSettings, saveAdminSettings, type WhatsappApiConfig } from '../../../lib/admin';
import { sendViaApi } from '../../../lib/waSender';
import { showToast } from '../../../store/toast';
import { apiError } from '../../../lib/api';

const DEFAULT_CFG: WhatsappApiConfig = {
  provider: 'none',
  baseUrl: '',
  token: '',
  phoneNumberId: '',
  enabled: false,
};

// Mask a token for display — never show the raw value; keep only the last 4.
function maskToken(token: string): string {
  if (!token) return '';
  if (token.length <= 4) return '•'.repeat(token.length);
  return '•'.repeat(Math.min(token.length - 4, 20)) + token.slice(-4);
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
  const canSendTest = cfg.provider !== 'none' && cfg.enabled;

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
      showToast('WhatsApp API config saved (prep only — abhi kuch bheja nahi jaata)', 'success');
      qc.invalidateQueries({ queryKey: ['admin-settings'] });
      setTokenDirty(false);
    } catch (e) {
      showToast(apiError(e) || 'Failed to save WhatsApp API config', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    // Inert on purpose: waSender.ts is dormant and makes NO network request.
    const res = await sendViaApi({ to: '', text: '' }, cfg);
    showToast(res.error || 'WhatsApp API send not implemented yet', 'info');
  }

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 640 }}>
      <div style={banner}>
        <div style={{ fontSize: 34 }}>🤖</div>
        <strong style={{ fontSize: 16, color: '#8d5d00' }}>WhatsApp API — prep only (abhi live nahi)</strong>
        <p style={{ margin: '8px 0 0', fontSize: 13, color: '#8d5d00', lineHeight: 1.5 }}>
          <strong>Auto-send</strong> ke liye paid official <strong>WhatsApp Business / Cloud API</strong> chahiye. Yahan aap
          settings <strong>pehle se bhar</strong> ke rakh sakte hain. Jab API aa jaaye, bas on karna hai. Abhi ye settings
          sirf save hoti hain — koi message apne aap nahi jaata.
        </p>
      </div>

      <div style={card}>
        <strong style={cardTitle}>📤 Automatic WhatsApp send</strong>
        <p style={{ ...muted, margin: '6px 0 0', lineHeight: 1.5 }}>
          Is store me abhi wahi <strong>free manual wa.me</strong> use hota hai — wo sirf chat <strong>kholta</strong> hai,
          Send aapko khud dabana padta hai. <strong>wa.me kabhi apne aap message nahi bhejta</strong> (link opened ≠ sent).
        </p>
      </div>

      <div style={card}>
        <strong style={cardTitle}>⚙️ WhatsApp API settings / API सेटिंग्स</strong>
        <p style={{ ...muted, margin: '6px 0 10px', lineHeight: 1.5 }}>
          Yahan sirf config save hoti hai (prep). Save karne par kuch bheja nahi jaata.
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
                ? `Saved token: ${maskToken(savedToken)} — kuch type karne par hi badlega.`
                : 'Token kabhi raw dikhaya nahi jaata (masked).'}
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
            <button
              style={{ ...btnGhost, opacity: canSendTest ? 1 : 0.5, cursor: canSendTest ? 'pointer' : 'not-allowed' }}
              onClick={sendTest}
              disabled={!canSendTest}
              title="Coming soon — API add hone par kaam karega"
            >
              🧪 Send test (coming soon when API added)
            </button>
          </div>
        </div>
      </div>

      <p style={{ ...muted, fontSize: 11, textAlign: 'center' }}>
        Honest scaffold — koi feature fake nahi ki gayi. Config save hoti hai; message tabhi jaayega jab paid API add +
        on hoga. link opened ≠ sent.
      </p>
    </div>
  );
}

const banner: React.CSSProperties = { background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 12, padding: 20, textAlign: 'center' };
const card: React.CSSProperties = { background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 16, boxShadow: 'var(--shadow)' };
const cardTitle: React.CSSProperties = { fontSize: 14, color: 'var(--primary-dark)', display: 'block' };
const muted: React.CSSProperties = { fontSize: 12, color: 'var(--gray)' };
const field: React.CSSProperties = { display: 'grid', gap: 4 };
const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--text)' };
const inp: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13 };
const btnPrimary: React.CSSProperties = { padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const btnGhost: React.CSSProperties = { padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: '#fff', color: 'var(--text)', fontSize: 13, fontWeight: 600 };
