import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiError } from '../../../lib/api';
import { saveVideoSettings, runAutoNow, VideoSettings, MetaStatus } from '../../../lib/videos';
import { showToast } from '../../../store/toast';
import { VIDEOS_KEY } from './VideoLibrary';

/** Store details used in videos + daily auto-generation settings + Phase 2 (Meta) status. */
export default function VideoSettingsPanel({ settings, meta, onRan }: { settings: VideoSettings; meta: MetaStatus | undefined; onRan: () => void }) {
  const qc = useQueryClient();
  const [s, setS] = useState<VideoSettings>(settings);
  const [busy, setBusy] = useState<'' | 'save' | 'run'>('');
  useEffect(() => setS(settings), [settings]);

  const st = (k: keyof VideoSettings['store'], v: string | number) => setS((c) => ({ ...c, store: { ...c.store, [k]: v } }));
  const th = (k: keyof VideoSettings['store']['theme'], v: string) => setS((c) => ({ ...c, store: { ...c.store, theme: { ...c.store.theme, [k]: v } } }));
  const au = <K extends keyof VideoSettings['auto']>(k: K, v: VideoSettings['auto'][K]) => setS((c) => ({ ...c, auto: { ...c.auto, [k]: v } }));

  async function save() {
    if (!s.auto.formats.length) return showToast('Kam se kam ek format chuniye', 'error');
    setBusy('save');
    try {
      const r = await saveVideoSettings(s);
      showToast(r.removed ? `Settings saved — ${r.removed} purane videos hataye` : 'Video settings saved', 'success');
      qc.invalidateQueries({ queryKey: ['video-settings'] });
      qc.invalidateQueries({ queryKey: ['video-today'] });
      qc.invalidateQueries({ queryKey: VIDEOS_KEY });
    } catch (e) {
      showToast(apiError(e) || 'Failed to save settings', 'error');
    } finally {
      setBusy('');
    }
  }

  async function runNow() {
    setBusy('run');
    try {
      const r = await runAutoNow();
      showToast(r.message, 'success');
      qc.invalidateQueries({ queryKey: VIDEOS_KEY });
      onRan();
    } catch (e) {
      showToast(apiError(e) || 'Run failed', 'error');
    } finally {
      setBusy('');
    }
  }

  const text = (k: keyof VideoSettings['store'], label: string, max = 80, hint?: string) => (
    <div className="va-field">
      <label htmlFor={`vs_${k}`}>{label}</label>
      <input id={`vs_${k}`} value={String(s.store[k])} maxLength={max} onChange={(e) => st(k, e.target.value)} />
      {hint && <small>{hint}</small>}
    </div>
  );

  return (
    <>
      <div className="va-card">
        <h4>🏪 Store details (video me dikhte hain)</h4>
        <div className="va-grid">
          {text('name', 'Store name', 40)}
          {text('tagline', 'Tagline')}
          {text('phone', '📞 Phone', 20)}
          {text('whatsapp', '💬 WhatsApp', 20)}
          {text('area', '📍 Area (short)', 80, 'e.g. Nabinagar, Aurangabad (Bihar)')}
          {text('address', '📍 Full address', 200)}
          {text('payment', '💳 Payment', 80)}
          <div className="va-field">
            <label htmlFor="vs_dc">🚚 Delivery charge (₹)</label>
            <input id="vs_dc" type="number" min={0} value={s.store.deliveryCharge} onChange={(e) => st('deliveryCharge', Math.max(0, Math.round(Number(e.target.value) || 0)))} />
          </div>
          <div className="va-field">
            <label htmlFor="vs_fa">🆓 FREE delivery above (₹)</label>
            <input id="vs_fa" type="number" min={0} value={s.store.freeAbove} onChange={(e) => st('freeAbove', Math.max(0, Math.round(Number(e.target.value) || 0)))} />
          </div>
          <div className="va-field">
            <label>Theme colours</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(['primary', 'dark', 'light', 'accent', 'ink'] as const).map((k) => (
                <input key={k} type="color" value={s.store.theme[k]} title={k} aria-label={`${k} colour`} onChange={(e) => th(k, e.target.value)} style={{ width: 44, height: 36, padding: 2 }} />
              ))}
            </div>
            <small>primary · dark · light · accent · ink</small>
          </div>
        </div>
      </div>

      <div className="va-card">
        <h4>🤖 Daily auto-generate</h4>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
          <input type="checkbox" checked={s.auto.enabled} onChange={(e) => au('enabled', e.target.checked)} style={{ width: 18, height: 18 }} />
          Roz apne aap video banao (festival ho to festival video, warna "Aaj ka Special")
        </label>
        <div className="va-grid">
          <div className="va-field">
            <label htmlFor="vs_time">Time (IST)</label>
            <input id="vs_time" type="time" value={s.auto.time} onChange={(e) => au('time', e.target.value)} />
          </div>
          <div className="va-field">
            <label htmlFor="vs_lead">Festival se kitne din pehle</label>
            <select id="vs_lead" value={s.auto.leadDays} onChange={(e) => au('leadDays', Number(e.target.value))}>
              <option value={0}>Usi din</option>
              <option value={1}>1 din pehle (kal ka festival)</option>
              <option value={2}>2 din pehle</option>
              <option value={3}>3 din pehle</option>
              <option value={7}>7 din pehle</option>
            </select>
          </div>
          <div className="va-field">
            <label>Formats</label>
            {(['reel', 'square'] as const).map((fm) => (
              <label key={fm} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 500, marginRight: 12 }}>
                <input type="checkbox" checked={s.auto.formats.includes(fm)} onChange={(e) => au('formats', e.target.checked ? [...new Set([...s.auto.formats, fm])] : s.auto.formats.filter((x) => x !== fm))} />
                {fm === 'reel' ? '📱 Reel' : '⬛ Square'}
              </label>
            ))}
          </div>
          <div className="va-field">
            <label htmlFor="vs_dur">Duration</label>
            <select id="vs_dur" value={s.auto.durationSec} onChange={(e) => au('durationSec', Number(e.target.value) as 15 | 24 | 30)}>
              <option value={15}>15 sec</option><option value={24}>24 sec</option><option value={30}>30 sec</option>
            </select>
          </div>
          <div className="va-field">
            <label htmlFor="vs_keep">Kitne videos rakhein (purane auto-delete)</label>
            <input id="vs_keep" type="number" min={1} max={500} value={s.auto.keepLast} onChange={(e) => au('keepLast', Math.min(500, Math.max(1, Math.round(Number(e.target.value) || 30))))} />
          </div>
          <div className="va-field">
            <label htmlFor="vs_notify">Video ready hone par notification</label>
            <select id="vs_notify" value={s.auto.notify ? '1' : '0'} onChange={(e) => au('notify', e.target.value === '1')}>
              <option value="1">🔔 Haan — admins ko push</option><option value="0">Nahi</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <button type="button" className="va-btn" onClick={save} disabled={!!busy}>💾 {busy === 'save' ? 'Saving…' : 'Save Settings'}</button>
          <button type="button" className="va-btn secondary" onClick={runNow} disabled={!!busy} title="Abhi test karein — enable/time ignore karke aaj ka auto video banata hai">▶️ {busy === 'run' ? 'Starting…' : 'Run now (test)'}</button>
        </div>
      </div>

      <div className="va-card" style={{ opacity: 0.85 }}>
        <h4>📤 Instagram / Facebook auto-post (Phase 2 — band hai)</h4>
        <p style={{ fontSize: 13, color: 'var(--gray)', margin: 0 }}>
          {meta?.note || 'Phase 2 feature.'} Iske liye Instagram Business account + Facebook Page + access token chahiye.
          Tokens sirf server ke <code>.env</code> me rakhe jaate hain (kabhi website ya app me nahi).
          {meta && meta.missing.length > 0 && <> Missing env: <code>{meta.missing.join(', ')}</code>.</>}
        </p>
      </div>
    </>
  );
}
