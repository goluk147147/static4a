// Shared feature-flag keys + a tiny accessor, mirroring the API's
// src/utils/features.ts and the web src/lib/features.ts so the server, web and
// mobile all agree on the known keys and the "absent = ON" default.
//
// A flag is ON unless the server explicitly stored it as `false`, so a brand-new
// feature ships ON even before the admin ever touches it and before the API
// serves a `features` object at all (older API without the column).
//
// Flag keys (document for the admin Features UI):
//   socialProof       — storefront social-proof home popup / toast
//   productZoom       — pinch/zoom affordance on the product details image
//   productRotate     — rotate control (0/90/180/270) on the product details image
//   animatedBanners   — animated gradient home banners
//   bulkPushEnabled   — admin bulk-push / broadcast composer (web)
//   ogShareImages     — server-rendered OG share images + meta for links
//   webLocalCache     — localStorage persistence of the web React-Query cache
import { useConfig } from './queries';

export type FeatureKey =
  | 'socialProof'
  | 'productZoom'
  | 'productRotate'
  | 'animatedBanners'
  | 'bulkPushEnabled'
  | 'ogShareImages'
  | 'webLocalCache';

export const FEATURE_KEYS: FeatureKey[] = [
  'socialProof',
  'productZoom',
  'productRotate',
  'animatedBanners',
  'bulkPushEnabled',
  'ogShareImages',
  'webLocalCache',
];

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

/**
 * Hook: read a feature flag straight from the shared `config` query. Returns the
 * default (ON) while config is still loading or when the API has no `features`.
 */
export function useFeature(key: FeatureKey, def = true): boolean {
  const features = useConfig().data?.features;
  return isFeatureOn(features, key, def);
}
