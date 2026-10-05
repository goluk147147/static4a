import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra || {}) as { apiBase?: string; siteUrl?: string; hasPush?: boolean };

export const API_BASE = (extra.apiBase || 'https://4astore.com/api').replace(/\/$/, '');
export const SITE_URL = (extra.siteUrl || 'https://4astore.com').replace(/\/$/, '');
export const HAS_PUSH = !!extra.hasPush;

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
