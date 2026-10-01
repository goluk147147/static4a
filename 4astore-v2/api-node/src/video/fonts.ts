import fs from 'fs';
import path from 'path';
import { GlobalFonts } from '@napi-rs/canvas';

// Fonts are bundled in api-node/assets/fonts (SIL Open Font License) so rendering
// works the same on Windows (dev) and Linux (server) — no system fonts needed.
export const FONT_DIR = process.env.VIDEO_FONT_DIR || path.join(__dirname, '..', '..', 'assets', 'fonts');

const FONTS: [file: string, family: string][] = [
  ['NotoSans-Black.ttf', 'VHeavy'],
  ['NotoSans-Bold.ttf', 'VBold'],
  ['NotoSans-Regular.ttf', 'VRegular'],
  ['NotoSansDevanagari-Bold.ttf', 'VDevaBold'],
  ['NotoSansDevanagari-Regular.ttf', 'VDeva'],
  ['NotoColorEmoji-Regular.ttf', 'VEmoji'],
];

let registered = false;

/** Registers the bundled fonts once; throws a clear error if a file is missing. */
export function ensureFonts(): void {
  if (registered) return;
  const missing = FONTS.filter(([f]) => !fs.existsSync(path.join(FONT_DIR, f))).map(([f]) => f);
  if (missing.length) throw new Error(`Video fonts missing in ${FONT_DIR}: ${missing.join(', ')}`);
  for (const [file, family] of FONTS) {
    if (!GlobalFonts.registerFromPath(path.join(FONT_DIR, file), family)) throw new Error(`Font could not be loaded: ${file}`);
  }
  registered = true;
}

export type Weight = 'heavy' | 'bold' | 'regular';
const STACK: Record<Weight, string> = {
  heavy: 'VHeavy, VDevaBold, VEmoji',
  bold: 'VBold, VDevaBold, VEmoji',
  regular: 'VRegular, VDeva, VEmoji',
};

/** Canvas font string; Latin → Devanagari → emoji fallback chain. */
export const font = (size: number, weight: Weight = 'heavy') => `${Math.round(size)}px ${STACK[weight]}`;
export const emojiFont = (size: number) => `${Math.round(size)}px VEmoji`;
