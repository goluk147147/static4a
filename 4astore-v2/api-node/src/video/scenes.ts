// Scenes for the three templates. "general" is the original render.js flow (intro →
// hook → features → steps → CTA); "festival" and "daily" reuse the same helpers and
// animation style. Everything is laid out on the 1080x1920 grid via Stage.Y / Stage.S,
// so the same code serves reel (1080x1920) and square (1080x1080).
import type { Image } from '@napi-rs/canvas';
import {
  Stage, prog, easeOut, easeInOut, back, lerp, clamp, roundRect, text, emoji, bgGradient, emojiRain, sparkles,
  scaled, drawContain, readable, mix, GROCERY,
} from './draw';
import type { RenderOptions, VideoProduct } from './types';
import type { Strings } from './i18n';

export interface SceneCtx {
  st: Stage;
  o: RenderOptions;
  images: Map<number, Image | null>;
  c: Theme;
  L: Strings; // built-in text in the video's language
}
type SceneFn = (sc: SceneCtx, t: number, dur: number) => void;

interface Theme {
  P: string; S: string; A: string; ink: string; light: string; white: string; green: string; gray: string;
  onBright: string; // text colour on the P→A gradient
  head: string; // headline colour on light backgrounds
}

export function makeTheme(o: RenderOptions): Theme {
  const { primary: P, secondary: S, accent: A } = o.colors;
  const light = o.store.theme.light;
  const ink = o.store.theme.ink;
  return {
    P, S, A, ink, light, white: '#ffffff', green: '#25D366', gray: '#6c757d',
    onBright: readable(mix(P, A, 0.5), '#ffffff', ink),
    head: readable(light, P, A, ink),
  };
}

/** Delay scaler: keeps staggered animations inside shorter scenes (15 s videos). */
const z = (dur: number, base: number) => Math.min(1, dur / base);
const lightBg = (sc: SceneCtx, t: number) => bgGradient(sc.st, t, sc.c.light, mix(sc.c.light, sc.c.P, 0.18));
const brightBg = (sc: SceneCtx, t: number, a = sc.c.P, b = sc.c.A) => bgGradient(sc.st, t, a, b);
const inr = (n: number) => '₹' + (Math.round(n * 100) / 100).toLocaleString('en-IN');

// =====================================================================
// GENERAL (original brand promo)
// =====================================================================
function sceneIntro(sc: SceneCtx, t: number, dur: number) {
  const { st, o, c } = sc;
  const { ctx, W, Y, S } = st;
  const k = z(dur, 4);
  brightBg(sc, t);
  emojiRain(st, t, 0.35, sc.o.template === 'festival' && o.emojis.length ? o.emojis : GROCERY);
  const s = back(prog(t, 0.2 * k, 0.8 * k));
  scaled(ctx, W / 2, Y(760), s, () => {
    ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = S(50); ctx.shadowOffsetY = S(20);
    roundRect(ctx, -S(210), -S(210), S(420), S(420), S(90));
    ctx.fillStyle = c.white; ctx.fill();
    ctx.shadowColor = 'transparent';
    roundRect(ctx, -S(180), -S(180), S(360), S(360), S(70)); ctx.fillStyle = c.light; ctx.fill();
    emoji(ctx, '🛒', 0, S(10), S(230));
  });
  const a = easeOut(prog(t, 0.9 * k, 0.6 * k));
  text(ctx, o.store.name, W / 2, Y(1110) + (1 - a) * S(60), { size: S(150), alpha: a, shadow: true, color: c.onBright, outline: true, maxWidth: W - 120 });
  const b = easeOut(prog(t, 1.4 * k, 0.6 * k));
  text(ctx, o.store.tagline, W / 2, Y(1250) + (1 - b) * S(40), { size: S(62), weight: 'bold', alpha: b, color: c.onBright, outline: true, maxWidth: W - 120 });
  const cc = easeOut(prog(t, 2.0 * k, 0.5 * k));
  ctx.save(); ctx.globalAlpha = cc;
  roundRect(ctx, W / 2 - S(330), Y(1386) - S(45), S(660), S(90), S(45)); ctx.fillStyle = c.white; ctx.fill();
  ctx.restore();
  text(ctx, '📍 ' + o.store.area.split(',')[0], W / 2, Y(1386), { size: S(48), weight: 'bold', color: readable(c.white, c.P, c.ink), alpha: cc, maxWidth: S(620) });
}

function sceneHook(sc: SceneCtx, t: number, dur: number) {
  const { st, c } = sc;
  const { ctx, W, Y, S } = st;
  const k = z(dur, 4);
  lightBg(sc, t);
  emojiRain(st, t, 0.5);
  ctx.save(); ctx.globalAlpha = 0.85 * easeOut(prog(t, 0, 0.3));
  roundRect(ctx, 60, Y(580), W - 120, Y(950), S(80)); ctx.fillStyle = '#fff8ef'; ctx.fill();
  ctx.restore();
  const lines = [
    { s: sc.L.hook[0], col: c.ink, size: 110, at: 0.1, y: 720 },
    { s: sc.L.hook[1], col: c.head, size: 190, at: 0.4, y: 890 },
    { s: sc.L.hook[2], col: readable('#fff8ef', c.A, c.ink), size: 150, at: 0.7, y: 1100 },
  ];
  for (const l of lines) {
    const p = back(prog(t, l.at * k, 0.5 * k));
    scaled(ctx, W / 2, Y(l.y), p, () => text(ctx, l.s, 0, 0, { size: S(l.size), color: l.col, maxWidth: W - 200 }));
  }
  const p = easeOut(prog(t, 1.4 * k, 0.5 * k));
  ctx.save(); ctx.globalAlpha = p;
  roundRect(ctx, 100, Y(1405) - S(75), W - 200, S(150), S(75)); ctx.fillStyle = c.P; ctx.fill();
  ctx.restore();
  text(ctx, sc.L.staples, W / 2, Y(1405), { size: S(46), weight: 'bold', alpha: p, color: readable(c.P, '#ffffff', c.ink), maxWidth: W - 300 });
}

function sceneFeatures(sc: SceneCtx, t: number, dur: number) {
  const { st, o, c } = sc;
  const { ctx, W, Y, S } = st;
  const k = z(dur, 5.5);
  const features = sc.L.features(o.store.freeAbove, o.store.deliveryCharge);
  brightBg(sc, t);
  text(ctx, sc.L.whyTitle, W / 2, Y(300), { size: S(80), weight: 'bold', alpha: easeOut(prog(t, 0, 0.4)), color: c.onBright, outline: true, maxWidth: W - 120 });
  text(ctx, sc.L.why(o.store.name), W / 2, Y(410), { size: S(130), alpha: easeOut(prog(t, 0.15, 0.4)), shadow: true, color: c.onBright, outline: true, maxWidth: W - 120 });
  const cardH = S(250);
  features.forEach((f, i) => {
    const p = easeOut(prog(t, (0.6 + i * 0.7) * k, 0.5 * k));
    const y = Y(580 + i * 300);
    const x = lerp(W + 100, 80, p);
    const iw = cardH * 0.72;
    ctx.save();
    ctx.globalAlpha = p;
    ctx.shadowColor = 'rgba(0,0,0,0.2)'; ctx.shadowBlur = S(30); ctx.shadowOffsetY = S(10);
    roundRect(ctx, x, y, W - 160, cardH, S(50)); ctx.fillStyle = c.white; ctx.fill();
    ctx.shadowColor = 'transparent';
    roundRect(ctx, x + S(30), y + (cardH - iw) / 2, iw, iw, S(40)); ctx.fillStyle = c.light; ctx.fill();
    emoji(ctx, f.icon, x + S(30) + iw / 2, y + cardH / 2 + S(3), iw * 0.6);
    ctx.restore();
    const tx = x + S(30) + iw + S(40);
    const tw = W - 160 - (tx - x) - S(30);
    text(ctx, f.title, tx, y + cardH * 0.38, { size: S(54), color: c.ink, align: 'left', alpha: p, maxWidth: tw });
    text(ctx, f.sub, tx, y + cardH * 0.68, { size: S(42), weight: 'regular', color: c.gray, align: 'left', alpha: p, maxWidth: tw });
  });
}

function sceneSteps(sc: SceneCtx, t: number, dur: number) {
  const { st, c } = sc;
  const { ctx, W, Y, S } = st;
  const k = z(dur, 4.5);
  const steps = sc.L.steps;
  lightBg(sc, t);
  text(ctx, sc.L.stepsTitle[0], W / 2, Y(330), { size: S(90), color: c.ink, alpha: easeOut(prog(t, 0, 0.4)), maxWidth: W - 120 });
  text(ctx, sc.L.stepsTitle[1], W / 2, Y(450), { size: S(100), color: c.head, alpha: easeOut(prog(t, 0.2, 0.4)), maxWidth: W - 120 });
  const cx = S(250);
  steps.forEach((s, i) => {
    const p = back(prog(t, (0.6 + i * 0.6) * k, 0.5 * k));
    const y = Y(680 + i * 290);
    if (i < steps.length - 1) {
      const lp = prog(t, (0.9 + i * 0.6) * k, 0.4 * k);
      ctx.save(); ctx.strokeStyle = c.P; ctx.lineWidth = S(10); ctx.setLineDash([S(20), S(18)]);
      ctx.beginPath(); ctx.moveTo(cx, y + S(90)); ctx.lineTo(cx, y + S(90) + (Y(290) - S(180)) * lp); ctx.stroke(); ctx.restore();
    }
    scaled(ctx, cx, y, p, () => {
      ctx.beginPath(); ctx.arc(0, 0, S(105), 0, Math.PI * 2); ctx.fillStyle = c.P; ctx.fill();
      emoji(ctx, s.icon, 0, S(6), S(100));
    });
    text(ctx, `${i + 1}. ${s.label}`, cx + S(150), y, { size: S(60), color: c.ink, align: 'left', alpha: clamp(p), maxWidth: W - cx - S(150) - 60 });
  });
}

function sceneCTA(sc: SceneCtx, t: number, dur: number) {
  const { st, o, c } = sc;
  const { ctx, W, Y, S } = st;
  const k = z(dur, 6);
  brightBg(sc, t);
  emojiRain(st, t, 0.3, o.template === 'festival' && o.emojis.length ? o.emojis : GROCERY);
  const p1 = back(prog(t, 0.1 * k, 0.6 * k));
  scaled(ctx, W / 2, Y(430), p1, () => {
    text(ctx, sc.L.ctaTop(o.template === 'festival' ? o.festivalName || null : null), 0, -S(90), { size: S(110), shadow: true, color: c.onBright, outline: true, maxWidth: W - 120 });
    text(ctx, sc.L.ctaMain, 0, S(60), { size: S(140), shadow: true, color: c.onBright, outline: true, maxWidth: W - 120 });
  });

  const p2 = easeOut(prog(t, 0.7 * k, 0.5 * k));
  const pulse = 1 + Math.sin(t * 6) * 0.03;
  ctx.save(); ctx.globalAlpha = p2; ctx.translate(W / 2, Y(820)); ctx.scale(pulse, pulse);
  ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = S(40); ctx.shadowOffsetY = S(14);
  roundRect(ctx, -S(440), -S(110), S(880), S(220), S(110)); ctx.fillStyle = c.white; ctx.fill();
  ctx.restore();
  text(ctx, '📞 ' + o.store.phone, W / 2, Y(820), { size: S(96), color: readable(c.white, c.P, c.ink), alpha: p2, maxWidth: S(800) });

  const p3 = easeOut(prog(t, 1.1 * k, 0.5 * k));
  ctx.save(); ctx.globalAlpha = p3;
  roundRect(ctx, 100, Y(1085) - S(85), W - 200, S(170), S(85)); ctx.fillStyle = c.green; ctx.fill();
  ctx.restore();
  text(ctx, `💬 ${sc.L.whatsapp}: ${o.store.whatsapp}`, W / 2, Y(1085), { size: S(62), alpha: p3, maxWidth: W - 300 });

  const p4 = easeOut(prog(t, 1.5 * k, 0.5 * k));
  text(ctx, '📍 ' + o.store.area, W / 2, Y(1275), { size: S(50), weight: 'bold', alpha: p4, color: c.onBright, outline: true, maxWidth: W - 140 });
  text(ctx, o.store.address, W / 2, Y(1375), { size: S(40), weight: 'regular', alpha: p4, color: c.onBright, outline: true, maxWidth: W - 160, maxLines: 2 });

  const p5 = easeOut(prog(t, 2.0 * k, 0.5 * k));
  ctx.save(); ctx.globalAlpha = p5;
  roundRect(ctx, W / 2 - S(400), Y(1566) - S(65), S(800), S(130), S(65)); ctx.fillStyle = c.ink; ctx.fill();
  ctx.restore();
  text(ctx, `📲 ${sc.L.downloadApp(o.store.name)}`, W / 2, Y(1566), { size: S(54), weight: 'bold', alpha: p5, maxWidth: S(740) });
  text(ctx, sc.L.freeDeliveryLine(o.store.freeAbove), W / 2, Y(1720), { size: S(42), weight: 'bold', alpha: p5, color: c.onBright, outline: true, maxWidth: W - 140 });
}

// =====================================================================
// FESTIVAL
// =====================================================================
function sceneFestIntro(sc: SceneCtx, t: number, dur: number) {
  const { st, o, c } = sc;
  const { ctx, W, Y, S } = st;
  const k = z(dur, 4.5);
  const set = o.emojis.length ? o.emojis : ['🎉'];
  brightBg(sc, t, c.P, c.S);
  sparkles(st, t, c.A, 0.9);
  emojiRain(st, t, 0.3, set);
  const s = back(prog(t, 0.15 * k, 0.8 * k));
  scaled(ctx, W / 2, Y(600), s, () => {
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = c.white;
    ctx.beginPath(); ctx.arc(0, 0, S(250), 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.rotate(Math.sin(t * 2) * 0.06);
    emoji(ctx, set[0], 0, S(12), S(300));
  });
  const onBg = readable(mix(c.P, c.S, 0.5), '#ffffff', c.ink);
  const a = easeOut(prog(t, 0.9 * k, 0.6 * k));
  const gTop = Y(600) + S(270), gBot = Y(1330) - S(105);
  text(ctx, o.greeting || sc.L.happy(o.festivalName), W / 2, (gTop + gBot) / 2 + (1 - a) * S(60), { size: S(130), alpha: a, shadow: true, color: onBg, outline: true, maxWidth: W - 120, maxLines: 3, maxHeight: gBot - gTop });
  const b = easeOut(prog(t, 1.5 * k, 0.6 * k));
  ctx.save(); ctx.globalAlpha = b;
  roundRect(ctx, W / 2 - S(380), Y(1330) - S(55), S(760), S(110), S(55)); ctx.fillStyle = c.white; ctx.fill();
  ctx.restore();
  text(ctx, sc.L.fromStore(o.store.name), W / 2, Y(1330), { size: S(54), weight: 'bold', alpha: b, color: readable(c.white, c.P, c.A, c.ink), maxWidth: S(700) });
  const d = easeOut(prog(t, 2.0 * k, 0.5 * k));
  set.slice(0, 5).forEach((e, i, arr) => {
    const x = W / 2 + (i - (arr.length - 1) / 2) * S(150);
    emoji(ctx, e, x, Y(1540) + Math.sin(t * 4 + i) * S(12), S(100), d);
  });
}

function sceneFestWishes(sc: SceneCtx, t: number, dur: number) {
  const { st, o, c } = sc;
  const { ctx, W, Y, S } = st;
  const k = z(dur, 4);
  lightBg(sc, t);
  emojiRain(st, t, 0.3, o.emojis.length ? o.emojis : GROCERY);
  ctx.save(); ctx.globalAlpha = 0.9 * easeOut(prog(t, 0, 0.3));
  roundRect(ctx, 60, Y(520), W - 120, Y(1000), S(80)); ctx.fillStyle = '#fffdf8'; ctx.fill();
  ctx.restore();
  const panel = '#fffdf8';
  const p1 = easeOut(prog(t, 0.1 * k, 0.5 * k));
  text(ctx, sc.L.family(o.store.name), W / 2, Y(680), { size: S(78), color: c.ink, alpha: p1, maxWidth: W - 220 });
  text(ctx, sc.L.wishesTo, W / 2, Y(790), { size: S(56), weight: 'bold', color: c.gray, alpha: p1, maxWidth: W - 220 });
  const p2 = back(prog(t, 0.5 * k, 0.6 * k));
  const wTop = Y(790) + S(60), wBot = Y(1340) - S(90);
  scaled(ctx, W / 2, (wTop + wBot) / 2, p2, () =>
    text(ctx, o.subText || o.greeting, 0, 0, { size: S(96), color: readable(panel, c.P, c.A, c.ink), maxWidth: W - 240, maxLines: 4, maxHeight: wBot - wTop }));
  const p3 = easeOut(prog(t, 1.2 * k, 0.5 * k));
  ctx.save(); ctx.globalAlpha = p3;
  roundRect(ctx, 130, Y(1340) - S(60), W - 260, S(120), S(60)); ctx.fillStyle = c.P; ctx.fill();
  ctx.restore();
  text(ctx, `${(o.emojis[0] || '✨')} ${o.greeting && o.greeting.length <= 26 ? o.greeting : o.festivalName || o.greeting} ${(o.emojis[1] || '✨')}`, W / 2, Y(1340), { size: S(52), weight: 'bold', alpha: p3, color: readable(c.P, '#ffffff', c.ink), maxWidth: W - 320 });
}

function sceneOffer(sc: SceneCtx, t: number, dur: number) {
  const { st, o, c } = sc;
  const { ctx, W, Y, S } = st;
  const k = z(dur, 4.5);
  brightBg(sc, t, c.A, c.P);
  sparkles(st, t, '#ffffff', 0.6);
  const on = readable(mix(c.A, c.P, 0.5), '#ffffff', c.ink);
  const heading = sc.L.offerHeading(o.template === 'festival' ? o.festivalName || null : null);
  const p0 = back(prog(t, 0.05 * k, 0.6 * k));
  scaled(ctx, W / 2, Y(380), p0, () => text(ctx, `🎁 ${heading}`, 0, 0, { size: S(110), shadow: true, color: on, outline: true, maxWidth: W - 120, maxLines: 2 }));

  const hasCoupon = !!o.couponCode;
  const cardTop = Y(600), cardH = hasCoupon ? Y(820) : Y(560);
  const p1 = easeOut(prog(t, 0.5 * k, 0.6 * k));
  ctx.save();
  ctx.globalAlpha = p1;
  ctx.translate(0, (1 - p1) * S(80));
  ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = S(40); ctx.shadowOffsetY = S(16);
  roundRect(ctx, 80, cardTop, W - 160, cardH, S(60)); ctx.fillStyle = c.white; ctx.fill();
  ctx.shadowColor = 'transparent';
  const offerY = cardTop + (hasCoupon ? cardH * 0.3 : cardH / 2);
  const offerH = hasCoupon ? cardH * 0.74 - S(85) - S(40) - S(30) : cardH - S(80);
  text(ctx, o.offerText || sc.L.defaultOffer, W / 2, hasCoupon ? cardTop + S(30) + offerH / 2 : offerY, { size: S(88), color: c.ink, maxWidth: W - 280, maxLines: 4, maxHeight: offerH });
  if (hasCoupon) {
    const cy = cardTop + cardH * 0.74;
    const bw = W - 320, bh = S(170);
    ctx.save();
    ctx.setLineDash([S(18), S(14)]); ctx.lineWidth = S(6); ctx.strokeStyle = c.P;
    roundRect(ctx, (W - bw) / 2, cy - bh / 2, bw, bh, S(30));
    ctx.fillStyle = mix('#ffffff', c.P, 0.08); ctx.fill(); ctx.stroke();
    ctx.restore();
    text(ctx, sc.L.couponLabel, W / 2, cy - bh * 0.22, { size: S(38), weight: 'bold', color: c.gray, maxWidth: bw - 60 });
    text(ctx, o.couponCode, W / 2, cy + bh * 0.16, { size: S(84), color: readable('#ffffff', c.P, c.A, c.ink), maxWidth: bw - 60 });
  }
  ctx.restore();
  const p2 = easeOut(prog(t, 1.4 * k, 0.5 * k));
  text(ctx, sc.L.onlyAt(o.store.name), W / 2, Y(1560), { size: S(54), weight: 'bold', alpha: p2, color: on, outline: true, maxWidth: W - 140 });
  text(ctx, `🚚 ${sc.L.deliveryShort(o.store.freeAbove, o.store.deliveryCharge)}`, W / 2, Y(1680), { size: S(44), weight: 'bold', alpha: p2, color: on, outline: true, maxWidth: W - 140 });
}

// ---- product cards (festival featured products + daily deals) ----
function productCard(sc: SceneCtx, p: VideoProduct, x: number, y: number, w: number, h: number, alpha: number) {
  const { st, c } = sc;
  const { ctx } = st;
  const u = Math.min(w / 460, h / 620); // card-local unit
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.shadowColor = 'rgba(0,0,0,0.22)'; ctx.shadowBlur = 30 * u; ctx.shadowOffsetY = 10 * u;
  roundRect(ctx, x, y, w, h, 44 * u); ctx.fillStyle = c.white; ctx.fill();
  ctx.shadowColor = 'transparent';
  const pad = 22 * u;
  const imgH = h * 0.5;
  roundRect(ctx, x + pad, y + pad, w - pad * 2, imgH - pad, 30 * u); ctx.fillStyle = c.light; ctx.fill();
  const img = sc.images.get(p.id);
  if (img) drawContain(ctx, img, x + pad * 2, y + pad * 2, w - pad * 4, imgH - pad * 3);
  else emoji(ctx, p.emoji || '🛍️', x + w / 2, y + pad + (imgH - pad) / 2, Math.min(w, imgH) * 0.45);
  const off = p.mrp > p.price && p.price > 0 ? Math.round(((p.mrp - p.price) / p.mrp) * 100) : 0;
  if (off > 0) {
    const bw = 150 * u, bh = 62 * u;
    roundRect(ctx, x + w - bw - pad * 0.6, y + pad * 0.6, bw, bh, bh / 2); ctx.fillStyle = c.A; ctx.fill();
    text(ctx, sc.L.off(off), x + w - bw / 2 - pad * 0.6, y + pad * 0.6 + bh / 2, { size: 34 * u, color: readable(c.A, '#ffffff', c.ink), maxWidth: bw - 12 * u });
  }
  ctx.restore();
  const tw = w - pad * 2;
  const tx = x + w / 2;
  text(ctx, p.name, tx, y + imgH + h * 0.11, { size: 46 * u, color: c.ink, maxWidth: tw, maxLines: 2, alpha, minSize: 12 });
  if (p.weight) text(ctx, p.weight, tx, y + imgH + h * 0.225, { size: 32 * u, weight: 'regular', color: c.gray, maxWidth: tw, alpha });
  const priceY = y + h - h * 0.12;
  const priceCol = readable(c.white, c.P, c.A, c.ink);
  if (off > 0) {
    text(ctx, inr(p.mrp), tx - tw * 0.24, priceY, { size: 38 * u, weight: 'bold', color: c.gray, maxWidth: tw * 0.42, alpha, strike: true });
    text(ctx, inr(p.price), tx + tw * 0.2, priceY, { size: 62 * u, color: priceCol, maxWidth: tw * 0.55, alpha });
  } else {
    text(ctx, inr(p.price), tx, priceY, { size: 62 * u, color: priceCol, maxWidth: tw, alpha });
  }
}

function productsGrid(sc: SceneCtx, t: number, dur: number, title: string, sub: string) {
  const { st, o, c } = sc;
  const { ctx, W, Y, S } = st;
  const k = z(dur, 5);
  const list = o.featuredProducts.slice(0, 4);
  text(ctx, title, W / 2, Y(250), { size: S(104), shadow: true, color: c.onBright, outline: true, alpha: easeOut(prog(t, 0, 0.4)), maxWidth: W - 120 });
  if (sub) text(ctx, sub, W / 2, Y(370), { size: S(50), weight: 'bold', color: c.onBright, outline: true, alpha: easeOut(prog(t, 0.15, 0.4)), maxWidth: W - 140 });
  const n = list.length;
  if (!n) return;
  // square: 4 products as 2×2 (bigger cards), 2–3 in one row; reel: 2 columns
  const cols = st.square ? (n === 4 ? 2 : n) : n === 1 ? 1 : 2;
  const rows = Math.ceil(n / cols);
  const gap = S(36);
  const top = Y(470), bottom = Y(1800);
  const areaW = W - 120;
  let cw = (areaW - (cols - 1) * gap) / cols;
  let ch = Math.min((bottom - top - (rows - 1) * gap) / rows, cw * 1.45);
  if (n === 1) { cw = Math.min(cw, ch / 1.2); ch = Math.min(ch, cw * 1.35); }
  const gridW = cols * cw + (cols - 1) * gap;
  const gridH = rows * ch + (rows - 1) * gap;
  const x0 = (W - gridW) / 2;
  const y0 = top + (bottom - top - gridH) / 2;
  list.forEach((p, i) => {
    const r = Math.floor(i / cols), col = i % cols;
    const a = back(prog(t, (0.4 + i * 0.45) * k, 0.55 * k));
    // centre an incomplete last row (e.g. 3 products → 2 + 1)
    const inRow = Math.min(cols, n - r * cols);
    const rowX0 = x0 + ((cols - inRow) * (cw + gap)) / 2;
    const x = rowX0 + col * (cw + gap), y = y0 + r * (ch + gap);
    scaled(ctx, x + cw / 2, y + ch / 2, a, () => productCard(sc, p, -cw / 2, -ch / 2, cw, ch, clamp(a)));
  });
}

function sceneFestProducts(sc: SceneCtx, t: number, dur: number) {
  brightBg(sc, t, sc.c.P, sc.c.S);
  sparkles(sc.st, t, sc.c.A, 0.5);
  productsGrid(sc, t, dur, sc.L.festSpecial(sc.o.festivalName || 'Festival'), sc.L.festSpecialSub);
}

// =====================================================================
// DAILY (deal of the day)
// =====================================================================
function sceneDailyIntro(sc: SceneCtx, t: number, dur: number) {
  const { st, o, c } = sc;
  const { ctx, W, Y, S } = st;
  const k = z(dur, 4);
  brightBg(sc, t);
  emojiRain(st, t, 0.35);
  const p1 = back(prog(t, 0.1 * k, 0.6 * k));
  scaled(ctx, W / 2, Y(560), p1, () => emoji(ctx, '🔥', 0, 0, S(260)));
  const a = easeOut(prog(t, 0.6 * k, 0.5 * k));
  // greeting may wrap to 2 lines; the pill below is placed from the measured block height
  const gh = text(ctx, o.greeting || sc.L.dailyTitle, W / 2, Y(880) + (1 - a) * S(50), { size: S(140), alpha: a, shadow: true, color: c.onBright, outline: true, maxWidth: W - 120, maxLines: 2, maxHeight: Y(1140) - S(110) - (Y(560) + S(150)) });
  const pillY = Math.max(Y(1140), Y(880) + gh / 2 + S(110));
  const b = easeOut(prog(t, 1.1 * k, 0.5 * k));
  ctx.save(); ctx.globalAlpha = b;
  roundRect(ctx, W / 2 - S(330), pillY - S(55), S(660), S(110), S(55)); ctx.fillStyle = c.white; ctx.fill();
  ctx.restore();
  text(ctx, sc.L.dealOfDay, W / 2, pillY, { size: S(58), alpha: b, color: readable(c.white, c.P, c.ink), maxWidth: S(600) });
  const d = easeOut(prog(t, 1.5 * k, 0.5 * k));
  const date = new Date().toLocaleDateString(sc.L.dateLocale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });
  text(ctx, `📅 ${date}`, W / 2, Y(1300), { size: S(52), weight: 'bold', alpha: d, color: c.onBright, outline: true, maxWidth: W - 140 });
  text(ctx, o.subText || sc.L.dailySub(o.store.name), W / 2, Y(1440), { size: S(46), weight: 'bold', alpha: d, color: c.onBright, outline: true, maxWidth: W - 160, maxLines: 2 });
}

function sceneDailyDeals(sc: SceneCtx, t: number, dur: number) {
  brightBg(sc, t, sc.c.P, mix(sc.c.P, sc.c.A, 0.6));
  emojiRain(sc.st, t, 0.15);
  productsGrid(sc, t, dur, sc.L.dealsTitle, sc.L.dealsSub);
}

// =====================================================================
// Timelines
// =====================================================================
type Weighted = [SceneFn, number];

function templateScenes(o: RenderOptions): Weighted[] {
  const hasProducts = o.featuredProducts.length > 0;
  const hasOffer = !!(o.offerText || o.couponCode);
  if (o.template === 'festival') {
    return [
      [sceneFestIntro, 4.5], [sceneFestWishes, 4],
      ...(hasOffer ? ([[sceneOffer, 4.5]] as Weighted[]) : []),
      ...(hasProducts ? ([[sceneFestProducts, 5]] as Weighted[]) : []),
      [sceneCTA, 6],
    ];
  }
  if (o.template === 'daily') {
    return [
      [sceneDailyIntro, 4],
      ...(hasProducts ? ([[sceneDailyDeals, 8]] as Weighted[]) : ([[sceneFeatures, 5.5]] as Weighted[])),
      ...(hasOffer ? ([[sceneOffer, 4.5]] as Weighted[]) : []),
      [sceneCTA, 6],
    ];
  }
  // general = original render.js order and timing (0-4, 4-8, 8-13.5, 13.5-18, 18-24)
  return [[sceneIntro, 4], [sceneHook, 4], [sceneFeatures, 5.5], [sceneSteps, 4.5], [sceneCTA, 6]];
}

export type Timeline = [start: number, end: number, fn: SceneFn][];

/** Scene weights scaled to the requested duration (15 / 24 / 30 s). */
export function buildTimeline(o: RenderOptions): Timeline {
  const list = templateScenes(o);
  const total = list.reduce((s, [, w]) => s + w, 0);
  let at = 0;
  return list.map(([fn, w]) => {
    const len = (w / total) * o.durationSec;
    const seg: [number, number, SceneFn] = [at, at + len, fn];
    at += len;
    return seg;
  });
}

const FADE = 0.35; // crossfade seconds (original)

/** Original drawFrame(): scene crossfades + final fade to the primary colour. */
export function drawFrame(sc: SceneCtx, timeline: Timeline, t: number) {
  const { ctx, W, H } = sc.st;
  ctx.clearRect(0, 0, W, H);
  for (let i = 0; i < timeline.length; i++) {
    const [s, e, fn] = timeline[i];
    if (t < s - FADE || t >= e) continue;
    ctx.save();
    if (i > 0 && t < s) ctx.globalAlpha = 0;
    if (i > 0 && t >= s && t < s + FADE) ctx.globalAlpha = easeInOut((t - s) / FADE);
    fn(sc, Math.max(0, t - s), e - s);
    ctx.restore();
  }
  const end = prog(t, sc.o.durationSec - 0.4, 0.4);
  if (end > 0) {
    ctx.save();
    ctx.globalAlpha = end;
    ctx.fillStyle = sc.c.P;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

/** Good still-frame times for previews: the middle-late part of each scene. */
export function previewTimes(timeline: Timeline, max = 4): number[] {
  const picks = timeline.map(([s, e]) => s + (e - s) * 0.8);
  if (picks.length <= max) return picks;
  // keep first, last and evenly spaced middle scenes
  const out: number[] = [];
  for (let i = 0; i < max; i++) out.push(picks[Math.round((i * (picks.length - 1)) / (max - 1))]);
  return out;
}
