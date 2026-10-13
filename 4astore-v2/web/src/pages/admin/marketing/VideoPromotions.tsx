import { useRef, useState } from 'react';

/* ------------------------------------------------------------------ *
 * Video Promotions — HONEST "Coming soon" scaffold.
 * ------------------------------------------------------------------ *
 * Auto-generating promo videos needs PAID video rendering + TTS
 * voice-over, which this project does not have. We implement NOTHING
 * server-side: no rendering, no transcoding, no text-to-speech.
 *
 * As an optional convenience, an admin can pick an MP4 they already
 * made (e.g. in CapCut/Canva on their phone) to preview it and keep a
 * local copy — nothing is auto-generated and nothing is uploaded.
 * ------------------------------------------------------------------ */

export default function VideoPromotions() {
  const [localVideo, setLocalVideo] = useState<{ url: string; name: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (localVideo) URL.revokeObjectURL(localVideo.url);
    setLocalVideo({ url: URL.createObjectURL(file), name: file.name });
  }

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 640 }}>
      <div style={banner}>
        <div style={{ fontSize: 34 }}>🎬</div>
        <strong style={{ fontSize: 16, color: '#8d5d00' }}>Coming soon — needs paid video rendering / TTS voice-over</strong>
        <p style={{ margin: '8px 0 0', fontSize: 13, color: '#8d5d00', lineHeight: 1.5 }}>
          Auto promo-video banane ke liye <strong>paid video rendering + text-to-speech (TTS) voice-over</strong> service
          chahiye, jo abhi connected nahi hai. Isliye yahan <strong>kuch bhi auto-generate NAHI hota</strong> — na server
          par video banti hai, na koi voice-over. Jab tak paid service add nahi hoti, ye section sirf scaffold hai.
        </p>
      </div>

      <div style={card}>
        <strong style={cardTitle}>📂 Apna MP4 preview karein (optional, local-only)</strong>
        <p style={{ ...muted, margin: '6px 0 10px' }}>
          Agar aapne pehle se koi video bana li hai (CapCut / Canva / phone), yahan use preview karke manually
          WhatsApp par share kar sakte hain. <strong>Ye upload NAHI hoti aur auto-generate NAHI hoti</strong> — sirf aapke
          browser me khulti hai.
        </p>
        <input ref={inputRef} type="file" accept="video/mp4,video/*" onChange={onPick} style={{ fontSize: 13 }} />
        {localVideo && (
          <div style={{ marginTop: 12 }}>
            <video src={localVideo.url} controls style={{ width: '100%', borderRadius: 10, background: '#000' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <a href={localVideo.url} download={localVideo.name} style={{ ...btnGhost, textDecoration: 'none' }}>⬇️ Save a copy</a>
              <button type="button" onClick={() => { URL.revokeObjectURL(localVideo.url); setLocalVideo(null); if (inputRef.current) inputRef.current.value = ''; }} style={btnGhost}>✕ Clear</button>
            </div>
            <p style={{ ...muted, margin: '8px 0 0', fontSize: 11 }}>
              Share karne ke liye apne phone/WhatsApp me video manually bhejein. Yahan koi processing nahi hoti.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

const banner: React.CSSProperties = { background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 12, padding: 20, textAlign: 'center' };
const card: React.CSSProperties = { background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 16, boxShadow: 'var(--shadow)' };
const cardTitle: React.CSSProperties = { fontSize: 14, color: 'var(--primary-dark)', display: 'block' };
const muted: React.CSSProperties = { fontSize: 12, color: 'var(--gray)' };
const btnGhost: React.CSSProperties = { padding: '7px 12px', background: '#f1f5f9', color: 'var(--primary-dark)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
