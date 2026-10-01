/**
 * Seeds the `pages` table from the original static legal pages
 * (scripts/legal-seed/*.html — made by copy-legal-pages.ps1 from the live site's pages).
 *
 * Existing pages are NOT overwritten (admin edits are kept) unless --force is passed.
 *
 * Usage (from api-node/):  npx ts-node --transpile-only scripts/import-legal-pages.ts [--force]
 */
import fs from 'fs';
import path from 'path';
import { prisma } from '../src/db';

const SRC = path.join(__dirname, 'legal-seed');
const PAGES = [
  { slug: 'privacy-policy', file: 'privacy-policy.html', sort: 1 },
  { slug: 'terms', file: 'terms.html', sort: 2 },
  { slug: 'help-support', file: 'help-support.html', sort: 3 },
  { slug: 'account-deletion', file: 'account-deletion.html', sort: 4 },
];
const force = process.argv.includes('--force');

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function extract(html: string) {
  const title = decode((/<title>([^<]*)<\/title>/i.exec(html)?.[1] || '').replace(/\s*-\s*4A Store\s*$/i, '').trim());
  const meta = decode(/<meta name="description" content="([^"]*)"/i.exec(html)?.[1] || '');
  // Everything inside .legal-wrap (it is closed right before the footer-bottom bar).
  const wrap = /<div class="legal-wrap">([\s\S]*)<\/div>\s*<div class="footer-bottom"/i.exec(html)?.[1] || '';
  const content = wrap
    .replace(/<a [^>]*class="legal-back"[^>]*>[\s\S]*?<\/a>/gi, '') // back/next links come from the page template
    .replace(/\/legacy-pages\/([a-z0-9-]+)\.html/gi, '/page/$1') // links between legal pages → CMS routes
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, meta, content };
}

async function main() {
  for (const p of PAGES) {
    const file = path.join(SRC, p.file);
    if (!fs.existsSync(file)) {
      console.log(`skip ${p.slug}: ${file} missing`);
      continue;
    }
    const { title, meta, content } = extract(fs.readFileSync(file, 'utf8'));
    if (!content) throw new Error(`Could not extract content from ${p.file}`);
    const sql = force
      ? `INSERT INTO pages (slug, title, meta_description, content, show_in_footer, published, sort_order) VALUES (?, ?, ?, ?, 1, 1, ?)
         ON DUPLICATE KEY UPDATE title=VALUES(title), meta_description=VALUES(meta_description), content=VALUES(content), sort_order=VALUES(sort_order)`
      : `INSERT IGNORE INTO pages (slug, title, meta_description, content, show_in_footer, published, sort_order) VALUES (?, ?, ?, ?, 1, 1, ?)`;
    const n = await prisma.$executeRawUnsafe(sql, p.slug, title, meta, content, p.sort);
    console.log(`${p.slug}: ${n ? 'saved' : 'already exists (kept)'} — "${title}", ${content.length} chars`);
  }
}

main()
  .catch((e) => {
    console.error('Import failed:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
