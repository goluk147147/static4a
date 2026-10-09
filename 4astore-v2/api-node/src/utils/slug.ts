// Shared URL-safe slug helper. Extracted verbatim from the former local `slugify`
// in routes/admin.ts so the admin category route and the SEO engine (seo/generate.ts)
// produce byte-identical slugs from one source of truth.
export const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
