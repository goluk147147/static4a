// Local-first saved-address store (no extra deps).
//
// The checkout page used to GET /addresses on mount and POST /addresses while
// the Save button spun — on a slow network that froze the whole flow ("save
// address pe atak raha hai"). Instead we keep the user's addresses in
// AsyncStorage (per-user versioned key), serve them INSTANTLY on mount, and do
// every network write in the background. Optimistic rows get a NEGATIVE temp id
// until the server returns the real one; writes that fail offline go onto a
// pending queue and are flushed next time the checkout mounts.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../api';
import type { SavedAddress } from '../types';

const KEY = (userId: number | string) => `4astore:addresses:v1:${userId}`;
const PENDING_KEY = (userId: number | string) => `4astore:addresses:pending:v1:${userId}`;

/** Payload mirrors checkout.tsx saveAddress(); a create payload carries id: undefined. */
export interface PendingPayload {
  action: 'create' | 'update';
  id?: number;
  label: string;
  receiver_name: string;
  phone: string;
  house_no: string;
  landmark?: string;
  city: string;
  district?: string;
  state?: string;
  pincode: string;
  latitude?: number | null;
  longitude?: number | null;
  full_address?: string;
}

/** Load the saved addresses for a user from local storage. Returns [] on missing/corrupt/throw. */
export async function loadLocal(userId: number | string): Promise<SavedAddress[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY(userId));
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? (list as SavedAddress[]) : [];
  } catch {
    return [];
  }
}

/** Persist the full address list for a user. Swallows storage errors. */
export async function saveLocal(userId: number | string, list: SavedAddress[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY(userId), JSON.stringify(list));
  } catch {
    /* storage full / serialise error — skip */
  }
}

/** Replace the entry whose id === addr.id, else prepend addr. Returns the new list. */
export async function upsertLocal(userId: number | string, addr: SavedAddress): Promise<SavedAddress[]> {
  const list = await loadLocal(userId);
  const idx = list.findIndex((a) => a.id === addr.id);
  const next = idx >= 0 ? list.map((a, i) => (i === idx ? addr : a)) : [addr, ...list];
  await saveLocal(userId, next);
  return next;
}

/** Pull the authoritative list from the server and cache it. Returns null on failure. */
export async function syncFromServer(userId: number | string): Promise<SavedAddress[] | null> {
  try {
    const d = await api.get('/addresses');
    const list = (d.addresses || []) as SavedAddress[];
    await saveLocal(userId, list);
    return list;
  } catch {
    return null;
  }
}

/** Queue a write that could not reach the server. Swallows errors. */
export async function queuePending(userId: number | string, payload: PendingPayload): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY(userId));
    const queue: PendingPayload[] = raw ? (JSON.parse(raw) as PendingPayload[]) : [];
    queue.push(payload);
    await AsyncStorage.setItem(PENDING_KEY(userId), JSON.stringify(queue));
  } catch {
    /* storage full / serialise error — skip */
  }
}

/**
 * Flush queued writes to the server. For each payload POST /addresses; on success
 * reconcile the returned id into local storage, replacing any NEGATIVE temp row
 * that matches (by phone+house_no+pincode, else the oldest temp row). On full
 * success clear the queue and return the latest local list; on any failure keep
 * the remaining queue and return null.
 */
export async function flushPending(userId: number | string): Promise<SavedAddress[] | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY(userId));
    const queue: PendingPayload[] = raw ? (JSON.parse(raw) as PendingPayload[]) : [];
    if (!queue.length) return null;

    const remaining = [...queue];
    for (const payload of queue) {
      try {
        const res = await api.post('/addresses', payload);
        const saved = res.address as SavedAddress;
        if (saved) await reconcileTemp(userId, payload, saved);
        remaining.shift();
      } catch {
        // Stop at the first failure; keep this and the rest queued.
        await AsyncStorage.setItem(PENDING_KEY(userId), JSON.stringify(remaining));
        return null;
      }
    }

    await AsyncStorage.removeItem(PENDING_KEY(userId));
    return loadLocal(userId);
  } catch {
    return null;
  }
}

/** Replace a negative temp row with the server's real address. */
async function reconcileTemp(userId: number | string, payload: PendingPayload, saved: SavedAddress): Promise<void> {
  const list = await loadLocal(userId);
  const temps = list.filter((a) => a.id < 0);
  const match =
    temps.find((a) => a.phone === payload.phone && a.house_no === payload.house_no && a.pincode === payload.pincode) ||
    temps.reduce<SavedAddress | undefined>((oldest, a) => (!oldest || a.id > oldest.id ? a : oldest), undefined);
  const next = match
    ? list.map((a) => (a.id === match.id ? saved : a))
    : [saved, ...list.filter((a) => a.id !== saved.id)];
  await saveLocal(userId, next);
}
