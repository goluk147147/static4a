/**
 * Single source of truth for the bilingual (romanized Hindi + English) "max
 * quantity per order" message, shared by the authoritative order-placement
 * enforcement in routes/admin.ts and the public read-only POST /api/cart/validate
 * endpoint in routes/cart.ts. Keeping the copy in one place guarantees the
 * storefront and the server say exactly the same thing.
 *
 * For piece products (unit === 'pcs' or empty) the unit is left implicit:
 *   Max 3 allowed / सिर्फ 3 तक
 * For weight/other units the unit is shown so "1 kg" reads naturally:
 *   Max 1 kg allowed / सिर्फ 1 kg तक
 */
export function qtyLimitMessage(maxQty: number, unit?: string | null): string {
  const u = (unit || 'pcs').trim();
  const suffix = u && u.toLowerCase() !== 'pcs' ? ` ${u}` : '';
  return `Max ${maxQty}${suffix} allowed / सिर्फ ${maxQty}${suffix} तक`;
}
