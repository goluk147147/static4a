// Shared feature-flag keys + a tiny accessor, mirroring the API's
// src/utils/features.ts so the web storefront and admin agree on the known keys
// and the "absent = ON" default. A flag is ON unless the server explicitly
// stored it as `false`, so a brand-new feature ships ON even before the admin
// ever touches it and before the API serves a `features` object (older API).
//
// Flag keys (document for the admin Features UI):
//   socialProof       — storefront social-proof / announcement popup
//   productZoom       — pinch/zoom affordance on the product details image
//   productRotate     — rotate control on the product details image
//   animatedBanners   — animated (auto-sliding) home banners
//   bulkPushEnabled   — admin bulk-push / broadcast composer
//   ogShareImages     — server-rendered OG share images + meta for links
//   webLocalCache     — localStorage persistence of the web React-Query cache
//   seoModule         — extra schema.org JSON-LD (Product/LocalBusiness/Organization)

export type FeatureKey =
  | 'socialProof'
  | 'productZoom'
  | 'productRotate'
  | 'animatedBanners'
  | 'bulkPushEnabled'
  | 'ogShareImages'
  | 'webLocalCache'
  | 'seoModule';

export const FEATURE_KEYS: FeatureKey[] = [
  'socialProof',
  'productZoom',
  'productRotate',
  'animatedBanners',
  'bulkPushEnabled',
  'ogShareImages',
  'webLocalCache',
  'seoModule',
];

/** Bilingual (Hindi/English) labels for the admin Features toggles UI. */
export const FEATURE_LABELS: Record<FeatureKey, string> = {
  socialProof: 'Social proof popups / सोशल प्रूफ पॉपअप',
  productZoom: 'Product zoom / प्रोडक्ट ज़ूम',
  productRotate: 'Product rotate / प्रोडक्ट घुमाएँ',
  animatedBanners: 'Animated banners / एनिमेटेड बैनर',
  bulkPushEnabled: 'Bulk push / बल्क पुश',
  ogShareImages: 'OG share images / शेयर इमेज',
  webLocalCache: 'Web local cache / वेब लोकल कैश',
  seoModule: 'SEO module / एसईओ मॉड्यूल',
};

/**
 * Read a single flag from a (possibly undefined) features map. A key is only OFF
 * when it is explicitly `false`; anything else (missing map, missing key, older
 * API without `features`) returns the provided default (ON by default).
 */
export function isFeatureOn(
  features: Record<string, boolean> | undefined,
  key: FeatureKey,
  def = true,
): boolean {
  if (!features || typeof features !== 'object') return def;
  const v = features[key];
  if (v === false) return false;
  if (v === true) return true;
  return def;
}
