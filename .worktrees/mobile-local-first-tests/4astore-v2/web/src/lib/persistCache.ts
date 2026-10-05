// Lightweight offline/instant cache for React Query using localStorage (no extra
// deps — @tanstack/query-persist-client is intentionally NOT used). Mirrors the
// mobile src/persistCache.ts approach.
//
// On load we restore a snapshot of the public storefront queries so a refresh
// shows the last-seen products/categories/config/settings/pages INSTANTLY, then
// React Query refetches fresh data in the background. We re-save the snapshot
// (debounced) whenever the cache changes. Only public GET data is cached — never
// per-user auth/order data.
import type { QueryClient } from '@tanstack/react-query';

const KEY = '4astore:rq-cache:v1';
// Only persist the big, slow, mostly-static public storefront data.
const PERSIST_KEYS = new Set(['products', 'categories', 'config', 'settings', 'pages']);
const MAX_AGE = 24 * 60 * 60 * 1000; // ignore snapshots older than a day

type Entry = { key: unknown[]; data: unknown; updatedAt: number };

function topKey(queryKey: readonly unknown[]): string {
  return String(queryKey?.[0] ?? '');
}

/** Only single-segment public keys (e.g. ['products']); skip anything with
 *  extra args like ['orders', mobile] so no per-user data is ever persisted. */
function isPublicKey(queryKey: readonly unknown[]): boolean {
  return queryKey.length === 1 && PERSIST_KEYS.has(topKey(queryKey));
}

/** Load the saved snapshot into the QueryClient. Call once before render. */
export function restoreCache(client: QueryClient): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const entries = JSON.parse(raw) as Entry[];
    const now = Date.now();
    for (const e of entries) {
      if (!e || !Array.isArray(e.key) || e.data == null) continue;
      if (!isPublicKey(e.key)) continue;
      if (now - (e.updatedAt || 0) > MAX_AGE) continue;
      // Seed the cache; React Query still marks it stale and refetches.
      client.setQueryData(e.key, e.data);
    }
  } catch {
    /* corrupt snapshot — ignore, fresh fetch fills the cache */
  }
}

/** Subscribe to cache changes and persist a debounced snapshot. Returns an unsubscribe fn. */
export function startPersisting(client: QueryClient): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const save = () => {
    timer = null;
    try {
      const entries: Entry[] = client
        .getQueryCache()
        .getAll()
        .filter((q) => isPublicKey(q.queryKey) && q.state.status === 'success' && q.state.data != null)
        .map((q) => ({ key: q.queryKey as unknown[], data: q.state.data, updatedAt: q.state.dataUpdatedAt || Date.now() }));
      if (entries.length) localStorage.setItem(KEY, JSON.stringify(entries));
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
