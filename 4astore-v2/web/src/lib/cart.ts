import { api } from './api';

/** One line in the POST /api/cart/validate response. */
export interface CartValidateLine {
  id: number;
  name: string | null;
  unit: string | null;
  maxQty: number | null; // authoritative cap; null = unlimited
  requested: number;
  ok: boolean; // false = over the per-order cap
  allowed: number; // quantity the client should clamp to
  message: string | null; // bilingual "Max N allowed / सिर्फ N तक" when over the cap
}

/**
 * Confirm cart lines against the AUTHORITATIVE server-side per-order purchase
 * caps (public, read-only). The server reads max_qty_per_order fresh from the
 * DB — the client never sends a limit the server trusts. Used to surface the
 * server's bilingual message while the instant client clamp (store/cart.ts)
 * stays the primary UX.
 */
export async function validateCart(lines: Array<{ id: number; quantity: number }>): Promise<CartValidateLine[]> {
  const { data } = await api.post('/cart/validate', lines);
  return (data?.lines ?? []) as CartValidateLine[];
}
