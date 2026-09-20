export const USER_AGENT = "waterflow/1.0 (HopHacks water flow analysis project)";

const EARTH_RADIUS_KM = 6371.0088;

export function toRadians(deg: number) {
  return (deg * Math.PI) / 180;
}

export function toDegrees(rad: number) {
  return (rad * 180) / Math.PI;
}

/** Great-circle distance in kilometres. */
export function haversineKm(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
) {
  const dLat = toRadians(bLat - aLat);
  const dLon = toRadians(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function lineLengthKm(coords: number[][]) {
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) {
    total += haversineKm(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
  }
  return total;
}

export type Bounds = { west: number; south: number; east: number; north: number };

/** Square-ish bounding box of `radiusKm` around a point, clamped to valid ranges. */
export function boundsAround(lat: number, lon: number, radiusKm: number): Bounds {
  const dLat = toDegrees(radiusKm / EARTH_RADIUS_KM);
  const dLon = dLat / Math.max(0.05, Math.cos(toRadians(lat)));
  return {
    west: clamp(lon - dLon, -180, 180),
    south: clamp(lat - dLat, -85, 85),
    east: clamp(lon + dLon, -180, 180),
    north: clamp(lat + dLat, -85, 85),
  };
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Hydrology search radius for a place. City/admin results with a bbox expand so
 * the whole footprint is covered (e.g. Baltimore ~12 km); pins without a bbox
 * stay at the neighborhood default. Hard-capped so statewide searches stay fluid.
 */
export function placeHydrologyRadiusKm(place: {
  lat: number;
  lon: number;
  bbox?: [number, number, number, number];
}): number {
  if (!place.bbox) return 3;
  const [west, south, east, north] = place.bbox;
  if (![west, south, east, north].every(Number.isFinite)) return 3;
  if (east <= west || north <= south) return 3;

  const toCorner = Math.max(
    haversineKm(place.lat, place.lon, south, west),
    haversineKm(place.lat, place.lon, south, east),
    haversineKm(place.lat, place.lon, north, west),
    haversineKm(place.lat, place.lon, north, east),
  );
  return clamp(Math.round(toCorner * 1.08 * 10) / 10, 3, 16);
}

/** Web-mercator tile coordinate containing a lon/lat at a zoom level. */
export function lonLatToTile(lon: number, lat: number, zoom: number) {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = toRadians(clamp(lat, -85.05112878, 85.05112878));
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { x: clamp(x, 0, n - 1), y: clamp(y, 0, n - 1), z: zoom };
}

/** Convert lon/lat to a unit-sphere position matching an equirectangular texture. */
export function lonLatToVector3(lon: number, lat: number, radius = 1) {
  const phi = toRadians(90 - lat);
  const theta = toRadians(lon + 180);
  return {
    x: -radius * Math.sin(phi) * Math.cos(theta),
    y: radius * Math.cos(phi),
    z: radius * Math.sin(phi) * Math.sin(theta),
  };
}

export async function fetchJson<T>(
  url: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const { timeoutMs = 20000, ...rest } = init ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...rest.headers },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
