// Shared, defensive label for an order line's pack size, used EVERYWHERE an order is shown
// (customer order view, admin order view, jsPDF invoice, WhatsApp order message). Old orders
// have empty weight/unit; those must render as the bare name — never a blank '()' or 'undefined'.

export interface OrderItemLike {
  name: string;
  weight?: string;
  unit?: string;
  quantity?: number;
}

/**
 * The pack-size suffix for a line, or '' when nothing is known.
 * - A trimmed, non-empty `weight` wins (e.g. '250g').
 * - Else a trimmed, non-empty `unit` yields `${quantity} ${unit}` (e.g. '3 pcs'); quantity falls
 *   back to 1 when missing/invalid so a pcs line never reads '0 pcs' or 'undefined pcs'.
 * - Else ''.
 */
export function orderItemSuffix(item: OrderItemLike): string {
  const weight = (item.weight ?? '').trim();
  if (weight) return weight;
  const unit = (item.unit ?? '').trim();
  if (unit) {
    const qty = Number(item.quantity);
    const count = Number.isFinite(qty) && qty > 0 ? qty : 1;
    return `${count} ${unit}`;
  }
  return '';
}

/**
 * The item's name with its pack-size suffix in parentheses, ONLY when a suffix exists
 * (e.g. 'Mircha (250g)', 'Jharu (3 pcs)'). With no weight/unit it returns the bare name —
 * no blank '()' and no 'undefined'.
 */
export function orderItemLabel(item: OrderItemLike): string {
  const suffix = orderItemSuffix(item);
  return suffix ? `${item.name} (${suffix})` : item.name;
}
