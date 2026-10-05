import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import VideoAds from './video/VideoAds';
import { useProducts, useSettings } from '../../lib/queries';
import { productImageSrc } from '../../lib/productImage';
import { showToast } from '../../store/toast';
import { showConfirm } from '../../store/confirm';
import type { Product, Settings } from '../../types';

/**
 * Ads & Social Media tab. The original poster editor (canvas, templates, drag/zoom,
 * undo/redo, captions, export/share, library) is ~1,600 lines of vanilla JS; it runs
 * verbatim from /legacy/js/admin-ads.js so it looks and behaves exactly like before.
 * This component only supplies the globals that script expects and a #tabContent host.
 */

type LegacyWindow = Window & {
  escapeHtml?: (s: unknown) => string;
  showToast?: (msg: string, type?: string) => void;
  adminConfirm?: (msg: string, opts?: { title?: string; confirmText?: string }) => Promise<boolean>;
  getSettings?: () => Partial<Settings>;
  getProducts?: () => unknown[];
  products?: unknown[];
  renderAdsTab?: () => void;
};

let scriptPromise: Promise<void> | null = null;
function loadAdsScript(): Promise<void> {
  // Classic script with top-level let/const → it must be evaluated only once per page.
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = '/legacy/js/admin-ads.js';
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => {
        scriptPromise = null;
        el.remove();
        reject(new Error('Ads editor script failed to load'));
      };
      document.body.appendChild(el);
    });
  }
  return scriptPromise;
}

const escapeHtml = (str: unknown) =>
  String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Original product shape (camelCase inStock, image usable by the canvas). */
const toLegacyProduct = (p: Product) => ({
  ...p,
  inStock: p.in_stock !== false,
  // Remote images already go through /api/img-proxy (same origin → canvas stays exportable).
  image: p.image ? productImageSrc(p) : '',
});

export default function AdminAds() {
  // ?view=video (e.g. from the "video ready" push notification) opens the Video module.
  const [params, setParams] = useSearchParams();
  const view: 'poster' | 'video' = params.get('view') === 'video' ? 'video' : 'poster';
  const setView = (v: 'poster' | 'video') => setParams(v === 'video' ? { view: 'video' } : {}, { replace: true });
  const { data: products, isLoading: loadingProducts } = useProducts();
  const settings = useSettings().data;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState('');
  const [started, setStarted] = useState(false);

  // Keep the globals current (the editor reads them on every render/draw).
  useEffect(() => {
    const w = window as LegacyWindow;
    const list = (products || []).map(toLegacyProduct);
    w.escapeHtml = escapeHtml;
    w.showToast = (msg, type) => showToast(String(msg), (type as 'success' | 'error' | 'info') || 'info');
    w.adminConfirm = (msg, opts = {}) => showConfirm(String(msg), { title: opts.title, confirmText: opts.confirmText, danger: /delete/i.test(opts.confirmText || '') });
    w.getSettings = () => settings || {};
    w.getProducts = () => list;
    w.products = list;
  }, [products, settings]);

  // Load the editor once products are available, then render the dashboard.
  useEffect(() => {
    if (loadingProducts || started) return;
    let cancelled = false;
    loadAdsScript()
      .then(() => {
        if (cancelled || !hostRef.current) return;
        setStarted(true);
        (window as LegacyWindow).renderAdsTab?.();
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [loadingProducts, started]);

  // The editor uses synchronous XHR (no token refresh). Ping the API every 4 min so
  // the axios interceptor refreshes the 15-min access cookie while the editor is open.
  useEffect(() => {
    const t = window.setInterval(() => api.get('/users/session').catch(() => null), 4 * 60 * 1000);
    return () => window.clearInterval(t);
  }, []);

  const pill = (on: boolean): React.CSSProperties => ({
    padding: '10px 18px', borderRadius: 24, cursor: 'pointer', fontSize: 14, fontWeight: 700,
    border: `2px solid ${on ? 'var(--primary)' : 'var(--border)'}`, background: on ? 'var(--primary)' : '#fff', color: on ? '#fff' : 'var(--primary-dark)',
  });

  // Poster (legacy editor) and Video modules. The poster host stays mounted (just hidden)
  // so the legacy editor keeps its state when switching.
  return (
    <>
      <div style={{ display: 'flex', gap: 10, marginBottom: 18, paddingBottom: 14, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }} role="tablist" aria-label="Ads type">
        <button type="button" role="tab" aria-selected={view === 'poster'} style={pill(view === 'poster')} onClick={() => setView('poster')}>🖼️ Poster Ads</button>
        <button type="button" role="tab" aria-selected={view === 'video'} style={pill(view === 'video')} onClick={() => setView('video')}>🎬 Video Ads</button>
      </div>
      {view === 'video' && <VideoAds />}
      <div style={{ display: view === 'poster' ? 'block' : 'none' }}>
        {error ? (
          <p style={{ color: '#c62828', textAlign: 'center', padding: 30 }}>{error}. Page refresh karke dobara try karein.</p>
        ) : (
          <>
            {!started && <p style={{ textAlign: 'center', padding: 30, color: 'var(--gray)' }}>Loading Ads & Social...</p>}
            {/* #tabContent has no React children: the legacy script owns its innerHTML. */}
            <div id="tabContent" ref={hostRef} />
          </>
        )}
      </div>
    </>
  );
}
