import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartItem, Product } from '../types';
import { showToast } from './toast';
import { qtyLimitMsg } from '../lib/qtyLimit';

/** A positive cap, else null = unlimited. */
function cap(v: number | null | undefined): number | null {
  return typeof v === 'number' && v > 0 ? v : null;
}

interface CartState {
  items: CartItem[];
  add: (p: Product, qty?: number) => void;
  setQty: (id: number, qty: number) => void;
  remove: (id: number) => void;
  clear: () => void;
  count: () => number;
  subtotal: () => number;
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      add: (p, qty = 1) =>
        set((s) => {
          const maxQty = cap(p.max_qty_per_order);
          const unit = p.unit;
          const existing = s.items.find((i) => i.id === p.id);
          const requested = existing ? existing.quantity + qty : qty;
          // Clamp to the per-order cap and inform (block-and-inform, not silent).
          let next = requested;
          if (maxQty != null && requested > maxQty) {
            next = maxQty;
            showToast(qtyLimitMsg(maxQty, unit), 'error');
          }
          if (existing) {
            // Refresh maxQty/unit from the live product so a persisted item picks up a changed cap.
            return { items: s.items.map((i) => (i.id === p.id ? { ...i, quantity: next, maxQty, unit } : i)) };
          }
          return {
            items: [
              ...s.items,
              {
                id: p.id, name: p.name, weight: p.weight, price: Number(p.price), mrp: Number(p.mrp),
                category: p.category, image: p.image, quantity: next, maxQty, unit,
              },
            ],
          };
        }),
      setQty: (id, qty) =>
        set((s) => {
          if (qty <= 0) return { items: s.items.filter((i) => i.id !== id) };
          return {
            items: s.items.map((i) => {
              if (i.id !== id) return i;
              const maxQty = cap(i.maxQty);
              if (maxQty != null && qty > maxQty) {
                showToast(qtyLimitMsg(maxQty, i.unit), 'error');
                return { ...i, quantity: maxQty };
              }
              return { ...i, quantity: qty };
            }),
          };
        }),
      remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
      clear: () => set({ items: [] }),
      count: () => get().items.reduce((n, i) => n + i.quantity, 0),
      subtotal: () => get().items.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0),
    }),
    { name: '4astore-cart' }
  )
);
