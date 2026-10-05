import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminOrderFull } from './adminData';
import { showToast } from '../../store/toast';

// Port of the original admin.html new-order notifications (same localStorage keys).
const NOTIF_SEEN_KEY = '4astore_admin_seen_orders';
const NOTIF_LIST_KEY = '4astore_admin_notifs';
const NOTIF_LAST_CHECK_KEY = '4astore_admin_last_order_check';

export interface AdminNotif {
  orderId: string;
  name: string;
  amount: number;
  time: string;
  read: boolean;
}

const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
};

let audioCtx: AudioContext | null = null;

/** Must be called from a user gesture once so later (polled) beeps are allowed. */
export function unlockNotifAudio() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') void audioCtx.resume().catch(() => null);
  } catch {
    /* audio not available */
  }
}

function playBeep() {
  unlockNotifAudio();
  const ctx = audioCtx;
  if (!ctx) return;
  const play = () => {
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      osc.start(t);
      osc.stop(t + 0.18);
    });
  };
  if (ctx.state === 'suspended') void ctx.resume().then(play).catch(() => null);
  else play();
}

function speak(text: string) {
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'hi-IN';
    u.rate = 0.92;
    const go = () => {
      const hi = window.speechSynthesis.getVoices().find((v) => v.lang === 'hi-IN' || v.lang.startsWith('hi'));
      if (hi) u.voice = hi;
      window.speechSynthesis.speak(u);
    };
    // Small delay so the beep isn't cut off; some browsers load voices late.
    if (window.speechSynthesis.getVoices().length) setTimeout(go, 450);
    else setTimeout(go, 900);
  } catch {
    /* speech not available */
  }
}

export function useOrderNotifications(orders: AdminOrderFull[] | undefined, adminId: string | number | undefined) {
  const seenKey = adminId != null ? `${NOTIF_SEEN_KEY}_${adminId}` : NOTIF_SEEN_KEY;
  const lastCheckKey = adminId != null ? `${NOTIF_LAST_CHECK_KEY}_${adminId}` : NOTIF_LAST_CHECK_KEY;

  const [notifs, setNotifsState] = useState<AdminNotif[]>(() => readJson<AdminNotif[]>(NOTIF_LIST_KEY, []));
  const [soundOn, setSoundOn] = useState(true);
  const soundRef = useRef(soundOn);
  soundRef.current = soundOn;
  const firstRun = useRef(true);

  const setNotifs = useCallback((list: AdminNotif[]) => {
    const trimmed = list.slice(0, 50);
    localStorage.setItem(NOTIF_LIST_KEY, JSON.stringify(trimmed));
    setNotifsState(trimmed);
  }, []);

  const alertNew = useCallback((fresh: { orderId: string; name: string; amount: number }[]) => {
    if (soundRef.current) {
      playBeep();
      if (fresh.length === 1) speak(`Naya order aaya hai ${fresh[0].name || 'ek grahak'} se, kul ${fresh[0].amount} rupaye ka.`);
      else speak(`${fresh.length} naye order aaye hain.`);
    }
  }, []);

  // Original checkNewOrders(): runs on every poll result.
  useEffect(() => {
    if (!orders || adminId == null) return;
    const seen = readJson<string[]>(seenKey, []);
    const lastCheck = Number(localStorage.getItem(lastCheckKey) || 0);
    const isFirst = firstRun.current;
    firstRun.current = false;

    const newOrders = orders.filter((o) => {
      if (!isFirst) return !seen.includes(o.order_id);
      // On login don't alert for the whole history — only orders placed since the
      // last check (or in the last 15 min the very first time).
      const created = Date.parse(o.order_date || '');
      if (!Number.isFinite(created)) return false;
      return lastCheck > 0 ? created > lastCheck : created > Date.now() - 15 * 60 * 1000;
    });

    const allIds = orders.map((o) => o.order_id);
    if (isFirst) {
      const baseline = allIds.filter((id) => !newOrders.some((o) => o.order_id === id));
      localStorage.setItem(seenKey, JSON.stringify(Array.from(new Set([...seen, ...baseline]))));
    }

    if (newOrders.length) {
      const fresh = newOrders.map((o) => ({ orderId: o.order_id, name: o.customer?.name || 'Customer', amount: o.total_amount || 0 }));
      const current = readJson<AdminNotif[]>(NOTIF_LIST_KEY, []);
      setNotifs([...fresh.map((f) => ({ ...f, time: new Date().toISOString(), read: false })), ...current]);
      localStorage.setItem(seenKey, JSON.stringify(allIds));
      alertNew(fresh);
      showToast(`🛒 ${newOrders.length} new order${newOrders.length > 1 ? 's' : ''} received!`, 'success');
    }
    localStorage.setItem(lastCheckKey, String(Date.now()));
  }, [orders, adminId, seenKey, lastCheckKey, setNotifs, alertNew]);

  const markRead = (orderId: string) => setNotifs(notifs.map((n) => (n.orderId === orderId ? { ...n, read: true } : n)));
  const markAllRead = () => setNotifs(notifs.map((n) => ({ ...n, read: true })));

  /** Original testNotif(): fake notification to check sound + voice + badge. */
  const testNotif = () => {
    unlockNotifAudio();
    const fakeId = 'TEST' + Math.floor(1000 + Math.random() * 9000);
    setNotifs([{ orderId: fakeId, name: 'Test Grahak', amount: 130, time: new Date().toISOString(), read: false }, ...notifs]);
    if (soundRef.current) {
      playBeep();
      speak('Naya order aaya hai Test Grahak se, kul ek sau tees rupaye ka.');
    }
    showToast('🔔 Test notification fired', 'success');
  };

  return {
    notifs,
    unread: notifs.filter((n) => !n.read).length,
    soundOn,
    setSoundOn,
    markRead,
    markAllRead,
    testNotif,
  };
}
