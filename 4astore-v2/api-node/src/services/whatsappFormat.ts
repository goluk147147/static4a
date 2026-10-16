/* ------------------------------------------------------------------ *
 * WhatsApp Cloud API — PURE formatting helpers (DB-free, network-free).
 * ------------------------------------------------------------------ *
 * Kept in a dependency-free module so the Node test runner can import
 * it WITHOUT pulling in prisma/db or Express (mirrors the pure-import
 * pattern of posLoginDecision.ts). `whatsappCloud.ts` re-exports these.
 * ------------------------------------------------------------------ */

/**
 * Normalise an Indian mobile number into Meta's `91XXXXXXXXXX` wa_id form.
 * Strips every non-digit, then:
 *   - 10 digits starting 6-9  → prefix `91`  → 12 digits
 *   - 12 digits starting `91` → kept as-is
 *   - anything else           → '' (caller logs + skips)
 */
export function sanitizeMsisdn(input: string): string {
  const digits = String(input ?? '').replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(digits)) return '91' + digits;
  if (/^91[6-9]\d{9}$/.test(digits)) return digits;
  return '';
}

/**
 * Build the `components` array for an IMAGE-header + dynamic-text-body
 * marketing template. Each part is only included when its input is present,
 * so a text-only or body-less template still produces a valid payload:
 *   - header (image) only when `imageUrl` is a non-empty string
 *   - body only when `bodyParams` is a non-empty array
 */
export function buildImageTextComponents(opts: {
  imageUrl?: string;
  bodyParams?: string[];
}): unknown[] {
  const components: unknown[] = [];
  if (typeof opts.imageUrl === 'string' && opts.imageUrl.trim().length > 0) {
    components.push({
      type: 'header',
      parameters: [{ type: 'image', image: { link: opts.imageUrl } }],
    });
  }
  if (Array.isArray(opts.bodyParams) && opts.bodyParams.length > 0) {
    components.push({
      type: 'body',
      parameters: opts.bodyParams.map((t) => ({ type: 'text', text: String(t) })),
    });
  }
  return components;
}
