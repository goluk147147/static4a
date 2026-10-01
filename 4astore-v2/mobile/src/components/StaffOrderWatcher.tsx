import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth, isOrderStaff } from '../store/auth';
import { useAllOrders } from '../queries';
import { localOrderAlert } from '../push';
import { speakHindi } from '../native';
import { HAS_PUSH } from '../config';

const SEEN_KEY = '4astore_staff_seen_orders';

/**
 * Staff safety net while the app is open: polls orders (like the web admin bell) and raises a
 * loud local notification + Hindi voice for every order not seen before. FCM push covers the
 * app-closed case; this also works when Firebase isn't configured yet.
 */
export default function StaffOrderWatcher() {
  const user = useAuth((s) => s.user);
  const staff = isOrderStaff(user);
  const { data: orders } = useAllOrders(staff, 15000);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!staff || !orders) return;
    (async () => {
      if (!seen.current) {
        const raw = await AsyncStorage.getItem(`${SEEN_KEY}_${user?.id}`);
        // First run on this device: baseline = everything already there (no alert storm).
        seen.current = new Set(raw ? (JSON.parse(raw) as string[]) : orders.map((o) => o.order_id));
      }
      const fresh = orders.filter((o) => !seen.current!.has(o.order_id) && o.order_status === 'Order Placed');
      orders.forEach((o) => seen.current!.add(o.order_id));
      await AsyncStorage.setItem(`${SEEN_KEY}_${user?.id}`, JSON.stringify([...seen.current].slice(-500)));
      if (!fresh.length) return;

      // With FCM active the server push already alerted; only speak. Without FCM, notify locally.
      for (const o of fresh.slice(0, 3)) {
        const c = o.customer || {};
        if (!HAS_PUSH) {
          await localOrderAlert(
            `🛒 New order #${o.order_id} – ₹${o.total_amount}`,
            `${c.name || 'Customer'} (${c.mobile || ''}) • ${o.items.length} item • 📍 ${[c.address, c.city].filter(Boolean).join(', ')}`,
            o.order_id
          );
        }
      }
      const first = fresh[0].customer?.name || 'ek grahak';
      speakHindi(
        fresh.length === 1
          ? `Naya order aaya hai ${first} se, kul ${fresh[0].total_amount} rupaye ka.`
          : `${fresh.length} naye order aaye hain.`
      );
    })().catch(() => null);
  }, [orders, staff, user?.id]);

  return null;
}
