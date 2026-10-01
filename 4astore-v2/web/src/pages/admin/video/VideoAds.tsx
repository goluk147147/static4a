import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchHealth, fetchVideos, fetchVideoSettings } from '../../../lib/videos';
import VideoCreate from './VideoCreate';
import VideoLibrary, { VIDEOS_KEY } from './VideoLibrary';
import VideoCalendar from './VideoCalendar';
import VideoSettingsPanel from './VideoSettingsPanel';
import './video.css';

type Sub = 'create' | 'library' | 'calendar' | 'settings';

/** Admin → Ads & Social → 🎬 Video Ads: festival / daily / brand promo videos (Reels + Square). */
export default function VideoAds() {
  const [sub, setSub] = useState<Sub>('create');
  const health = useQuery({ queryKey: ['video-health'], queryFn: fetchHealth, staleTime: 5 * 60_000 });
  const settingsQ = useQuery({ queryKey: ['video-settings'], queryFn: fetchVideoSettings });
  // Poll fast while something is rendering so the progress bar moves; slow otherwise.
  const videosQ = useQuery({
    queryKey: VIDEOS_KEY,
    queryFn: fetchVideos,
    refetchInterval: (q) => ((q.state.data ?? []).some((v) => v.status === 'queued' || v.status === 'rendering') ? 2000 : 20000),
  });
  const videos = videosQ.data ?? [];
  const active = videos.filter((v) => v.status === 'queued' || v.status === 'rendering').length;

  const tabs: [Sub, string][] = [
    ['create', '🎬 Create'],
    ['library', `📚 Library (${videos.filter((v) => v.status === 'done').length})${active ? ` · ⏳ ${active}` : ''}`],
    ['calendar', '📅 Festival Calendar'],
    ['settings', '⚙️ Video Settings'],
  ];

  return (
    <>
      {health.data && !health.data.ready && (
        <div className="va-error">⚠️ Video generator ready nahi hai: {health.data.problems.join(' · ')}</div>
      )}
      <div className="va-subnav" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={sub === k} className={`va-pill${sub === k ? ' active' : ''}`} onClick={() => setSub(k)}>{label}</button>
        ))}
      </div>
      {sub === 'create' && <VideoCreate settings={settingsQ.data?.settings} onQueued={() => setSub('library')} />}
      {sub === 'library' && <VideoLibrary videos={videos} loading={videosQ.isLoading} />}
      {sub === 'calendar' && <VideoCalendar />}
      {sub === 'settings' && (settingsQ.data
        ? <VideoSettingsPanel settings={settingsQ.data.settings} meta={settingsQ.data.meta} onRan={() => setSub('library')} />
        : <p style={{ color: 'var(--gray)' }}>Loading settings...</p>)}
    </>
  );
}
