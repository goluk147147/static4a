/**
 * One-off importer: copies the ORIGINAL 4AStore catalogue from ../../data/*.json
 * (products, categories, homepage config, settings, announcement) into MySQL.
 *
 * Runs through Prisma/Node so Hindi text and emoji stay intact (no shell pipes).
 * Users and orders are NOT imported (passwords/order history need a separate,
 * reviewed migration).
 *
 * All upsert logic lives in ../src/services/dataImport (shared with the owner-only
 * admin route POST /api/admin/data/import) — ONE source of truth, zero duplication.
 *
 * Usage (from api-node/):  npx ts-node --transpile-only scripts/import-legacy-json.ts [path-to-data-dir]
 *   --only=ads   import just the admin poster library
 */
import path from 'path';
import { prisma } from '../src/db';
import { runImport, importAdCreatives, DEFAULT_DATA_DIR } from '../src/services/dataImport';

// Optional positional arg: a custom data dir. Default = repo-root data/.
const dirArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const dataDir = dirArg ? path.resolve(dirArg) : DEFAULT_DATA_DIR;

async function main() {
  if (process.argv.includes('--only=ads')) {
    console.log(`Imported ad creatives: ${await importAdCreatives(dataDir)}`);
    return;
  }
  console.log(`Importing from ${dataDir}`);
  const r = await runImport(dataDir);
  console.log(`Done: categories=${r.categories} products=${r.products} banners=${r.banners} ads=${r.ads} (+ settings, announcement)`);
}

main()
  .catch((e) => {
    console.error('Import failed:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
