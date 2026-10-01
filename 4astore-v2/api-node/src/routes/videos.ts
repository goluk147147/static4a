import { Router, Request, Response } from 'express';
import fs from 'fs';
import { z } from 'zod';
import { prisma } from '../db';
import { ok, fail } from '../utils/http';
import { requireAuth, requireStaff } from '../auth/middleware';
import {
  videoRequestSchema, colorsSchema, settingsSchema, getVideoSettings, saveVideoSettings, toFestival, FestivalRow,
} from '../video/options';
import { enqueue, renderPreviewFrames, deleteJob, toJob, JobRow, mediaFile, cleanup } from '../video/queue';
import { runDailyAuto, upcomingFestivals, istNow } from '../services/videoScheduler';
import { metaStatus } from '../services/metaPublisher';
import { ffmpegPath } from '../video/render';
import { ensureFonts } from '../video/fonts';

// Admin → Ads & Social → Video Ads. Every route: logged-in staff with the "ads" permission.
const router = Router();
router.use(requireAuth, requireStaff('ads'));

// Express 4 does not catch rejected promises from async handlers (an unhandled rejection
// would crash the API). Wrap every handler registered on this router so errors go to next().
type Handler = (req: Request, res: Response, next: (e?: unknown) => void) => unknown;
for (const m of ['get', 'post', 'patch', 'delete'] as const) {
  const orig = router[m].bind(router) as (path: string, ...h: Handler[]) => unknown;
  (router as unknown as Record<string, unknown>)[m] = (path: string, ...handlers: Handler[]) =>
    orig(path, ...handlers.map((h) => (req: Request, res: Response, next: (e?: unknown) => void) => Promise.resolve(h(req, res, next)).catch(next)));
}

const who = (req: Request) => req.user?.username || String(req.user?.sub || 'admin');
const idParam = (req: Request) => {
  const n = Number(req.params.id);
  return Number.isInteger(n) && n > 0 ? n : 0;
};
const firstIssue = (e: z.ZodError) => {
  const i = e.issues[0];
  return i ? `${i.path.join('.') || 'input'}: ${i.message}` : 'Invalid input';
};

// ---------------- health (fonts + ffmpeg) ----------------
router.get('/health', (_req: Request, res: Response) => {
  const problems: string[] = [];
  try { ensureFonts(); } catch (e) { problems.push((e as Error).message); }
  try { ffmpegPath(); } catch (e) { problems.push((e as Error).message); }
  return ok(res, { ready: problems.length === 0, problems, meta: metaStatus() });
});

// ---------------- library / jobs ----------------
router.get('/', async (_req: Request, res: Response) => {
  const rows = await prisma.$queryRawUnsafe<JobRow[]>('SELECT * FROM video_jobs ORDER BY id DESC LIMIT 200');
  return ok(res, { videos: rows.map(toJob) });
});

router.get('/:id(\\d+)', async (req: Request, res: Response) => {
  const row = (await prisma.$queryRawUnsafe<JobRow[]>('SELECT * FROM video_jobs WHERE id = ?', idParam(req)))[0];
  if (!row) return fail(res, 'Video not found', 404);
  return ok(res, { video: toJob(row) });
});

router.post('/generate', async (req: Request, res: Response) => {
  const parsed = videoRequestSchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, firstIssue(parsed.error), 422);
  if (parsed.data.template === 'festival' && !parsed.data.festivalId && !parsed.data.festivalName) {
    return fail(res, 'Festival chuniye ya festival ka naam likhiye', 422);
  }
  const queued = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>("SELECT COUNT(*) AS n FROM video_jobs WHERE status IN ('queued','rendering')");
  if (Number(queued[0]?.n || 0) >= 10) return fail(res, 'Queue is full (10 videos). Wait for the current renders to finish.', 429);
  const jobs = await enqueue(parsed.data, 'manual', who(req));
  return ok(res, { message: `${jobs.length} video${jobs.length > 1 ? 's' : ''} queued`, videos: jobs });
});

router.post('/preview', async (req: Request, res: Response) => {
  const parsed = videoRequestSchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, firstIssue(parsed.error), 422);
  const format = parsed.data.format === 'square' ? 'square' : 'reel';
  try {
    const r = await renderPreviewFrames(parsed.data, format);
    return ok(res, { format, frames: r.frames.map((f) => ({ t: f.t, src: `data:image/png;base64,${f.png}` })), caption: r.caption, title: r.title });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return fail(res, `Preview failed: ${(e as Error).message}`, status);
  }
});

router.patch('/:id(\\d+)/caption', async (req: Request, res: Response) => {
  const caption = z.string().max(2200).safeParse(req.body?.caption);
  if (!caption.success) return fail(res, 'Caption must be under 2200 characters', 422);
  const n = await prisma.$executeRawUnsafe('UPDATE video_jobs SET caption = ? WHERE id = ?', caption.data, idParam(req));
  if (!n) return fail(res, 'Video not found', 404);
  return ok(res, { message: 'Caption saved' });
});

router.delete('/:id(\\d+)', async (req: Request, res: Response) => {
  const r = await deleteJob(idParam(req));
  if (r === 'missing') return fail(res, 'Video not found', 404);
  if (r === 'busy') return fail(res, 'This video is rendering right now — wait for it to finish', 409);
  return ok(res, { message: 'Video deleted' });
});

// mp4 / jpg (Range requests are handled by sendFile → HTML5 <video> can seek)
router.get('/:id(\\d+)/:kind(file|thumb)', async (req: Request, res: Response) => {
  const row = (await prisma.$queryRawUnsafe<JobRow[]>('SELECT * FROM video_jobs WHERE id = ?', idParam(req)))[0];
  if (!row || row.status !== 'done' || !row.file_name) return fail(res, 'Video not ready', 404);
  const isThumb = req.params.kind === 'thumb';
  const file = mediaFile(row.file_name, isThumb ? 'jpg' : 'mp4');
  if (!fs.existsSync(file)) return fail(res, 'File missing on server', 404);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!isThumb && req.query.download === '1') {
    const safe = (row.title || 'video').replace(/[^\w -]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'video';
    res.setHeader('Content-Disposition', `attachment; filename="4astore-${safe}-${row.format}-${row.id}.mp4"`);
  }
  return res.type(isThumb ? 'image/jpeg' : 'video/mp4').sendFile(file);
});

// ---------------- today / upcoming ----------------
router.get('/today', async (_req: Request, res: Response) => {
  const s = await getVideoSettings();
  const upcoming = await upcomingFestivals(7);
  const unverified = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    'SELECT COUNT(*) AS n FROM festivals WHERE active = 1 AND (date IS NULL OR date_verified = 0)'
  );
  return ok(res, { today: istNow().ymd, upcoming, needsVerification: Number(unverified[0]?.n || 0), auto: s.auto });
});

// ---------------- festival calendar ----------------
const festTextSchema = z.object({
  name: z.string().trim().max(80).optional().default(''),
  greeting: z.string().trim().max(120).optional().default(''),
  subText: z.string().trim().max(200).optional().default(''),
  defaultOffer: z.string().trim().max(120).optional().default(''),
}).optional().default({});
const festivalSchema = z.object({
  id: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'id: a-z, 0-9, -').max(40),
  name: z.string().trim().min(1).max(80),
  date: z.union([z.literal(''), z.null(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional().transform((v) => v || null)
    // real calendar date only (2026-02-31 would silently become 0000-00-00 in non-strict MySQL)
    .refine((v) => {
      if (v === null) return true;
      const t = Date.parse(v + 'T00:00:00Z');
      return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v && v >= '2000-01-01' && v <= '2100-12-31';
    }, 'invalid date'),
  dateVerified: z.boolean().optional().default(false),
  greeting: z.string().trim().max(120).optional().default(''),
  subText: z.string().trim().max(200).optional().default(''),
  emojis: z.array(z.string().trim().min(1).max(16)).max(6).optional().default([]),
  colors: colorsSchema,
  musicStyle: z.enum(['festive', 'calm', 'upbeat']).optional().default('festive'),
  defaultOffer: z.string().trim().max(120).optional().default(''),
  active: z.boolean().optional().default(true),
  translations: z.object({ hindi: festTextSchema, english: festTextSchema }).optional(),
});

router.get('/festivals', async (_req: Request, res: Response) => {
  const rows = await prisma.$queryRawUnsafe<FestivalRow[]>('SELECT * FROM festivals ORDER BY (date IS NULL), date ASC, name ASC');
  return ok(res, { festivals: rows.map(toFestival) });
});

router.post('/festivals', async (req: Request, res: Response) => {
  const action = String(req.body?.action || '');
  if (action === 'delete') {
    const id = String(req.body?.id || '');
    const n = await prisma.$executeRawUnsafe('DELETE FROM festivals WHERE id = ?', id);
    if (!n) return fail(res, 'Festival not found', 404);
    return ok(res, { message: 'Festival deleted' });
  }
  if (action !== 'add' && action !== 'update') return fail(res, 'Invalid action', 400);
  const parsed = festivalSchema.safeParse(req.body?.festival);
  if (!parsed.success) return fail(res, firstIssue(parsed.error), 422);
  const f = parsed.data;
  const exists = (await prisma.$queryRawUnsafe<Array<{ id: string }>>('SELECT id FROM festivals WHERE id = ?', f.id))[0];
  if (action === 'add' && exists) return fail(res, `Festival id "${f.id}" already exists`, 409);
  if (action === 'update' && !exists) return fail(res, 'Festival not found', 404);
  const tr = JSON.stringify({ hindi: f.translations?.hindi || {}, english: f.translations?.english || {} });
  const values = [f.name, f.date, f.date ? (f.dateVerified ? 1 : 0) : 0, f.greeting, f.subText, JSON.stringify(f.emojis), JSON.stringify(f.colors), f.musicStyle, f.defaultOffer, f.active ? 1 : 0, tr];
  if (action === 'add') {
    await prisma.$executeRawUnsafe(
      'INSERT INTO festivals (name, date, date_verified, greeting, sub_text, emojis, colors, music_style, default_offer, active, translations, id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ...values, f.id
    );
  } else {
    await prisma.$executeRawUnsafe(
      'UPDATE festivals SET name=?, date=?, date_verified=?, greeting=?, sub_text=?, emojis=?, colors=?, music_style=?, default_offer=?, active=?, translations=? WHERE id=?',
      ...values, f.id
    );
  }
  const row = (await prisma.$queryRawUnsafe<FestivalRow[]>('SELECT * FROM festivals WHERE id = ?', f.id))[0];
  return ok(res, { message: action === 'add' ? 'Festival added' : 'Festival updated', festival: toFestival(row) });
});

// ---------------- settings + auto run ----------------
router.get('/settings', async (_req: Request, res: Response) => ok(res, { settings: await getVideoSettings(), meta: metaStatus() }));

router.post('/settings', async (req: Request, res: Response) => {
  const parsed = settingsSchema.safeParse(req.body?.settings);
  if (!parsed.success) return fail(res, firstIssue(parsed.error), 422);
  await saveVideoSettings(parsed.data);
  const removed = await cleanup(parsed.data.auto.keepLast);
  return ok(res, { message: 'Video settings saved', settings: parsed.data, removed });
});

// "Run now" test button: same logic as the 6 AM job, ignoring enabled/once-per-day.
router.post('/auto/run-now', async (req: Request, res: Response) => {
  const r = await runDailyAuto({ force: true, by: who(req) });
  return ok(res, { message: r.kind === 'festival' ? `Festival video queued: ${r.festival}` : 'Daily deal video queued', ...r });
});

export default router;
