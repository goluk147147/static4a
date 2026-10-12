// Pure decision for the two-phase order lifecycle — mirrors the server's branch in
// api-node/src/routes/orders.ts so the status/payment_reference mapping is unit-testable
// without React, the api client, or Prisma.
//
// Status labels (verbatim, shared across api + web + mobile):
//   'Pending Payment' = early lead created on "Proceed to UPI Payment" (no UTR yet).
//   'Order Placed'    = confirmed/paid state set on screenshot + 12-digit UTR confirm.
//
// Dependency-free on purpose: imports nothing.

export type OrderPhase = 'pending' | 'confirm';

export interface OrderPhaseResult {
  status: 'Pending Payment' | 'Order Placed';
  paymentReference: string | null;
}

export class OrderPhaseError extends Error {}

/**
 * Decide the order_status + payment_reference for a given phase.
 *  - phase 'pending': status 'Pending Payment', paymentReference null (UTR ignored/absent).
 *  - phase 'confirm': requires a 12-digit UTR → status 'Order Placed', paymentReference = that UTR.
 *    A missing/invalid UTR on confirm throws (the server returns 422 for the same case).
 */
export function resolveOrderPhase(phase: OrderPhase, utr?: string): OrderPhaseResult {
  if (phase === 'pending') {
    return { status: 'Pending Payment', paymentReference: null };
  }
  const digits = (utr || '').replace(/\D+/g, '');
  if (!/^\d{12}$/.test(digits)) {
    throw new OrderPhaseError('A valid 12-digit payment reference is required');
  }
  return { status: 'Order Placed', paymentReference: digits };
}
