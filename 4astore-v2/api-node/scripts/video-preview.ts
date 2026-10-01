/**
 * Dev helper: writes preview PNGs for every template in both formats, plus a long-text
 * stress case, to media/preview-check/. Usage (from api-node/):
 *   npx ts-node --transpile-only scripts/video-preview.ts
 */
import '../src/systemCa';
import fs from 'fs';
import path from 'path';
import { prisma } from '../src/db';
import { buildOptions, videoRequestSchema } from '../src/video/options';
import { renderPreviews } from '../src/video/render';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const OUT = path.join(process.cwd(), 'media', 'preview-check');

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const ids = (await prisma.product.findMany({ where: { in_stock: true }, take: 4, orderBy: { id: 'asc' } })).map((p) => Number(p.id));
  const cases: Record<string, unknown> = {
    general: { template: 'general' },
    diwali: { template: 'festival', festivalId: 'diwali', couponCode: 'DIWALI50', productIds: ids },
    daily: { template: 'daily', offerText: 'Aaj ₹999+ ke order par 5% extra chhoot' },
    diwali_hindi: { template: 'festival', festivalId: 'diwali', couponCode: 'DIWALI50', productIds: ids, lang: 'hindi' },
    daily_hindi: { template: 'daily', lang: 'hindi', offerText: 'आज ₹999+ के ऑर्डर पर 5% अतिरिक्त छूट' },
    general_hindi: { template: 'general', lang: 'hindi' },
    diwali_english: { template: 'festival', festivalId: 'diwali', couponCode: 'DIWALI50', productIds: ids, lang: 'english' },
    daily_english: { template: 'daily', lang: 'english' },
    general_english: { template: 'general', lang: 'english' },
    stress: {
      template: 'festival', festivalId: 'chhath-puja', productIds: ids.slice(0, 3),
      greeting: 'Chhath Mahaparv ki aap sabhi ko bahut bahut hardik Shubhkamnayein aur badhai',
      subText: 'Chhathi Maiya aapke parivaar ko sukh, samriddhi, swasthya aur khushiyon se bhar dein — jai Chhathi Maiya',
      offerText: 'Thekua ka saaman, soop, daura, fal aur pooja saamagri par pure hafte special daam, jaldi karein!',
      couponCode: 'CHHATH2026SPECIAL',
    },
  };
  for (const [name, input] of Object.entries(cases)) {
    for (const format of ['reel', 'square'] as const) {
      const opts = await buildOptions(videoRequestSchema.parse(input), format);
      const shots = await renderPreviews(opts, 8); // every scene
      // one contact sheet per case/format (frames side by side, scaled down)
      const imgs = await Promise.all(shots.map((s) => loadImage(s.png)));
      const gap = 12;
      // keep sheets under 2000px on both sides (vision APIs reject larger images in multi-image chats)
      const MAX_SIDE = 1990;
      const scale = Math.min(
        format === 'reel' ? 0.3 : 0.4,
        (MAX_SIDE - gap * (imgs.length + 1)) / (imgs.length * imgs[0].width),
        (MAX_SIDE - gap * 2) / imgs[0].height,
      );
      const w = Math.floor(imgs[0].width * scale), h = Math.floor(imgs[0].height * scale);
      const sheet = createCanvas(imgs.length * (w + gap) + gap, h + gap * 2);
      const sx = sheet.getContext('2d');
      sx.fillStyle = '#444';
      sx.fillRect(0, 0, sheet.width, sheet.height);
      imgs.forEach((im, i) => sx.drawImage(im, gap + i * (w + gap), gap, w, h));
      fs.writeFileSync(path.join(OUT, `${name}_${format}_sheet.png`), sheet.toBuffer('image/png'));
      shots.forEach((s, i) => fs.writeFileSync(path.join(OUT, `${name}_${format}_${i + 1}.png`), s.png));
      console.log(`${name} ${format}: ${shots.length} frames at ${shots.map((s) => s.t + 's').join(', ')}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
