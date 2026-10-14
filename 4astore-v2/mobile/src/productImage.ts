import { API_BASE, absoluteUrl } from './config';

// Ports of the web getProductImage() placeholder data (emoji + category colours).
const PRODUCT_EMOJIS: [string, string][] = [
  ['atta', '🌾'], ['rice', '🍚'], ['mustard oil', '🫒'], ['sunflower oil', '🌻'],
  ['salt', '🧂'], ['tea', '🍵'], ['coffee', '☕'], ['maggi', '🍜'], ['noodle', '🍜'],
  ['surf', '🧺'], ['vim', '🧽'], ['dettol', '🧼'], ['soap', '🧼'], ['banana', '🍌'],
  ['apple', '🍎'], ['mango', '🥭'], ['orange', '🍊'], ['papaya', '🍈'],
  ['potato', '🥔'], ['onion', '🧅'], ['tomato', '🍅'], ['cauliflower', '🥦'],
  ['chilli', '🌶️'], ['biscuit', '🍪'], ['parle', '🍪'], ['britannia', '🍪'],
  ['lays', '🥔'], ['chips', '🥔'], ['kurkure', '🥨'], ['bhujia', '🥨'],
  ['milk', '🥛'], ['butter', '🧈'], ['cheese', '🧀'], ['curd', '🥛'],
  ['bread', '🍞'], ['cola', '🥤'], ['coca', '🥤'], ['pepsi', '🥤'], ['sprite', '🥤'],
  ['frooti', '🧃'], ['water', '💧'], ['colgate', '🪥'], ['shampoo', '🧴'],
  ['dove', '🧼'], ['harpic', '🚽'], ['lizol', '🧹'], ['dal', '🫘'],
  ['sugar', '🍬'], ['masala', '🌶️'], ['turmeric', '💛'], ['ghee', '🫕'],
  ['diaper', '👶'], ['pampers', '👶'], ['johnson', '👶'], ['baby', '👶'],
  ['notebook', '📓'], ['pen', '🖊️'], ['mustard seed', '🟡'],
];

const CAT_STYLES: Record<string, { bg: string; color: string; accent: string }> = {
  'fruits-vegetables': { bg: '#e8f5e9', color: '#2e7d32', accent: '#a5d6a7' },
  'rice-atta-dal': { bg: '#fff8e1', color: '#e65100', accent: '#ffe082' },
  'oil-ghee': { bg: '#fff3e0', color: '#e65100', accent: '#ffcc80' },
  'biscuits-snacks': { bg: '#fce4ec', color: '#c62828', accent: '#f48fb1' },
  'tea-coffee': { bg: '#efebe9', color: '#4e342e', accent: '#bcaaa4' },
  'cold-drinks-beverages': { bg: '#e3f2fd', color: '#1565c0', accent: '#90caf9' },
  'dairy-bakery': { bg: '#f3e5f5', color: '#6a1b9a', accent: '#ce93d8' },
  'personal-care': { bg: '#e8eaf6', color: '#283593', accent: '#9fa8da' },
  'home-cleaning': { bg: '#e0f7fa', color: '#00695c', accent: '#80deea' },
  'baby-care': { bg: '#fce4ec', color: '#ad1457', accent: '#f48fb1' },
  stationery: { bg: '#e8eaf6', color: '#1a237e', accent: '#9fa8da' },
  'daily-essentials': { bg: '#f1f8e9', color: '#33691e', accent: '#aed581' },
};

export function placeholderStyle(name: string, category?: string) {
  const lower = name.toLowerCase();
  const emoji = PRODUCT_EMOJIS.find(([k]) => lower.includes(k))?.[1] ?? '📦';
  const style = CAT_STYLES[category || ''] || { bg: '#f5f5f5', color: '#424242', accent: '#e0e0e0' };
  return { emoji, ...style };
}

/**
 * https → direct; http (blocked by Android cleartext policy) → API image proxy; relative → site URL.
 * When `version` is supplied and the resolved uri is non-empty, append a `v=` cache-bust param
 * (numeric when `version` is a date string, else the value as-is) so a changed image re-fetches.
 */
export function productImageUri(image?: string | null, version?: string | number): string {
  const url = String(image || '').trim();
  if (!url) return '';
  const uri = /^http:/i.test(url) ? `${API_BASE}/img-proxy?url=${encodeURIComponent(url)}` : absoluteUrl(url);
  if (!uri || version === undefined || version === null || version === '') return uri;
  const sep = uri.includes('?') ? '&' : '?';
  let v: string | number = version;
  if (typeof version === 'string') {
    const t = Date.parse(version);
    v = Number.isNaN(t) ? version : t;
  }
  return `${uri}${sep}v=${encodeURIComponent(String(v))}`;
}
