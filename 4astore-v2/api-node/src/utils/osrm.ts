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

/** Free driving route via the public OSRM router. Returns null on failure. */
export async function roadRoute(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): Promise<RoadRoute | null> {
  if (!validCoordinate(originLat, originLng) || !validCoordinate(destLat, destLng)) return null;
  const url =
    `${config.osrmUrl}/route/v1/driving/` +
    `${originLng},${originLat};${destLng},${destLat}` +
    `?overview=full&geometries=geojson&steps=false`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      routes?: Array<{ distance: number; duration: number; geometry: { type: string; coordinates: number[][] } }>;
    };
    const route = data.routes?.[0];
    if (!route) return null;
    return {
      distance: Math.round((route.distance / 1000) * 100) / 100,
      eta: Math.max(1, Math.round(route.duration / 60)),
      polyline: route.geometry,
    };
  } catch {
    return null;
  }
}
