// Drawing helpers ported from promo-video/render.js (same easing, shapes, gradient,
// bubbles and emoji rain), generalised for any frame size (reel 1080x1920 / square 1080x1080).
import type { Image, SKRSContext2D } from '@napi-rs/canvas';
import { font, emojiFont, Weight } from './fonts';

export const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const prog = (t: number, start: number, dur: number) => clamp((t - start) / dur);
export const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
export const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const back = (x: number) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
export const lerp = (a: number, b: number, x: number) => a + (b - a) * x;
const pos = (v: number) => Math.max(v, 0.001);

/**
 * Layout for one frame size. Scenes are designed on the original 1080x1920 grid:
 *  - Y(v): vertical position on that grid → this frame's height
 *  - S(v): element size (fonts, cards, radii) → shrinks for square so things still fit
 */
export interface Stage {
  ctx: SKRSContext2D;
  W: number;
  H: number;
  k: number;
  Y: (v: number) => number;
  S: (v: number) => number;
  square: boolean;
}

export function makeStage(ctx: SKRSContext2D, W: number, H: number): Stage {
  const ky = H / 1920;
  const k = Math.min(1, ky * 1.12);
  return { ctx, W, H, k, Y: (v) => v * ky, S: (v) => v * k, square: H <= W };
}

export function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export interface TextOpts {
  size: number;
  weight?: Weight;
  color?: string;
  align?: CanvasTextAlign;
  alpha?: number;
  shadow?: boolean;
  maxWidth: number;
  maxLines?: number; // wrap onto up to N lines before shrinking
  lineHeight?: number; // multiple of font size
  minSize?: number;
  strike?: boolean;
  outline?: boolean; // default: same as shadow
  maxHeight?: number; // shrink until the wrapped block also fits this height
}

function wrap(ctx: SKRSContext2D, str: string, maxWidth: number, maxLines: number): string[] | null {
  const words = str.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= maxWidth || !cur) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) return null;
  if (lines.some((l) => ctx.measureText(l).width > maxWidth)) return null;
  return lines;
}

/**
 * Original text() with auto-fit: wraps to maxLines, then shrinks the font until every
 * line fits maxWidth — text can never overflow. (x, y) is the centre of the text block.
 * Returns the block height actually used.
 */
export function text(ctx: SKRSContext2D, str: string, x: number, y: number, o: TextOpts): number {
  if (!str) return 0;
  const weight = o.weight || 'heavy';
  const maxLines = o.maxLines || 1;
  const lh = o.lineHeight || 1.15;
  const minSize = o.minSize || 14;
  let size = o.size;
  let lines: string[] | null = null;
  ctx.save();
  while (size >= minSize) {
    ctx.font = font(size, weight);
    lines = wrap(ctx, str, o.maxWidth, maxLines);
    if (lines && (!o.maxHeight || lines.length * size * lh <= o.maxHeight)) break;
    lines = null;
    size -= Math.max(1, Math.round(size * 0.05));
  }
  if (!lines) {
    size = minSize;
    ctx.font = font(size, weight);
    lines = [str];
    // last resort: hard-cut with an ellipsis so nothing leaves the frame
    while (lines[0].length > 1 && ctx.measureText(lines[0] + '…').width > o.maxWidth) lines[0] = lines[0].slice(0, -1);
    if (lines[0] !== str) lines[0] += '…';
  }
  ctx.globalAlpha *= o.alpha ?? 1;
  ctx.fillStyle = o.color || '#ffffff';
  ctx.textAlign = o.align || 'center';
  ctx.textBaseline = 'middle';
  if (o.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = size * 0.2;
    ctx.shadowOffsetY = size * 0.08;
  }
  const blockH = size * lh * lines.length;
  let ly = y - blockH / 2 + (size * lh) / 2;
  // Outline keeps text readable over busy / light gradient areas (festival colours vary a lot).
  const outline = o.outline ?? !!o.shadow;
  if (outline) {
    const light = contrast(String(ctx.fillStyle), '#000000') > contrast(String(ctx.fillStyle), '#ffffff');
    ctx.strokeStyle = light ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.6)';
    ctx.lineWidth = Math.max(2, size * (weight === 'regular' ? 0.06 : 0.09));
    ctx.lineJoin = 'round';
  }
  for (const line of lines) {
    if (outline) ctx.strokeText(line, x, ly);
    ctx.fillText(line, x, ly);
    if (o.strike) {
      const w = ctx.measureText(line).width;
      const sx = o.align === 'left' ? x : o.align === 'right' ? x - w : x - w / 2;
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = ctx.fillStyle as string;
      ctx.lineWidth = Math.max(2, size * 0.08);
      ctx.beginPath();
      ctx.moveTo(sx, ly);
      ctx.lineTo(sx + w, ly);
      ctx.stroke();
    }
    ly += size * lh;
  }
  ctx.restore();
  return blockH;
}

export function emoji(ctx: SKRSContext2D, e: string, x: number, y: number, size: number, alpha = 1) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = emojiFont(size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(e, x, y);
  ctx.restore();
}

/** Original bgGradient(): diagonal gradient + soft moving bubbles. */
export function bgGradient(st: Stage, t: number, c1: string, c2: string) {
  const { ctx, W, H } = st;
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, c1);
  g.addColorStop(1, c2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  for (let i = 0; i < 9; i++) {
    const r = st.S(120 + ((i * 53) % 180));
    const x = ((i * 337 + t * 40 * (i % 2 ? 1 : -1)) % (W + 400)) - 200;
    const y = ((i * 571 + t * 25) % (H + 400)) - 200;
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x < -200 ? x + W + 400 : x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export const GROCERY = ['🍎', '🥦', '🥛', '🍞', '🥚', '🍅', '🧅', '🥔', '🍌', '🧈', '🍚', '🫘', '🌶️', '🥕', '🧃', '🍪'];

/** Original emojiRain(): falling emojis (grocery by default, festival emojis for festivals). */
export function emojiRain(st: Stage, t: number, alpha = 0.9, set: string[] = GROCERY) {
  const { ctx, W, H } = st;
  if (!set.length) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  for (let i = 0; i < 18; i++) {
    const speed = (180 + ((i * 37) % 160)) * (H / 1920);
    const x = 60 + ((i * 263) % (W - 120));
    const y = ((i * 431 + t * speed) % (H + 300)) - 150;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(t * 2 + i) * 0.4);
    ctx.font = emojiFont(st.S(90 + (i % 3) * 20));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(set[i % set.length], 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

/** Twinkling sparkles for festival scenes. */
export function sparkles(st: Stage, t: number, color: string, alpha = 0.8) {
  const { ctx, W, H } = st;
  ctx.save();
  for (let i = 0; i < 26; i++) {
    const x = (i * 397) % W;
    const y = (i * 613) % H;
    const tw = 0.5 + 0.5 * Math.sin(t * 3 + i * 1.7);
    const r = st.S(4 + (i % 4) * 3) * (0.6 + tw);
    ctx.globalAlpha = alpha * tw;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let p = 0; p < 8; p++) {
      const ang = (p * Math.PI) / 4;
      const rr = p % 2 ? r * 0.35 : r;
      ctx.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Scale-in wrapper used everywhere in the original (translate + scale around a point). */
export function scaled(ctx: SKRSContext2D, x: number, y: number, s: number, fn: () => void) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(pos(s), pos(s));
  fn();
  ctx.restore();
}

/** Draws an image "contain"-fitted into a box. */
export function drawContain(ctx: SKRSContext2D, img: Image, x: number, y: number, w: number, h: number) {
  const s = Math.min(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

// ---- colour utils ----
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0xff6600;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
/** preferred colour if readable on bg, otherwise the first fallback that is. */
export function readable(bg: string, preferred: string, ...fallbacks: string[]) {
  for (const c of [preferred, ...fallbacks]) if (contrast(bg, c) >= 3) return c;
  return contrast(bg, '#ffffff') > contrast(bg, '#1a1a2e') ? '#ffffff' : '#1a1a2e';
}
export function mix(a: string, b: string, x: number) {
  const A = hexToRgb(a), B = hexToRgb(b);
  const c = A.map((v, i) => Math.round(lerp(v, B[i], x)));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}
