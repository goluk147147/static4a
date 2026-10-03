// Server-side Open Graph share-image generator.
//
// Renders a 1200x630 branded "4A Store" card with @napi-rs/canvas (gradient
// background + grocery illustration ported from the root generate-og.html art),
// optionally drawing a real product image into the right panel, then encodes and
// COMPRESSES the result to <= 100 KB (WEBP first, JPEG fallback, stepping quality
// down and finally downscaling until it fits). Results are cached in memory and on
// disk under uploads/og/ so repeat crawler hits are instant.

import fs from 'fs';
import path from 'path';
import { createCanvas, loadImage, Canvas, Image, SKRSContext2D } from '@napi-rs/canvas';

const WIDTH = 1200;
const HEIGHT = 630;
const MAX_BYTES = 100 * 1024; // 100 KB hard cap for the share image

export const OG_DIR = path.join(process.cwd(), 'uploads', 'og');
const LOGO_PATH = path.join(process.cwd(), 'assets', 'og-logo.png');

export interface OgImage {
  buffer: Buffer;
  contentType: 'image/webp' | 'image/jpeg';
  ext: 'webp' | 'jpeg';
}

export interface RenderOgOptions {
  title: string;
  subtitle?: string;
  imageUrl?: string | null; // absolute/same-origin product image, or null for the logo card
  price?: string; // pre-formatted price text, e.g. "₹49"
}

// Small in-memory cache keyed by caller (e.g. `product-12-1699999999999`). Bounded.
const memCache = new Map<string, OgImage>();
const MEM_LIMIT = 100;

function memSet(key: string, img: OgImage) {
  if (memCache.size >= MEM_LIMIT) {
    const first = memCache.keys().next().value;
    if (first !== undefined) memCache.delete(first);
  }
  memCache.set(key, img);
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number, fill?: string | CanvasGradient) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
}

let logoImage: Image | null | undefined; // undefined = not tried, null = unavailable
async function getLogo(): Promise<Image | null> {
  if (logoImage !== undefined) return logoImage;
  try {
    logoImage = await loadImage(await fs.promises.readFile(LOGO_PATH));
  } catch {
    logoImage = null;
  }
  return logoImage;
}

async function tryLoadImage(url?: string | null): Promise<Image | null> {
  if (!url) return null;
  try {
    if (/^https?:\/\//i.test(url)) return await loadImage(url);
    // Same-origin relative path (e.g. /api/uploads/...) → read from disk.
    const rel = url.replace(/^\/+/, '').replace(/^api\//, '');
    const abs = path.join(process.cwd(), rel);
    return await loadImage(await fs.promises.readFile(abs));
  } catch {
    return null;
  }
}

function drawBackground(ctx: SKRSContext2D) {
  const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  bg.addColorStop(0, '#1a5276');
  bg.addColorStop(0.5, '#2C6FAD');
  bg.addColorStop(1, '#148f77');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Decorative circles
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = '#fff';
  for (const [cx, cy, r] of [[100, 80, 120], [1100, 550, 150], [600, 600, 80], [1050, 100, 60]]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 0.05;
  for (const [cx, cy, r] of [[300, 500, 200], [900, 300, 250]]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Corner accents
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(80, 0);
  ctx.lineTo(0, 80);
  ctx.closePath();
  ctx.fillStyle = '#F5A623';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(WIDTH, HEIGHT);
  ctx.lineTo(WIDTH - 80, HEIGHT);
  ctx.lineTo(WIDTH, HEIGHT - 80);
  ctx.closePath();
  ctx.fillStyle = '#4CAF50';
  ctx.fill();
}

function drawBrandCard(ctx: SKRSContext2D) {
  // White card on the left with the 4A Store identity (ported from generate-og.html).
  roundRect(ctx, 50, 140, 520, 380, 24, 'rgba(255,255,255,0.95)');

  const bagGrd = ctx.createLinearGradient(80, 200, 200, 330);
  bagGrd.addColorStop(0, '#A8D4F5');
  bagGrd.addColorStop(1, '#5BA3D9');
  roundRect(ctx, 85, 195, 100, 115, 14, bagGrd);

  ctx.beginPath();
  ctx.arc(135, 198, 25, Math.PI, 0, false);
  ctx.strokeStyle = '#F5A623';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.stroke();

  ctx.font = '900 46px sans-serif';
  ctx.fillStyle = '#F5A623';
  ctx.fillText('4', 97, 275);
  ctx.fillStyle = '#4CAF50';
  ctx.fillText('A', 134, 275);

  ctx.beginPath();
  ctx.arc(95, 190, 8, 0, Math.PI * 2);
  ctx.fillStyle = '#E53935';
  ctx.fill();

  ctx.font = '900 52px sans-serif';
  ctx.fillStyle = '#2C6FAD';
  ctx.fillText('STORE', 200, 260);

  ctx.font = '600 20px sans-serif';
  ctx.fillStyle = '#5BA3D9';
  ctx.fillText('GROCERY IN MINUTES', 200, 295);

  ctx.beginPath();
  ctx.moveTo(85, 330);
  ctx.lineTo(530, 330);
  ctx.strokeStyle = '#E0E0E0';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// Wrap text into at most `maxLines` lines that fit `maxWidth`, last line ellipsised.
function wrapLines(ctx: SKRSContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines - 1) break;
    } else {
      line = next;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  // If text overflowed, ellipsise the last line.
  if (lines.length === maxLines) {
    let last = lines[maxLines - 1];
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

function drawCardText(ctx: SKRSContext2D, title: string, subtitle: string | undefined, price?: string) {
  ctx.textAlign = 'left';
  ctx.font = '700 30px sans-serif';
  ctx.fillStyle = '#222';
  const titleLines = wrapLines(ctx, title, 445, 2);
  let y = 375;
  for (const ln of titleLines) {
    ctx.fillText(ln, 85, y);
    y += 38;
  }

  if (subtitle) {
    ctx.font = '400 19px sans-serif';
    ctx.fillStyle = '#666';
    const subLines = wrapLines(ctx, subtitle, 445, 2);
    for (const ln of subLines) {
      ctx.fillText(ln, 85, y);
      y += 26;
    }
  }

  if (price) {
    roundRect(ctx, 85, 468, Math.min(200, 60 + price.length * 22), 44, 22, '#F5A623');
    ctx.font = '800 24px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(price, 104, 498);
  }
}

async function drawRightPanel(ctx: SKRSContext2D, productImg: Image | null) {
  // Backing circle for the right-hand visual.
  ctx.beginPath();
  ctx.arc(880, 315, 230, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fill();

  if (productImg) {
    // Draw the product image fit inside a rounded white tile (contain, centered).
    const box = { x: 650, y: 95, w: 460, h: 440 };
    roundRect(ctx, box.x, box.y, box.w, box.h, 20, 'rgba(255,255,255,0.95)');
    const pad = 24;
    const availW = box.w - pad * 2;
    const availH = box.h - pad * 2;
    const scale = Math.min(availW / productImg.width, availH / productImg.height);
    const dw = productImg.width * scale;
    const dh = productImg.height * scale;
    const dx = box.x + (box.w - dw) / 2;
    const dy = box.y + (box.h - dh) / 2;
    ctx.drawImage(productImg, dx, dy, dw, dh);
    return;
  }

  // No product image → draw a simple grocery illustration (apple + orange + banana).
  ctx.beginPath();
  ctx.arc(820, 240, 70, 0, Math.PI * 2);
  ctx.fillStyle = '#E53935';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(820, 165, 14, 8, -0.3, 0, Math.PI * 2);
  ctx.fillStyle = '#4CAF50';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(970, 280, 56, 0, Math.PI * 2);
  ctx.fillStyle = '#FF9800';
  ctx.fill();

  ctx.lineWidth = 22;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(760, 420);
  ctx.quadraticCurveTo(840, 370, 940, 390);
  ctx.strokeStyle = '#FDD835';
  ctx.stroke();
}

/** Encode+compress a 1200x630 (or downscaled) canvas to <= 100 KB. */
async function compress(draw: (scale: number) => Promise<Canvas>): Promise<OgImage> {
  const scales = [1, 0.85, 0.7];
  const qualities = [85, 70, 55, 40];
  let best: OgImage | null = null;
  for (const scale of scales) {
    const canvas = await draw(scale);
    for (const q of qualities) {
      // WEBP compresses best; keep JPEG as a widely-crawler-safe fallback.
      const webp = await canvas.encode('webp', q);
      if (webp.length <= MAX_BYTES) return { buffer: webp, contentType: 'image/webp', ext: 'webp' };
      const jpeg = await canvas.encode('jpeg', q);
      if (jpeg.length <= MAX_BYTES) return { buffer: jpeg, contentType: 'image/jpeg', ext: 'jpeg' };
      // Remember the smallest seen so far as a last resort.
      const smaller = webp.length <= jpeg.length
        ? ({ buffer: webp, contentType: 'image/webp', ext: 'webp' } as OgImage)
        : ({ buffer: jpeg, contentType: 'image/jpeg', ext: 'jpeg' } as OgImage);
      if (!best || smaller.buffer.length < best.buffer.length) best = smaller;
    }
  }
  // Should not happen for 1200x630 branded art, but never return nothing.
  return best as OgImage;
}

/** Render a branded OG image and compress it to <= 100 KB. */
export async function renderOgImage(opts: RenderOgOptions): Promise<OgImage> {
  const productImg = await tryLoadImage(opts.imageUrl);
  const logo = productImg ? null : await getLogo();

  return compress(async (scale) => {
    const canvas = createCanvas(Math.round(WIDTH * scale), Math.round(HEIGHT * scale));
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    drawBackground(ctx);
    drawBrandCard(ctx);
    drawCardText(ctx, opts.title, opts.subtitle, opts.price);
    if (productImg) {
      await drawRightPanel(ctx, productImg);
    } else if (logo) {
      // Logo card: draw the raster logo centered in the right panel.
      ctx.beginPath();
      ctx.arc(880, 315, 230, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fill();
      const size = 300;
      ctx.drawImage(logo, 880 - size / 2, 315 - size / 2, size, size);
    } else {
      await drawRightPanel(ctx, null);
    }
    return canvas;
  });
}

/** Memory + disk cached render. `cacheKey` should change when the source changes. */
export async function getOrRenderOg(cacheKey: string, opts: RenderOgOptions): Promise<OgImage> {
  const mem = memCache.get(cacheKey);
  if (mem) return mem;

  const safeKey = cacheKey.replace(/[^a-zA-Z0-9_.-]/g, '_');
  await fs.promises.mkdir(OG_DIR, { recursive: true });
  // Try either cached extension on disk.
  for (const ext of ['webp', 'jpeg'] as const) {
    const file = path.join(OG_DIR, `${safeKey}.${ext}`);
    try {
      const buffer = await fs.promises.readFile(file);
      const img: OgImage = { buffer, contentType: ext === 'webp' ? 'image/webp' : 'image/jpeg', ext };
      memSet(cacheKey, img);
      return img;
    } catch {
      /* not cached in this format */
    }
  }

  const img = await renderOgImage(opts);
  memSet(cacheKey, img);
  // Persist to disk best-effort (do not fail the request if the write fails).
  fs.promises.writeFile(path.join(OG_DIR, `${safeKey}.${img.ext}`), img.buffer).catch(() => undefined);
  return img;
}
