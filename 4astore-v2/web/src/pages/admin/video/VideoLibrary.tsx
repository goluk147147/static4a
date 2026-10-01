import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiError } from '../../../lib/api';
import { VideoJob, deleteVideo, saveCaption, videoFileUrl, videoThumbUrl, fmtSize, copyText } from '../../../lib/videos';
import { showToast } from '../../../store/toast';
import { showConfirm } from '../../../store/confirm';
import AdminModal from '../AdminModal';

export const VIDEOS_KEY = ['admin-videos'];
const STATUS: Record<VideoJob['status'], [string, string]> = {
  queued: ['⏳ Queued', '#8b5cf6'],
  rendering: ['🎬 Rendering', '#0891b2'],
  done: ['✅ Ready', '#059669'],
  failed: ['⚠️ Failed', '#dc2626'],
};
const fmtDate = (d: string) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function CaptionModal({ video, onClose }: { video: VideoJob; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState(video.caption);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await saveCaption(video.id, text);
      showToast('Caption saved', 'success');
      qc.invalidateQueries({ queryKey: VIDEOS_KEY });
      onClose();
    } catch (e) {
      showToast(apiError(e) || 'Failed to save caption', 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <AdminModal onClose={onClose} maxWidth={620}>
      <h3 style={{ color: 'var(--primary)', marginBottom: 10 }}>✏️ Caption — {video.title}</h3>
      <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2200} rows={14} aria-label="Caption"
        style={{ width: '100%', boxSizing: 'border-box', padding: 10, border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'inherit', fontSize: 13 }} />
      <p style={{ fontSize: 11, color: 'var(--gray)', textAlign: 'right' }}>{text.length}/2200</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" className="va-btn" onClick={save} disabled={busy}>💾 {busy ? 'Saving…' : 'Save caption'}</button>
        <button type="button" className="va-btn secondary" onClick={async () => showToast((await copyText(text)) ? 'Caption copied' : 'Copy failed', 'success')}>📋 Copy</button>
        <button type="button" className="va-btn ghost" onClick={onClose}>Close</button>
      </div>
    </AdminModal>
  );
}

function PlayerModal({ video, onClose }: { video: VideoJob; onClose: () => void }) {
  const square = video.format === 'square';
  return (
    <AdminModal onClose={onClose} maxWidth={square ? 620 : 460}>
      <h3 style={{ color: 'var(--primary)', marginBottom: 10 }}>▶️ {video.title} <span style={{ fontSize: 12, color: 'var(--gray)' }}>({video.format === 'reel' ? 'Reel 1080×1920' : 'Square 1080×1080'})</span></h3>
      <video src={videoFileUrl(video.id)} controls autoPlay playsInline style={{ width: '100%', maxHeight: '72vh', borderRadius: 10, background: '#000' }} />
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <a className="va-btn green" href={videoFileUrl(video.id, true)} style={{ textDecoration: 'none' }}>⬇️ Download</a>
        <button type="button" className="va-btn ghost" onClick={onClose}>Close</button>
      </div>
    </AdminModal>
  );
}

/** Video library: thumbnail, title, date, format, size + Play / Download / Copy Caption / Delete. */
export default function VideoLibrary({ videos, loading }: { videos: VideoJob[]; loading: boolean }) {
  const qc = useQueryClient();
  const [play, setPlay] = useState<VideoJob | null>(null);
  const [edit, setEdit] = useState<VideoJob | null>(null);
  const [filter, setFilter] = useState<'all' | 'festival' | 'daily' | 'general'>('all');

  async function remove(v: VideoJob) {
    const ok = await showConfirm(`Delete video "${v.title}" (${v.format})? File bhi delete ho jayegi.`, { title: 'Delete video', confirmText: 'Delete', danger: true });
    if (!ok) return;
    try {
      await deleteVideo(v.id);
      showToast('Video deleted', 'success');
      qc.invalidateQueries({ queryKey: VIDEOS_KEY });
    } catch (e) {
      showToast(apiError(e) || 'Delete failed', 'error');
    }
  }

  if (loading) return <p style={{ color: 'var(--gray)', textAlign: 'center', padding: 30 }}>Loading videos...</p>;
  const list = videos.filter((v) => filter === 'all' || v.template === filter);

  return (
    <>
      <div className="va-subnav">
        {(['all', 'festival', 'daily', 'general'] as const).map((f) => (
          <button key={f} type="button" className={`va-pill${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)} style={{ textTransform: 'capitalize' }}>
            {f} ({f === 'all' ? videos.length : videos.filter((v) => v.template === f).length})
          </button>
        ))}
      </div>
      {!list.length && <p style={{ color: 'var(--gray)', textAlign: 'center', padding: 30 }}>Abhi koi video nahi. "🎬 Create" se banao.</p>}
      <div className="va-lib">
        {list.map((v) => {
          const [label, color] = STATUS[v.status];
          return (
            <div key={v.id} className="va-item">
              {v.hasFile ? (
                <button type="button" className="va-thumb" onClick={() => setPlay(v)} aria-label={`Play ${v.title}`}>
                  <img src={videoThumbUrl(v.id, v.finishedAt || '')} alt="" loading="lazy" />
                  <span className="va-play">▶</span>
                </button>
              ) : (
                <div className="va-thumb" style={{ cursor: 'default', color: '#fff', fontSize: 40 }}>{v.status === 'failed' ? '⚠️' : '🎬'}</div>
              )}
              <div className="va-item-body">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                  <strong style={{ fontSize: 14 }}>{v.title}</strong>
                  <span className="va-badge" style={{ background: color }}>{label}</span>
                </div>
                <div className="va-meta">
                  {fmtDate(v.createdAt)} · {v.format === 'reel' ? '📱 Reel' : '⬛ Square'} · {v.durationSec}s · {fmtSize(v.sizeBytes)}{v.source === 'auto' ? ' · 🤖 auto' : ''}
                </div>
                {(v.status === 'queued' || v.status === 'rendering') && (
                  <>
                    <div className="va-progress" role="progressbar" aria-valuenow={v.progress} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${v.progress}%` }} /></div>
                    <div className="va-meta">{v.status === 'queued' ? 'Line me hai…' : `${v.progress}% rendered`}</div>
                  </>
                )}
                {v.status === 'failed' && <div style={{ fontSize: 12, color: '#b71c1c' }}>{v.error}</div>}
                <div className="va-actions" style={{ marginTop: 'auto' }}>
                  {v.hasFile && <button type="button" className="va-mini" onClick={() => setPlay(v)}>▶️ Play</button>}
                  {v.hasFile && <a className="va-mini" href={videoFileUrl(v.id, true)}>⬇️ Download</a>}
                  <button type="button" className="va-mini" onClick={async () => showToast((await copyText(v.caption)) ? 'Caption copied — Instagram/Facebook me paste karein' : 'Copy failed', 'success')}>📋 Copy Caption</button>
                  <button type="button" className="va-mini" onClick={() => setEdit(v)}>✏️ Caption</button>
                  {v.status !== 'rendering' && <button type="button" className="va-mini" style={{ background: '#fee2e2', color: '#b91c1c' }} onClick={() => remove(v)} aria-label={`Delete ${v.title}`}>🗑️</button>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {play && <PlayerModal video={play} onClose={() => setPlay(null)} />}
      {edit && <CaptionModal video={edit} onClose={() => setEdit(null)} />}
    </>
  );
}
