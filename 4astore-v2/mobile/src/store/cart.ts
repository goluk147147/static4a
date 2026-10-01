import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CartItem, Product } from '../types';

interface CartState {
  items: CartItem[];
  add: (p: Product, qty?: number) => void;
  setQty: (id: number, qty: number) => void;
  remove: (id: number) => void;
  clear: () => void;
}

// Same behaviour as the web cart (persisted under the same key name).
export const useCart = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      add: (p, qty = 1) =>
        set((s) => {
          const existing = s.items.find((i) => i.id === p.id);
          if (existing) return { items: s.items.map((i) => (i.id === p.id ? { ...i, quantity: i.quantity + qty } : i)) };
          return {
            items: [
              ...s.items,
              {
                id: p.id, name: p.name, weight: p.weight, price: Number(p.price), mrp: Number(p.mrp),
                category: p.category, image: p.image, quantity: qty,
              },
            ],
          };
        }),
      setQty: (id, qty) =>
        set((s) => ({
          items: qty <= 0 ? s.items.filter((i) => i.id !== id) : s.items.map((i) => (i.id === id ? { ...i, quantity: qty } : i)),
        })),
      remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
      clear: () => set({ items: [] }),
    }),
    { name: '4astore-cart', storage: createJSONStorage(() => AsyncStorage) }
  )
);

export const useCartCount = () => useCart((s) => s.items.reduce((n, i) => n + i.quantity, 0));
