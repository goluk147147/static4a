// Shared feature-flag defaults so the server, web and mobile all agree on the
// known keys and the "absent = ON" default. A flag is ON unless it is explicitly
// stored as `false`, so a brand-new feature ships ON even before the admin ever
// touches it and before the `features` column exists on the live DB.
//
// Flag keys (document for admin UI + clients):
//   socialProof       — storefront social-proof popups ("X ne abhi {product} khareeda")
//   productZoom       — pinch/zoom affordance on the product details image
//   productRotate     — rotate control (0/90/180/270) on the product details image
//   animatedBanners   — animated gradient home banners
//   bulkPushEnabled   — admin bulk-push / broadcast composer
//   ogShareImages     — server-rendered OG share images + meta for links
//   webLocalCache     — localStorage persistence of the web React-Query cache
//   seoModule         — SEO meta/JSON-LD on storefront pages + admin SEO tab
//                       (sitemap.xml / robots.txt are NEVER gated by this flag)
//   seoAuto           — master kill-switch for the AUTOMATIC SEO engine (create/update
//                       hook, import audit enqueue, 15-min cron). Normal "absent = ON".
//   seoAutoGsc        — PHASE-2 Google Search Console data import (default OFF)
//   seoAutoGa4        — PHASE-2 Google Analytics 4 data import (default OFF)
//   seoAutoGbp        — PHASE-2 Google Business Profile sync (default OFF)
//   seoAutoCrawler    — PHASE-2 daily technical crawler checks (default OFF)

export type FeatureKey =
  | 'socialProof'
  | 'productZoom'
  | 'productRotate'
  | 'animatedBanners'
  | 'bulkPushEnabled'
  | 'ogShareImages'
  | 'webLocalCache'
  | 'seoModule'
  | 'seoAuto'
  | 'seoAutoGsc'
  | 'seoAutoGa4'
  | 'seoAutoGbp'
  | 'seoAutoCrawler';

export const FEATURE_KEYS: FeatureKey[] = [
  'socialProof',
  'productZoom',
  'productRotate',
  'animatedBanners',
  'bulkPushEnabled',
  'ogShareImages',
  'webLocalCache',
  'seoModule',
  'seoAuto',
  'seoAutoGsc',
  'seoAutoGa4',
  'seoAutoGbp',
  'seoAutoCrawler',
];

export type Features = Record<FeatureKey, boolean>;

// Every known flag defaults to ON, EXCEPT the PHASE-2 seoAuto* keys below.
export const DEFAULT_FEATURES: Features = {
  socialProof: true,
  productZoom: true,
  productRotate: true,
  animatedBanners: true,
  bulkPushEnabled: true,
  ogShareImages: true,
  webLocalCache: true,
  seoModule: true,
  // Master kill-switch for the automatic SEO engine: ships ON (absent = ON, like the
  // other keys). Flip it to a stored `false` to halt all automation without a redeploy.
  seoAuto: true,
  // PHASE-2 keys INVERT the "absent = ON" convention — they default OFF so the
  // integrations/crawler stay dark until an admin explicitly stores `true`. mergeFeatures
  // is unchanged: it seeds from DEFAULT_FEATURES, so a never-stored key keeps this `false`.
  seoAutoGsc: false,
  seoAutoGa4: false,
  seoAutoGbp: false,
  seoAutoCrawler: false,
};

/**
 * Merge a raw stored flag map (parsed JSON, possibly null/garbage) onto the
 * defaults. A key is only turned OFF when it is explicitly stored as `false`;
 * anything else (missing, null, non-boolean) stays at the default-ON value.
 */
export function mergeFeatures(raw: unknown): Features {
  const out: Features = { ...DEFAULT_FEATURES };
  if (raw && typeof raw === 'object') {
    const map = raw as Record<string, unknown>;
    for (const key of FEATURE_KEYS) {
      if (map[key] === false) out[key] = false;
      else if (map[key] === true) out[key] = true;
    }
  }
  return out;
}
