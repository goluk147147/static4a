import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra || {}) as {
  apiBase?: string;
  siteUrl?: string;
  hasPush?: boolean;
  googleClientId?: string;
  facebookAppId?: string;
  instagramAppId?: string;
  googleWebClientId?: string;
  googleAndroidClientId?: string;
};

export const API_BASE = (extra.apiBase || 'https://4astore.com/api').replace(/\/$/, '');
export const SITE_URL = (extra.siteUrl || 'https://4astore.com').replace(/\/$/, '');
export const HAS_PUSH = !!extra.hasPush;

// Social-login OAuth client IDs (empty = provider not yet provisioned).
export const GOOGLE_CLIENT_ID = extra.googleClientId || '';
export const FACEBOOK_APP_ID = extra.facebookAppId || '';
export const INSTAGRAM_APP_ID = extra.instagramAppId || '';

// Google Sign-In (@react-native-google-signin/google-signin) client IDs — web ID drives the
// id_token flow, android ID matches the signed build. Empty = Google not provisioned → the button
// stays on its setup toast.
export const GOOGLE_WEB_CLIENT_ID = extra.googleWebClientId || '';
export const GOOGLE_ANDROID_CLIENT_ID = extra.googleAndroidClientId || '';

export const STORE_PHONE_DEFAULT = '7543888698';
export const STORE_WHATSAPP_DEFAULT = '8210874123';
export const STORE_ADDRESS_DEFAULT = 'Gajana Road, Chandargarh, Nabinagar, Bihar - 824301';
export const DEFAULT_UPI_ID = 'Q623952089@ybl';

/** Relative asset path from the DB ("data/banners/x.webp", "/api/uploads/...") → absolute URL. */
export function absoluteUrl(src?: string | null): string {
  const s = String(src || '').trim();
  if (!s) return '';
  if (/^(https?:|data:|file:)/i.test(s)) return s;
  return `${SITE_URL}/${s.replace(/^\.?\//, '')}`;
}
