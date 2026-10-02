// Shared public origins for crawler/share routes (OG share HTML + sitemap/robots).
// Lifted out of routes/og.ts so routes/og.ts and routes/seo.ts agree on the exact
// same values. All meta/sitemap URLs are absolute https.

// Public site origin (the SPA + where share links point).
export const SITE_ORIGIN = (process.env.PUBLIC_SITE_URL || 'https://4astore.com').replace(/\/+$/, '');
// Public API origin (serves the OG images + share HTML).
export const API_ORIGIN = (process.env.PUBLIC_API_URL || `${SITE_ORIGIN}/api`).replace(/\/+$/, '');
