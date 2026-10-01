// Render queue: jobs live in MySQL (video_jobs); one render at a time, each in its own
// child process (worker.ts). Progress is written to the row so the admin UI can poll.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fork, ChildProcess } from 'child_process';
import { prisma } from '../db';
import { buildOptions, getVideoSettings, VideoRequest } from './options';
import { generateCaption } from './captions';
import type { RenderOptions, VideoFormat } from './types';
import type { WorkerMessage, WorkerTask } from './worker';

export const MEDIA_DIR = process.env.VIDEO_MEDIA_DIR || path.join(process.cwd(), 'media', 'videos');
const RENDER_TIMEOUT_MS = 20 * 60 * 1000;
const PREVIEW_TIMEOUT_MS = 90 * 1000;

export interface JobRow {
  id: number; status: string; progress: number; source: string; title: string; template: string; format: string; lang?: string;
  duration_sec: number; options: unknown; file_name: string | null; size_bytes: number | null; caption: string | null;
  error: string | null; created_by: string | null; created_at: Date; started_at: Date | null; finished_at: Date | null;
}

export const toJob = (r: JobRow) => {
  const o = (typeof r.options === 'string' ? JSON.parse(r.options) : r.options) as RenderOptions;
  return {
    id: Number(r.id),
    status: r.status as 'queued' | 'rendering' | 'done' | 'failed',
    progress: Number(r.progress) || 0,
    source: r.source,
    title: r.title,
    template: r.template,
    format: r.format as VideoFormat,
    lang: (r.lang || o?.lang || 'hinglish') as RenderOptions['lang'],
    durationSec: Number(r.duration_sec),
    festivalName: o?.festivalName || '',
    offerText: o?.offerText || '',
    couponCode: o?.couponCode || '',
    musicStyle: o?.musicStyle || '',
    sizeBytes: r.size_bytes == null ? null : Number(r.size_bytes),
    caption: r.caption || '',
    error: r.error || '',
    createdBy: r.created_by || '',
    createdAt: new Date(r.created_at).toISOString(),
    finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    hasFile: r.status === 'done' && !!r.file_name,
  };
};
export type Job = ReturnType<typeof toJob>;

/** Worker entry: .ts under ts-node (dev) or compiled .js (production). */
function forkWorker(): ChildProcess {
  const ts = __filename.endsWith('.ts');
  const entry = path.join(__dirname, ts ? 'worker.ts' : 'worker.js');
  return fork(entry, [], {
    execArgv: ts ? ['-r', 'ts-node/register/transpile-only'] : [],
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    env: { ...process.env, TS_NODE_TRANSPILE_ONLY: 'true' },
  });
}

function runTask(task: WorkerTask, onMessage: (m: WorkerMessage) => void, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = forkWorker();
    let finished = false;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      if (!finished) { finished = true; reject(new Error('Render timed out')); }
    }, timeoutMs);
    child.on('message', (m: WorkerMessage) => {
      if (m.type === 'error') {
        finished = true;
        clearTimeout(timer);
        return reject(new Error(m.message));
      }
      onMessage(m);
      if (m.type === 'done' || m.type === 'preview') {
        finished = true;
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('error', (e) => { if (!finished) { finished = true; clearTimeout(timer); reject(e); } });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (!finished) { finished = true; reject(new Error(`Render process exited (code ${code})`)); }
    });
    child.send(task);
  });
}

// ---------------- preview ----------------
let previewBusy = 0;
export async function renderPreviewFrames(req: VideoRequest, format: VideoFormat) {
  if (previewBusy >= 2) throw Object.assign(new Error('Preview busy, try again in a few seconds'), { status: 429 });
  previewBusy++;
  try {
    const options = await buildOptions(req, format);
    let frames: { t: number; png: string }[] = [];
    await runTask({ kind: 'preview', options }, (m) => { if (m.type === 'preview') frames = m.frames; }, PREVIEW_TIMEOUT_MS);
    return { frames, caption: generateCaption(options), title: options.title, products: options.featuredProducts.length };
  } finally {
    previewBusy--;
  }
}

// ---------------- queue ----------------
export async function enqueue(req: VideoRequest, source: 'manual' | 'auto', createdBy: string): Promise<Job[]> {
  const settings = await getVideoSettings();
  const formats: VideoFormat[] = req.format === 'both' ? ['reel', 'square'] : [req.format];
  const jobs: Job[] = [];
  for (const format of formats) {
    const options = await buildOptions(req, format, settings);
    const caption = generateCaption(options);
    const row = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO video_jobs (status, progress, source, title, template, format, lang, duration_sec, options, caption, created_by)
         VALUES ('queued', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        source, options.title.slice(0, 160), options.template, format, options.lang, options.durationSec, JSON.stringify(options), caption, createdBy.slice(0, 64)
      );
      return (await tx.$queryRawUnsafe<JobRow[]>('SELECT * FROM video_jobs WHERE id = LAST_INSERT_ID()'))[0];
    });
    jobs.push(toJob(row));
  }
  void kick();
  return jobs;
}

let running = false;
type DoneHook = (job: Job) => void;
const doneHooks: DoneHook[] = [];
export const onJobFinished = (fn: DoneHook) => doneHooks.push(fn);

/** Starts the next queued job if nothing is rendering. */
export async function kick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const next = (await prisma.$queryRawUnsafe<JobRow[]>("SELECT * FROM video_jobs WHERE status = 'queued' ORDER BY id ASC LIMIT 1"))[0];
      if (!next) break;
      await processJob(next);
    }
  } finally {
    running = false;
  }
}

async function processJob(row: JobRow) {
  const id = Number(row.id);
  const baseName = `v${id}_${crypto.randomBytes(6).toString('hex')}`;
  await prisma.$executeRawUnsafe("UPDATE video_jobs SET status = 'rendering', progress = 0, started_at = NOW(), error = NULL WHERE id = ?", id);
  const options = (typeof row.options === 'string' ? JSON.parse(row.options) : row.options) as RenderOptions;
  let lastSaved = 0;
  try {
    let size = 0;
    await runTask({ kind: 'render', options, outDir: MEDIA_DIR, baseName }, (m) => {
      if (m.type === 'progress' && (m.pct - lastSaved >= 3 || m.pct === 100)) {
        lastSaved = m.pct;
        prisma.$executeRawUnsafe('UPDATE video_jobs SET progress = ? WHERE id = ?', m.pct, id).catch(() => null);
      }
      if (m.type === 'done') size = m.result.sizeBytes;
    }, RENDER_TIMEOUT_MS);
    await prisma.$executeRawUnsafe(
      "UPDATE video_jobs SET status = 'done', progress = 100, file_name = ?, size_bytes = ?, finished_at = NOW() WHERE id = ?",
      baseName, size, id
    );
  } catch (e) {
    const msg = friendlyError((e as Error).message);
    await prisma.$executeRawUnsafe("UPDATE video_jobs SET status = 'failed', error = ?, finished_at = NOW() WHERE id = ?", msg.slice(0, 500), id);
    await removeFiles(baseName);
  }
  const done = (await prisma.$queryRawUnsafe<JobRow[]>('SELECT * FROM video_jobs WHERE id = ?', id))[0];
  if (done) doneHooks.forEach((fn) => { try { fn(toJob(done)); } catch { /* ignore */ } });
}

function friendlyError(msg: string): string {
  if (/fonts? missing|Font could not/i.test(msg)) return `Fonts missing: ${msg}`;
  if (/ffmpeg not found/i.test(msg)) return msg;
  if (/ffmpeg failed/i.test(msg)) return `Video encoding failed. ${msg}`;
  if (/ENOSPC/i.test(msg)) return 'Server disk is full — delete old videos and try again';
  if (/timed out/i.test(msg)) return 'Render took too long (over 20 min) and was stopped';
  return msg || 'Render failed';
}

export async function removeFiles(fileName: string | null) {
  if (!fileName || !/^[\w-]+$/.test(fileName)) return;
  for (const ext of ['mp4', 'jpg', 'wav']) await fs.promises.rm(path.join(MEDIA_DIR, `${fileName}.${ext}`), { force: true }).catch(() => null);
}

export async function deleteJob(id: number): Promise<'ok' | 'missing' | 'busy'> {
  const row = (await prisma.$queryRawUnsafe<JobRow[]>('SELECT * FROM video_jobs WHERE id = ?', id))[0];
  if (!row) return 'missing';
  if (row.status === 'rendering') return 'busy';
  await prisma.$executeRawUnsafe('DELETE FROM video_jobs WHERE id = ?', id);
  await removeFiles(row.file_name);
  return 'ok';
}

/** Keep the newest `keepLast` finished videos; drop older ones and week-old failures. */
export async function cleanup(keepLast: number): Promise<number> {
  const old = await prisma.$queryRawUnsafe<JobRow[]>(
    `SELECT * FROM video_jobs WHERE status = 'done' ORDER BY id DESC LIMIT 100000 OFFSET ${Math.max(1, Math.floor(keepLast))}`
  );
  const failed = await prisma.$queryRawUnsafe<JobRow[]>("SELECT * FROM video_jobs WHERE status = 'failed' AND created_at < NOW() - INTERVAL 7 DAY");
  for (const r of [...old, ...failed]) {
    await prisma.$executeRawUnsafe('DELETE FROM video_jobs WHERE id = ?', Number(r.id));
    await removeFiles(r.file_name);
  }
  return old.length + failed.length;
}

/** On server start: anything left "rendering" was interrupted → failed; resume the queue. */
export async function recoverQueue() {
  await prisma.$executeRawUnsafe(
    "UPDATE video_jobs SET status = 'failed', error = 'Server restarted during render — please generate again', finished_at = NOW() WHERE status = 'rendering'"
  );
  void kick();
}

export const mediaFile = (fileName: string, ext: 'mp4' | 'jpg') => path.join(MEDIA_DIR, `${fileName}.${ext}`);
