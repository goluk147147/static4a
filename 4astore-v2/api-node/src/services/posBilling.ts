/**
 * POS billing — the PURE money/quantity math engine (design §4.3).
 *
 * This module has NO Express / Prisma / DB import on purpose: it is the single
 * source of truth for every total the server computes, and it is unit-tested
 * directly (src/__tests__/posBilling.test.ts) with no database.
 *
 * INVARIANTS (owned here):
 *   - Money is computed in integer PAISE (× 100, Math.round, ÷ 100) so there is
 *     NO binary-float drift. The caller stores the returned rupee numbers into
 *     DECIMAL columns; it never trusts a client-sent total.
 *   - For catalogue lines the authoritative `rate`/`taxRate` MUST come from the
 *     product row the server locked FOR UPDATE — never from the client. Manual
 *     (off-catalogue) lines have no catalogue reference, so the client-entered
 *     rate is used, but the line/grand totals are still recomputed here.
 *   - Quantity is DECIMAL(10,3): > 0, <= 50000 (covers 50 kg in grams and large
 *     piece counts). Rate: 0..100000. Discount: 0..subtotal.
 */

/** Rupees → integer paise (round half-up away from float noise). */
export function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/** Integer paise → rupees with exactly 2 decimal places (as a number). */
export function fromPaise(paise: number): number {
  // Divide back and snap to 2dp so JSON carries a clean DECIMAL(…,2) value.
  return Math.round(paise) / 100;
}

/** round2(x) via the paise path — the ONLY rounding used for money. */
export function round2(rupees: number): number {
  return fromPaise(toPaise(rupees));
}

export const QTY_MAX = 50000;
export const RATE_MAX = 100000;
export const QTY_DP = 3; // DECIMAL(10,3)

export interface BillLineInput {
  /** Catalogue product id, or null/undefined for a manual off-catalogue line. */
  productId?: number | bigint | null;
  name: string;
  unit: string;
  quantity: number;
  /** Unit selling price. For catalogue lines the caller overrides this with the
   *  authoritative product price BEFORE calling computeBill. */
  rate: number;
  taxRate?: number;
  isManual?: boolean;
}

export interface ComputedLine {
  productId: number | null;
  name: string;
  unit: string;
  quantity: number;
  rate: number;
  taxRate: number;
  /** Pre-tax line amount, round2(quantity × rate). */
  lineBase: number;
  /** round2(lineBase × taxRate / 100). */
  lineTax: number;
  /** Stored line_total = lineBase + lineTax (design §4.3 — tax included). */
  lineTotal: number;
  isManual: boolean;
}

export interface ComputedBill {
  lines: ComputedLine[];
  /** Σ lineBase. */
  subtotal: number;
  /** bill-level discount, clamped to [0, subtotal]. */
  discount: number;
  /** Σ lineTax. */
  taxTotal: number;
  /** round2(subtotal − discount + taxTotal). */
  grandTotal: number;
}

export class BillValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillValidationError';
  }
}

/** Validate a quantity against the DECIMAL(10,3) / range rules. Throws on bad input. */
export function validateQuantity(quantity: number, name = 'item'): number {
  if (typeof quantity !== 'number' || !Number.isFinite(quantity)) {
    throw new BillValidationError(`Invalid quantity for ${name}.`);
  }
  if (quantity <= 0) throw new BillValidationError(`Quantity for ${name} must be greater than 0.`);
  if (quantity > QTY_MAX) throw new BillValidationError(`Quantity for ${name} exceeds the ${QTY_MAX} limit.`);
  // Enforce <= 3 decimal places without float drift (compare against the rounded value in milli-units).
  const milli = Math.round(quantity * 1000);
  if (Math.abs(milli / 1000 - quantity) > 1e-9) {
    throw new BillValidationError(`Quantity for ${name} supports at most ${QTY_DP} decimal places.`);
  }
  return milli / 1000;
}

/** Validate a unit rate (money) against the range rules. Throws on bad input. */
export function validateRate(rate: number, name = 'item'): number {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) {
    throw new BillValidationError(`Invalid rate for ${name}.`);
  }
  if (rate < 0) throw new BillValidationError(`Rate for ${name} cannot be negative.`);
  if (rate > RATE_MAX) throw new BillValidationError(`Rate for ${name} exceeds the ₹${RATE_MAX} limit.`);
  return round2(rate);
}

/** Validate a tax rate percentage (0..100, <= 2dp). */
export function validateTaxRate(taxRate: number | undefined | null, name = 'item'): number {
  if (taxRate == null) return 0;
  if (typeof taxRate !== 'number' || !Number.isFinite(taxRate)) {
    throw new BillValidationError(`Invalid tax rate for ${name}.`);
  }
  if (taxRate < 0 || taxRate > 100) throw new BillValidationError(`Tax rate for ${name} must be between 0 and 100.`);
  return round2(taxRate);
}

/** Compute a single line (pre-tax base, tax, inclusive total) in paise math. */
export function computeLine(input: BillLineInput): ComputedLine {
  const quantity = validateQuantity(input.quantity, input.name);
  const rate = validateRate(input.rate, input.name);
  const taxRate = validateTaxRate(input.taxRate, input.name);

  // lineBase = round2(quantity × rate) — do the multiply in paise to avoid drift.
  // quantity has up to 3dp; multiply milli-qty × paise-rate then divide by 1000.
  const milliQty = Math.round(quantity * 1000);
  const ratePaise = toPaise(rate);
  const lineBasePaise = Math.round((milliQty * ratePaise) / 1000);
  const lineTaxPaise = Math.round((lineBasePaise * taxRate) / 100);

  const productId =
    input.productId == null ? null : Number(input.productId);

  return {
    productId,
    name: input.name,
    unit: input.unit,
    quantity,
    rate,
    taxRate,
    lineBase: fromPaise(lineBasePaise),
    lineTax: fromPaise(lineTaxPaise),
    lineTotal: fromPaise(lineBasePaise + lineTaxPaise),
    isManual: !!input.isManual,
  };
}

/**
 * Compute the whole bill from authoritative line inputs + a bill-level discount.
 * All sums are accumulated in paise then converted once at the boundary.
 */
export function computeBill(lines: BillLineInput[], discountInput = 0): ComputedBill {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new BillValidationError('A bill needs at least one item.');
  }
  const computed = lines.map(computeLine);

  let subtotalPaise = 0;
  let taxTotalPaise = 0;
  for (const line of computed) {
    subtotalPaise += toPaise(line.lineBase);
    taxTotalPaise += toPaise(line.lineTax);
  }

  // Discount: >= 0, <= subtotal.
  if (typeof discountInput !== 'number' || !Number.isFinite(discountInput) || discountInput < 0) {
    throw new BillValidationError('Discount must be zero or a positive amount.');
  }
  let discountPaise = toPaise(discountInput);
  if (discountPaise > subtotalPaise) {
    throw new BillValidationError('Discount cannot exceed the subtotal.');
  }

  const grandTotalPaise = subtotalPaise - discountPaise + taxTotalPaise;

  return {
    lines: computed,
    subtotal: fromPaise(subtotalPaise),
    discount: fromPaise(discountPaise),
    taxTotal: fromPaise(taxTotalPaise),
    grandTotal: fromPaise(grandTotalPaise),
  };
}

/**
 * Format a human-sequential invoice number, e.g. ('INV-', 1) → 'INV-000001'.
 *
 * NIT 1 fix (design §4.2): the sequence must be read AFTER an in-transaction
 * increment (read-then-use the post-increment value) OR seeded at 0, so the
 * FIRST invoice is INV-000001 and never INV-000000. The caller runs
 * `UPDATE settings SET pos_next_bill_seq = pos_next_bill_seq + 1` then selects
 * the new value and passes it here, so `seq` is always >= 1.
 */
export function formatBillNo(prefix: string, seq: number | bigint): string {
  const n = Number(seq);
  if (!Number.isFinite(n) || n < 1) {
    throw new BillValidationError('Invalid bill sequence number.');
  }
  return `${prefix || 'INV-'}${String(n).padStart(6, '0')}`;
}

/** Derive payment_status from grand total vs amount paid. */
export function paymentStatusFor(grandTotal: number, amountPaid: number): 'paid' | 'partial' | 'pending' {
  const gt = toPaise(grandTotal);
  const paid = toPaise(amountPaid);
  if (paid <= 0) return 'pending';
  if (paid >= gt) return 'paid';
  return 'partial';
}
