/**
 * Seeds the `festivals` table from data/festivals.seed.json.
 * Existing rows are kept (admin edits win) unless --force is passed.
 * Every seeded date is marked unverified (date_verified = 0).
 *
 * Usage (from api-node/):  npx ts-node --transpile-only scripts/seed-festivals.ts [--force]
 */
import fs from 'fs';
import path from 'path';
import { prisma } from '../src/db';

interface SeedFestival {
  id: string; name: string; date: string | null; greeting: string; subText: string;
  emojis: string[]; colors: Record<string, string>; musicStyle: string; defaultOffer: string;
}

async function main() {
  const file = path.join(__dirname, '..', 'data', 'festivals.seed.json');
  const { festivals } = JSON.parse(fs.readFileSync(file, 'utf8')) as { festivals: SeedFestival[] };
  const force = process.argv.includes('--force');
  let saved = 0;
  for (const f of festivals) {
    const n = await prisma.$executeRawUnsafe(
      `${force ? 'REPLACE' : 'INSERT IGNORE'} INTO festivals
         (id, name, date, date_verified, greeting, sub_text, emojis, colors, music_style, default_offer, active)
       VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 1)`,
      f.id, f.name, f.date, f.greeting, f.subText, JSON.stringify(f.emojis), JSON.stringify(f.colors), f.musicStyle, f.defaultOffer
    );
    if (n) saved++;
  }
  console.log(`Festivals: ${saved} saved, ${festivals.length - saved} already existed (kept).`);

  // Hindi / English text (data/festivals.i18n.json) — only fills rows that have none yet.
  const i18nFile = path.join(__dirname, '..', 'data', 'festivals.i18n.json');
  if (fs.existsSync(i18nFile)) {
    const { translations } = JSON.parse(fs.readFileSync(i18nFile, 'utf8')) as { translations: Record<string, unknown> };
    let n = 0;
    for (const [id, tr] of Object.entries(translations)) {
      n += await prisma.$executeRawUnsafe(
        `UPDATE festivals SET translations = ? WHERE id = ?${force ? '' : ' AND (translations IS NULL OR translations = \'{}\')'}`,
        JSON.stringify(tr), id
      );
    }
    console.log(`Translations: ${n} festivals updated.`);
  }
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
