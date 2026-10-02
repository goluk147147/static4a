import { config } from '../config';

export interface RoadRoute {
  distance: number; // km
  eta: number; // minutes
  polyline: { type: string; coordinates: number[][] }; // GeoJSON LineString
}

export function validCoordinate(lat: unknown, lng: unknown): boolean {
  const la = Number(lat);
  const ln = Number(lng);
  return (
    isFinite(la) &&
    isFinite(ln) &&
    la >= -90 &&
    la <= 90 &&
    ln >= -180 &&
    ln <= 180 &&
    !(la === 0 && ln === 0)
  );
}

// Short-lived route cache. The track screen polls every ~8s but the rider barely
// moves between polls, so hitting the (often-slow, public) OSRM server every time
// is wasteful and was the main source of tracking latency. We cache each
// origin→dest route for a few seconds, keyed on coords rounded to ~11m, so repeat
// polls return instantly and OSRM is called at most once every CACHE_TTL.
const routeCache = new Map<string, { route: RoadRoute | null; at: number }>();
const CACHE_TTL = 20_000; // ms
const r4 = (n: number) => n.toFixed(4); // ~11m precision — plenty for ETA

function cacheKey(oLat: number, oLng: number, dLat: number, dLng: number) {
  return `${r4(oLat)},${r4(oLng)}->${r4(dLat)},${r4(dLng)}`;
}

/** Free driving route via the public OSRM router. Returns null on failure. Cached ~20s. */
export async function roadRoute(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): Promise<RoadRoute | null> {
  if (!validCoordinate(originLat, originLng) || !validCoordinate(destLat, destLng)) return null;

  const key = cacheKey(originLat, originLng, destLat, destLng);
  const now = Date.now();
  const hit = routeCache.get(key);
  if (hit && now - hit.at < CACHE_TTL) return hit.route;

  const url =
    `${config.osrmUrl}/route/v1/driving/` +
    `${originLng},${originLat};${destLng},${destLat}` +
    `?overview=full&geometries=geojson&steps=false`;
  let result: RoadRoute | null = null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500); // fail fast so a slow OSRM never blocks the poll
    const resp = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    clearTimeout(timeout);
    if (resp.ok) {
      const data = (await resp.json()) as {
        routes?: Array<{ distance: number; duration: number; geometry: { type: string; coordinates: number[][] } }>;
      };
      const route = data.routes?.[0];
      if (route) {
        result = {
          distance: Math.round((route.distance / 1000) * 100) / 100,
          eta: Math.max(1, Math.round(route.duration / 60)),
          polyline: route.geometry,
        };
      }
    }
  } catch {
    // On timeout/failure, serve the last known route for this key if we have one (even if stale),
    // so the map/ETA doesn't blank out just because OSRM hiccuped.
    if (hit) return hit.route;
    result = null;
  }

  routeCache.set(key, { route: result, at: now });
  // Keep the cache from growing unbounded on a busy day.
  if (routeCache.size > 500) {
    for (const [k, v] of routeCache) {
      if (now - v.at > CACHE_TTL) routeCache.delete(k);
    }
  }
  return result;
}
