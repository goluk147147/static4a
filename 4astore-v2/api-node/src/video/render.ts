// renderVideo(options) → mp4 (+ jpg thumbnail). Ported from promo-video/render.js:
// frames are drawn with @napi-rs/canvas and piped as raw RGBA into ffmpeg (args array,
// never a shell string), mixed with the generated music track.
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { createCanvas, loadImage, Image } from '@napi-rs/canvas';
import { ensureFonts } from './fonts';
import { makeStage } from './draw';
import { buildTimeline, drawFrame, makeTheme, previewTimes, SceneCtx } from './scenes';
import { writeMusic } from './music';
import { T } from './i18n';
import type { RenderOptions, ProgressFn, VideoProduct } from './types';
import { fetchRemoteImage } from '../routes/imgProxy';

export const FPS = 30;
export const SIZES = { reel: { W: 1080, H: 1920 }, square: { W: 1080, H: 1080 } } as const;

/** ffmpeg binary: FFMPEG_PATH env (e.g. system ffmpeg on Linux) or the bundled ffmpeg-static. */
export function ffmpegPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const p = process.env.FFMPEG_PATH || (require('ffmpeg-static') as string | null) || '';
  if (!p || !fs.existsSync(p)) throw new Error('ffmpeg not found — run "npm install" (ffmpeg-static) or set FFMPEG_PATH');
  return p;
}

const UPLOAD_RE = /^\/api\/uploads\/(banners|ads)\/[\w.-]+$/;

async function loadProductImage(p: VideoProduct): Promise<Image | null> {
  const src = (p.image || '').trim();
  if (!src) return null;
  try {
    if (/^https?:\/\//i.test(src)) return await loadImage(await fetchRemoteImage(src));
    if (UPLOAD_RE.test(src)) {
      const file = path.join(process.cwd(), 'uploads', ...src.replace('/api/uploads/', '').split('/'));
      return await loadImage(await fs.promises.readFile(file));
    }
  } catch {
    /* broken image → category emoji fallback */
  }
  return null;
}

async function prepare(o: RenderOptions) {
  ensureFonts();
  const { W, H } = SIZES[o.format];
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const images = new Map<number, Image | null>();
  await Promise.all(o.featuredProducts.slice(0, 4).map(async (p) => images.set(p.id, await loadProductImage(p))));
  const sc: SceneCtx = { st: makeStage(ctx, W, H), o, images, c: makeTheme(o), L: T(o.lang) };
  return { canvas, ctx, sc, timeline: buildTimeline(o), W, H, brokenImages: [...images.values()].filter((i) => !i).length };
}

/** 3–4 PNG stills (one per scene) for the admin preview. */
export async function renderPreviews(o: RenderOptions, max = 4): Promise<{ t: number; png: Buffer }[]> {
  const { canvas, sc, timeline } = await prepare(o);
  return previewTimes(timeline, max).map((t) => {
    drawFrame(sc, timeline, t);
    return { t: Math.round(t * 10) / 10, png: canvas.toBuffer('image/png') };
  });
}

export interface RenderResult {
  mp4: string;
  jpg: string;
  sizeBytes: number;
  brokenImages: number;
}

/** Full render. Writes <outDir>/<baseName>.mp4 and .jpg; reports 0–100 progress. */
export async function renderVideo(o: RenderOptions, outDir: string, baseName: string, onProgress: ProgressFn = () => {}): Promise<RenderResult> {
  if (!/^[\w-]{1,80}$/.test(baseName)) throw new Error('bad file name');
  const ff = ffmpegPath();
  const { canvas, ctx, sc, timeline, W, H, brokenImages } = await prepare(o);
  await fs.promises.mkdir(outDir, { recursive: true });
  const mp4 = path.join(outDir, `${baseName}.mp4`);
  const jpg = path.join(outDir, `${baseName}.jpg`);
  const wav = path.join(outDir, `${baseName}.wav`);
  const total = FPS * o.durationSec;

  // thumbnail: late in the first scene (logo / greeting fully visible)
  drawFrame(sc, timeline, Math.min(timeline[0][1] * 0.8, 3.5));
  await fs.promises.writeFile(jpg, canvas.toBuffer('image/jpeg', 82));

  writeMusic(wav, o.durationSec, o.musicStyle);
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', 'pipe:0',
    '-i', wav,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', mp4,
  ];
  const proc = spawn(ff, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
  let stderr = '';
  proc.stderr.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-2000); });
  const done = new Promise<number>((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', (code) => resolve(code ?? -1));
  });
  let broken = false;
  proc.stdin.on('error', () => { broken = true; });

  try {
    let last = -1;
    for (let f = 0; f < total && !broken; f++) {
      drawFrame(sc, timeline, f / FPS);
      const data = ctx.getImageData(0, 0, W, H).data;
      if (!proc.stdin.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength))) {
        await new Promise<void>((r) => proc.stdin.once('drain', () => r()));
      }
      const pct = Math.floor((f / total) * 97);
      if (pct !== last) { last = pct; onProgress(pct); }
    }
    proc.stdin.end();
    const code = await done;
    if (code !== 0) throw new Error(`ffmpeg failed (exit ${code}): ${stderr.trim().split('\n').pop() || 'unknown error'}`);
  } catch (e) {
    proc.kill('SIGKILL');
    await fs.promises.rm(mp4, { force: true });
    await fs.promises.rm(jpg, { force: true });
    throw e;
  } finally {
    await fs.promises.rm(wav, { force: true });
  }
  onProgress(100);
  const { size } = await fs.promises.stat(mp4);
  return { mp4, jpg, sizeBytes: size, brokenImages };
}
