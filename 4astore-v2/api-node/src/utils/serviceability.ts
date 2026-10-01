import { config } from '../config';

/** Haversine distance in km. */
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Normalize for loose comparison (lowercase, single spaces, trimmed). */
function normalize(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * A typed city/village is serviceable if it matches an entry in the
 * settings.serviceable_villages list, either the full "English (हिंदी)"
 * string, the English part, or the Hindi part.
 */
export function serviceableVillage(city: string, serviceableVillages: string): boolean {
  const typed = normalize(city || '');
  if (!typed) return false;
  for (const raw of (serviceableVillages || '').split(',')) {
    const full = raw.trim();
    if (!full) continue;
    let english = full;
    let hindi = '';
    const m = full.match(/^(.*?)\s*\(([^)]*)\)\s*$/u);
    if (m) {
      english = m[1].trim();
      hindi = m[2].trim();
    }
    if (typed === normalize(full) || typed === normalize(english) || (hindi && typed === normalize(hindi))) {
      return true;
    }
  }
  return false;
}

/** Current-GPS orders must be within ~100km of the store. */
export function currentLocationServiceable(
  lat: unknown,
  lng: unknown,
  storeLat = config.store.lat,
  storeLng = config.store.lng
): boolean {
  const la = Number(lat);
  const ln = Number(lng);
  if (!isFinite(la) || !isFinite(ln)) return false;
  return distanceKm(storeLat, storeLng, la, ln) <= 100;
}
