// Lightweight offline cache for React Query using AsyncStorage (no extra deps).
//
// On launch we restore a snapshot of the important storefront queries so the app
// shows the last-seen products/categories/config/settings INSTANTLY, then React
// Query refetches fresh data in the background. We re-save the snapshot whenever
// the cache changes (debounced). This removes the blank "Loading..." wait on a
// warm start and makes the app usable for a moment even on a slow/absent network.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { QueryClient } from '@tanstack/react-query';

const KEY = '4astore:rq-cache:v1';
// Only persist the big, slow, mostly-static storefront data (not per-user/order data).
const PERSIST_KEYS = new Set(['products', 'categories', 'config', 'settings', 'pages']);
const MAX_AGE = 24 * 60 * 60 * 1000; // ignore snapshots older than a day

type Entry = { key: unknown[]; data: unknown; updatedAt: number };

function topKey(queryKey: readonly unknown[]): string {
  return String(queryKey?.[0] ?? '');
}

/** Load the saved snapshot into the QueryClient. Call once before/at app start. */
export async function restoreCache(client: QueryClient): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return;
    const entries = JSON.parse(raw) as Entry[];
    const now = Date.now();
    for (const e of entries) {
      if (!e || !Array.isArray(e.key) || e.data == null) continue;
      if (now - (e.updatedAt || 0) > MAX_AGE) continue;
      // Seed the cache; React Query will still mark it stale and refetch.
      client.setQueryData(e.key, e.data);
    }
  } catch {
    /* corrupt snapshot — ignore, fresh fetch will fill the cache */
  }
}

/** Subscribe to cache changes and persist a snapshot (debounced). Returns an unsubscribe fn. */
export function startPersisting(client: QueryClient): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const save = () => {
    timer = null;
    try {
      const entries: Entry[] = client
        .getQueryCache()
        .getAll()
        .filter((q) => PERSIST_KEYS.has(topKey(q.queryKey)) && q.state.status === 'success' && q.state.data != null)
        .map((q) => ({ key: q.queryKey as unknown[], data: q.state.data, updatedAt: q.state.dataUpdatedAt || Date.now() }));
      if (entries.length) void AsyncStorage.setItem(KEY, JSON.stringify(entries));
    } catch {
      /* storage full / serialise error — skip this snapshot */
    }
  };

  const unsub = client.getQueryCache().subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 1200); // debounce bursts of updates into one write
  });

  return () => {
    if (timer) clearTimeout(timer);
    unsub();
  };
}
