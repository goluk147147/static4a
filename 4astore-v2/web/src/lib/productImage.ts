// Ports of the original app.js getProductImage() / getProductImageSrc().

interface ImgProduct {
  id: number;
  name: string;
  category?: string;
  weight?: string;
  image?: string;
}

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

const xml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

/** Generated SVG placeholder: emoji + product name/weight on the category's colours. */
export function productPlaceholder(p: ImgProduct): string {
  const nameLower = p.name.toLowerCase();
  const emoji = PRODUCT_EMOJIS.find(([key]) => nameLower.includes(key))?.[1] ?? '📦';
  const style = CAT_STYLES[p.category || ''] || { bg: '#f5f5f5', color: '#424242', accent: '#e0e0e0' };
  const shortName = p.name.length > 18 ? p.name.substring(0, 18) + '…' : p.name;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
    <defs><linearGradient id="bg${p.id}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${style.bg}"/><stop offset="100%" style="stop-color:${style.accent}"/>
    </linearGradient></defs>
    <rect width="200" height="200" fill="url(#bg${p.id})" rx="16"/>
    <circle cx="100" cy="78" r="40" fill="white" opacity="0.6"/>
    <text x="100" y="93" text-anchor="middle" font-size="44">${emoji}</text>
    <rect x="20" y="130" width="160" height="50" fill="white" opacity="0.7" rx="8"/>
    <text x="100" y="150" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" font-weight="bold" fill="${style.color}">${xml(shortName)}</text>
    <text x="100" y="168" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" fill="#666">${xml(p.weight || '')}</text>
  </svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

/** Remote images go through the API image proxy; empty/unknown → generated placeholder. */
export function productImageSrc(p: ImgProduct): string {
  const url = String(p.image || '').trim();
  if (!url) return productPlaceholder(p);
  if (/^https?:/i.test(url)) return '/api/img-proxy?url=' + encodeURIComponent(url);
  if (/^(data:|blob:)/i.test(url) || url.startsWith('/')) return url;
  if (url.startsWith('./') || url.startsWith('../')) return url;
  return productPlaceholder(p);
}

/** onError handler: swap a broken image for the placeholder exactly once. */
export function onProductImageError(p: ImgProduct) {
  return (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.dataset.fallback === '1') return;
    img.dataset.fallback = '1';
    img.src = productPlaceholder(p);
  };
}
