import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { legacyToRoute } from '../lib/links';
import { useAuth } from '../store/auth';

interface Announcement {
  id: number; text: string; image: string; target: string; ctaText: string; ctaLink: string; enabled: boolean;
}

const SPOKEN_KEY = '4astore_ann_spoken';

type AppBridge = Window & { AndroidApp?: { speak?: (msg: string) => void } };

// Original speakText(): native TTS inside the app, Web Speech (hi-IN) in browsers.
function speakText(msg: string) {
  const w = window as AppBridge;
  if (w.AndroidApp && typeof w.AndroidApp.speak === 'function') {
    try { w.AndroidApp.speak(msg); return; } catch { /* fall through */ }
  }
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const speak = () => {
      const u = new SpeechSynthesisUtterance(msg);
      u.lang = 'hi-IN'; u.rate = 0.9; u.pitch = 1; u.volume = 1;
      const hi = window.speechSynthesis.getVoices().find((v) => v.lang === 'hi-IN' || (v.lang || '').toLowerCase().startsWith('hi'));
      if (hi) u.voice = hi;
      window.speechSynthesis.speak(u);
    };
    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = () => { speak(); window.speechSynthesis.onvoiceschanged = null; };
      setTimeout(speak, 400);
    } else setTimeout(speak, 300);
  } catch { /* ignore */ }
}

/** `*20% OFF*` → highlighted chip; everything else is plain text (no HTML injection). */
function Highlighted({ text }: { text: string }) {
  const parts = text.split(/\*([^*]+)\*/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? <span key={i} style={{ background: '#fff3cd', color: '#e65100', fontWeight: 800, padding: '1px 6px', borderRadius: 5 }}>{p}</span> : p
      )}
    </>
  );
}

// Port of index.html playAnnouncement() + showAnnouncementPopup(): shows once per message id.
export default function AnnouncementPopup() {
  const { user, ready } = useAuth();
  const [ann, setAnn] = useState<Announcement | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let cleanup = () => {};
    const t = setTimeout(async () => {
      try {
        const a = (await api.get('/announcement', { params: { t: Date.now() } })).data.announcement as Announcement;
        if (cancelled || !a || !a.enabled || (!a.text && !a.image)) return;
        const target = (a.target || 'all').trim();
        if (target !== 'all' && user?.mobile !== target) return;
        if (String(localStorage.getItem(SPOKEN_KEY)) === String(a.id)) return;
        setAnn(a);

        let done = false;
        const speakNow = () => {
          if (done) return;
          done = true;
          localStorage.setItem(SPOKEN_KEY, String(a.id));
          if (a.text) speakText(a.text);
          document.removeEventListener('click', speakNow);
          document.removeEventListener('touchstart', speakNow);
        };
        if ((window as AppBridge).AndroidApp?.speak) speakNow();
        else {
          document.addEventListener('click', speakNow, { once: true });
          document.addEventListener('touchstart', speakNow, { once: true });
          const s = setTimeout(speakNow, 600);
          cleanup = () => { clearTimeout(s); document.removeEventListener('click', speakNow); document.removeEventListener('touchstart', speakNow); };
        }
      } catch { /* announcement is optional */ }
    }, 500);
    return () => { cancelled = true; clearTimeout(t); cleanup(); };
  }, [ready, user?.mobile]);

  useEffect(() => {
    if (!ann) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setAnn(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ann]);

  if (!ann) return null;
  const close = () => setAnn(null);
  const link = ann.ctaText && ann.ctaLink ? legacyToRoute(ann.ctaLink, '/products') : '';
  const external = /^https?:/i.test(link);
  const ctaStyle: React.CSSProperties = { display: 'block', padding: 14, background: 'linear-gradient(135deg,#ff6a00,#f107a3)', color: '#fff', borderRadius: 12, fontSize: 16, fontWeight: 800, textDecoration: 'none', textAlign: 'center', boxShadow: '0 6px 16px rgba(241,7,163,.35)' };

  return createPortal(
    <div id="annPopup" onClick={(e) => e.target === e.currentTarget && close()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' }}>
      <style>{'@keyframes annPop{from{transform:scale(.85);opacity:0}to{transform:scale(1);opacity:1}}'}</style>
      <div role="dialog" aria-modal="true" aria-label="Special Offer"
        style={{ position: 'relative', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 18, width: '100%', maxWidth: 420, maxHeight: '90vh', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.4)', animation: 'annPop .28s ease' }}>
        <div style={{ position: 'relative', background: 'linear-gradient(135deg,#ff6a00,#f107a3)', color: '#fff', padding: '14px 44px', textAlign: 'center', fontWeight: 800, fontSize: 16, letterSpacing: '.3px', flexShrink: 0 }}>
          🎉 Special Offer
          <button type="button" onClick={close} aria-label="Close"
            style={{ position: 'absolute', top: '50%', right: 10, transform: 'translateY(-50%)', width: 32, height: 32, border: 'none', borderRadius: '50%', background: 'rgba(255,255,255,0.25)', color: '#fff', fontSize: 18, lineHeight: 1, cursor: 'pointer' }}>×</button>
        </div>
        {ann.image && (
          <div style={{ padding: '14px 14px 0' }}>
            <img src={/^https?:/i.test(ann.image) ? '/api/img-proxy?url=' + encodeURIComponent(ann.image) : ann.image} alt="offer"
              style={{ display: 'block', width: '100%', height: 'auto', maxHeight: '38vh', objectFit: 'contain', borderRadius: 10 }}
              onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }} />
          </div>
        )}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', textAlign: 'center' }}>
          {ann.text && <p style={{ fontSize: 15, color: '#333', lineHeight: 1.6, whiteSpace: 'pre-line', margin: 0 }}><Highlighted text={ann.text} /></p>}
        </div>
        {link && (
          <div style={{ padding: '14px 16px', borderTop: '1px solid #eee', flexShrink: 0 }}>
            {external
              ? <a href={link} rel="noopener noreferrer" style={ctaStyle}>{ann.ctaText} →</a>
              : <Link to={link} onClick={close} style={ctaStyle}>{ann.ctaText} →</Link>}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
