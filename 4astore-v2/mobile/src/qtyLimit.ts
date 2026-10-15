/**
 * Storefront single source of truth for the bilingual (romanized Hindi +
 * English) "max quantity per order" copy. Matches the server helper
 * (api-node/src/utils/qtyLimit.ts) and the web storefront (web/src/lib/qtyLimit.ts)
 * so the instant client clamp and the authoritative API response say exactly the
 * same thing.
 *
 * pcs products leave the unit implicit ("Max 3 allowed / सिर्फ 3 तक"); weight
 * (or other) units show the unit ("Max 1 kg allowed / सिर्फ 1 kg तक").
 */
export function qtyLimitMsg(maxQty: number, unit?: string | null): string {
  const u = (unit || 'pcs').trim();
  const suffix = u && u.toLowerCase() !== 'pcs' ? ` ${u}` : '';
  return `Max ${maxQty}${suffix} allowed / सिर्फ ${maxQty}${suffix} तक`;
}

/** Short caption shown under the +/- stepper at the cap (same bilingual copy). */
export function qtyLimitCaption(maxQty: number, unit?: string | null): string {
  return qtyLimitMsg(maxQty, unit);
}

/** A positive cap, else null = unlimited. */
export function cap(v: number | null | undefined): number | null {
  return typeof v === 'number' && v > 0 ? v : null;
}
