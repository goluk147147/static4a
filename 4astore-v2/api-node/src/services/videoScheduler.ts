import cron from 'node-cron';
import { prisma } from '../db';
import { getVideoSettings, pickDailyProducts, toFestival, FestivalRow, videoRequestSchema, VideoRequest } from '../video/options';
import { enqueue, cleanup, onJobFinished, recoverQueue, Job } from '../video/queue';
import { sendToTopic, sendToTokens, tokensForStaff } from './push';

// Daily auto video (Admin → Video Ads → Settings). Checked every minute in IST:
// at the configured time, if a festival is today (or within `leadDays`) → festival video,
// otherwise a "daily" deal video. At most one automatic run per IST day.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
/** Current date/time in IST as plain parts (independent of the server's timezone). */
export function istNow(d = new Date()) {
  const t = new Date(d.getTime() + IST_OFFSET_MS);
  const ymd = t.toISOString().slice(0, 10);
  return { ymd, hhmm: t.toISOString().slice(11, 16) };
}
const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/** Festivals from today to today + days (IST), nearest first. */
export async function upcomingFestivals(days: number) {
  const { ymd } = istNow();
  const rows = await prisma.$queryRawUnsafe<FestivalRow[]>(
    'SELECT * FROM festivals WHERE active = 1 AND date IS NOT NULL AND date BETWEEN ? AND ? ORDER BY date ASC',
    ymd, addDays(ymd, days)
  );
  return rows.map(toFestival).map((f) => ({ ...f, daysAway: Math.round((Date.parse(f.date! + 'T00:00:00Z') - Date.parse(ymd + 'T00:00:00Z')) / 86400000) }));
}

async function alreadyRanToday(): Promise<boolean> {
  const { ymd } = istNow();
  // UNIX_TIMESTAMP() of a TIMESTAMP column is timezone-independent → compare against the IST day in epoch seconds.
  const start = (Date.parse(ymd + 'T00:00:00Z') - IST_OFFSET_MS) / 1000;
  const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint | number }>>(
    "SELECT COUNT(*) AS n FROM video_jobs WHERE source = 'auto' AND UNIX_TIMESTAMP(created_at) >= ? AND UNIX_TIMESTAMP(created_at) < ?",
    start, start + 86400
  );
  return Number(rows[0]?.n || 0) > 0;
}

/** Builds and enqueues today's automatic video. Used by the cron and the admin "Run now" button. */
export async function runDailyAuto(opts: { force?: boolean; by?: string } = {}): Promise<{ skipped?: string; kind?: 'festival' | 'daily'; festival?: string; jobs: Job[] }> {
  const s = await getVideoSettings();
  if (!opts.force && !s.auto.enabled) return { skipped: 'Auto-generate is disabled', jobs: [] };
  if (!opts.force && (await alreadyRanToday())) return { skipped: 'Already generated today', jobs: [] };

  const fest = (await upcomingFestivals(s.auto.leadDays))[0];
  const productIds = (await pickDailyProducts(4)).map((p) => p.id);
  const format = s.auto.formats.length > 1 ? 'both' : s.auto.formats[0];
  const req: VideoRequest = fest
    ? videoRequestSchema.parse({
        template: 'festival', festivalId: fest.id, productIds, format, durationSec: s.auto.durationSec,
        ...(fest.colors ? { colors: fest.colors } : {}), emojis: fest.emojis,
        musicStyle: fest.musicStyle, title: `${fest.name} ${fest.daysAway ? `(in ${fest.daysAway} day${fest.daysAway > 1 ? 's' : ''})` : ''}`.trim(),
      })
    : videoRequestSchema.parse({ template: 'daily', productIds, format, durationSec: s.auto.durationSec, musicStyle: 'upbeat', title: `Aaj ka Special — ${istNow().ymd}` });

  const jobs = await enqueue(req, 'auto', opts.by || 'scheduler');
  return { kind: fest ? 'festival' : 'daily', festival: fest?.name, jobs };
}

async function notifyReady(job: Job) {
  const s = await getVideoSettings();
  if (job.source !== 'auto' || !s.auto.notify) return;
  const ok = job.status === 'done';
  const msg = {
    title: ok ? '🎬 Promo video ready' : '⚠️ Auto video failed',
    body: ok ? `${job.title} (${job.format}) — Admin → Ads & Social → Video Ads me dekhein` : job.error || 'Render failed',
    data: { type: 'video_ready', jobId: String(job.id), link: '/admin/ads?view=video' },
  };
  await sendToTopic('admins', msg).catch(() => false);
  await sendToTokens(await tokensForStaff('ads'), msg).catch(() => 0);
}

export function startVideoScheduler(): void {
  void recoverQueue().catch((e) => console.error('[video] queue recovery failed:', (e as Error).message));

  onJobFinished((job) => {
    void notifyReady(job).catch(() => null);
    void getVideoSettings().then((s) => cleanup(s.auto.keepLast)).catch(() => null);
  });

  cron.schedule('* * * * *', async () => {
    try {
      const s = await getVideoSettings();
      if (!s.auto.enabled) return;
      if (istNow().hhmm < s.auto.time) return; // runs at/after the configured IST time, once per day
      const r = await runDailyAuto();
      if (!r.skipped) console.log(`[video] auto ${r.kind} video queued (${r.jobs.map((j) => j.id).join(', ')})`);
    } catch (e) {
      console.error('[video] scheduler error:', (e as Error).message);
    }
  });
  console.log('[video] scheduler started (checks every minute, IST).');
}
