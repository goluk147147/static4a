/**
 * Dev tool (run once): generates the Android notification SMALL icon for the
 * mobile app — a WHITE, transparent-background, monochrome silhouette. Android
 * tints the small icon and masks it to white, so the source MUST be a white
 * shape on a transparent canvas (a full-colour logo renders as a white blob).
 *
 * Draws a simple shopping-basket mark with "4A" above it, 96x96, white pixels
 * only (alpha elsewhere), and writes the PNG into the MAIN mobile repo:
 *   4astore-v2/mobile/assets/images/notification-icon.png
 *
 * Usage (from api-node/):  npx ts-node --transpile-only scripts/make-notification-icon.ts
 * Uses @napi-rs/canvas (already a dependency here) — no new mobile dependency.
 */
import fs from 'fs';
import path from 'path';
import { createCanvas } from '@napi-rs/canvas';

const SIZE = 96;
// Output goes into the MAIN mobile repo (NOT the worktree). Allow an override
// for portability, but default to the known absolute MAIN-repo asset path.
const OUT =
  process.env.NOTIFICATION_ICON_OUT ||
  'c:\\xampp\\htdocs\\static4a\\4astore-v2\\mobile\\assets\\images\\notification-icon.png';

const canvas = createCanvas(SIZE, SIZE);
const ctx = canvas.getContext('2d');

// Transparent background (canvas starts fully transparent). Everything we draw
// is pure white so Android's monochrome tinting looks correct.
ctx.clearRect(0, 0, SIZE, SIZE);
ctx.fillStyle = '#FFFFFF';
ctx.strokeStyle = '#FFFFFF';
ctx.lineJoin = 'round';
ctx.lineCap = 'round';

// --- "4A" wordmark (top third) ---
ctx.font = 'bold 34px sans-serif';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('4A', SIZE / 2, 26);

// --- Shopping basket (bottom two-thirds) ---
// Trapezoid body.
const bx = 20;        // left of basket top
const bw = SIZE - 2 * bx; // basket top width
const topY = 50;
const botY = 82;
const inset = 8;      // bottom is narrower → trapezoid

ctx.lineWidth = 5;
ctx.beginPath();
ctx.moveTo(bx, topY);
ctx.lineTo(bx + bw, topY);
ctx.lineTo(bx + bw - inset, botY);
ctx.lineTo(bx + inset, botY);
ctx.closePath();
ctx.stroke();

// Handle (arc over the basket rim).
ctx.lineWidth = 4;
ctx.beginPath();
ctx.arc(SIZE / 2, topY, 14, Math.PI, 2 * Math.PI);
ctx.stroke();

// Two slots on the basket face.
ctx.lineWidth = 3;
const slot = (dx: number) => {
  ctx.beginPath();
  ctx.moveTo(SIZE / 2 + dx, topY + 7);
  ctx.lineTo(SIZE / 2 + dx * 0.6, botY - 6);
  ctx.stroke();
};
slot(-9);
slot(9);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, canvas.toBuffer('image/png'));
// eslint-disable-next-line no-console
console.log(`[icon] wrote ${OUT} (${SIZE}x${SIZE}, white silhouette on transparent)`);
