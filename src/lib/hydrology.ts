import { boundsAround, lineLengthKm, USER_AGENT, type Bounds } from "@/lib/geo";
import type { HydrologyResponse } from "@/lib/types";

type LineFeature = GeoJSON.Feature<GeoJSON.LineString>;
type PolyFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];
const OVERPASS_ATTEMPT_MS = 8000;

/** Hard caps keep dense places (e.g. Kofu irrigation mesh) drawable at 60fps. */
const MAX_FLOWLINES_NEAR = 160;
const MAX_FLOWLINES_CITY = 520;
const MAX_WATERBODIES = 80;
const MAX_WETLANDS = 60;
const MAX_BUILDINGS = 500;
const MAX_ROADS = 400;
const MAX_LINE_POINTS = 48;
const MAX_RING_POINTS = 40;

function flowlineCap(radiusKm: number) {
  if (radiusKm <= 4) return MAX_FLOWLINES_NEAR;
  if (radiusKm <= 8) return 280;
  return MAX_FLOWLINES_CITY;
}

/** In-memory response cache so re-visiting a site is instant during a demo. */
const hydrologyCache = new Map<string, { at: number; data: HydrologyResponse }>();
const CACHE_TTL_MS = 45 * 60 * 1000;
const EMPTY_CACHE_TTL_MS = 3 * 60 * 1000;

function rememberHydrology(key: string, data: HydrologyResponse) {
  const empty = data.stats.channelCount === 0 && data.stats.waterbodyCount === 0;
  // Avoid poisoning the long cache with transient Overpass misses.
  if (empty) {
    hydrologyCache.set(key, { at: Date.now() - (CACHE_TTL_MS - EMPTY_CACHE_TTL_MS), data });
  } else {
    hydrologyCache.set(key, { at: Date.now(), data });
  }
  if (hydrologyCache.size > 64) {
    const oldest = hydrologyCache.keys().next().value;
    if (oldest) hydrologyCache.delete(oldest);
  }
}

function cacheKey(lat: number, lon: number, radiusKm: number, asOf?: string, mode?: string) {
  return `v8:${lat.toFixed(3)},${lon.toFixed(3)},${radiusKm},${asOf ?? "today"},${mode ?? "full"}`;
}

function osmChannelRank(waterway: string | undefined) {
  switch (waterway) {
    case "river":
      return 4;
    case "canal":
      return 3;
    case "stream":
      return 2;
    case "tidal_channel":
      return 2;
    default:
      return 1;
  }
}

function nhdChannelRank(visibility: number | undefined, ftype: number | undefined) {
  if (ftype === 336) return 2;
  if (!visibility) return 2;
  if (visibility <= 5000) return 1;
  if (visibility <= 24000) return 2;
  if (visibility <= 50000) return 3;
  if (visibility <= 150000) return 4;
  return 5;
}

function bboxString({ south, west, north, east }: Bounds) {
  return `${south},${west},${north},${east}`;
}

type OverpassElement = {
  type: "way" | "relation" | "node";
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[];
};

function ring(geometry: { lat: number; lon: number }[]) {
  const coords = geometry.map((p) => [p.lon, p.lat] as [number, number]);
  if (coords.length < 4) return null;
  const [first] = coords;
  const last = coords[coords.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) coords.push([first[0], first[1]]);
  return coords;
}

/** Drop intermediate vertices so dense OSM meshes stay light for MapLibre. */
function simplifyCoords(coords: number[][], maxPoints: number): number[][] {
  if (coords.length <= maxPoints) return coords;
  const step = Math.ceil((coords.length - 1) / (maxPoints - 1));
  const out: number[][] = [];
  for (let i = 0; i < coords.length; i += step) out.push(coords[i]);
  const last = coords[coords.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function simplifyLineFeature(feature: LineFeature): LineFeature {
  const coords = simplifyCoords(feature.geometry.coordinates, MAX_LINE_POINTS);
  const lengthKm =
    typeof feature.properties?.lengthKm === "number"
      ? feature.properties.lengthKm
      : lineLengthKm(coords);
  return {
    ...feature,
    geometry: { type: "LineString", coordinates: coords },
    properties: {
      ...feature.properties,
      lengthKm: Number(lengthKm.toFixed(3)),
    },
  };
}

function simplifyPolyFeature(feature: PolyFeature): PolyFeature {
  if (feature.geometry.type === "Polygon") {
    return {
      ...feature,
      geometry: {
        type: "Polygon",
        coordinates: feature.geometry.coordinates.map((r) => simplifyCoords(r, MAX_RING_POINTS)),
      },
    };
  }
  return {
    ...feature,
    geometry: {
      type: "MultiPolygon",
      coordinates: feature.geometry.coordinates.map((poly) =>
        poly.map((r) => simplifyCoords(r, MAX_RING_POINTS)),
      ),
    },
  };
}

function trimFlowlines(features: LineFeature[], max: number): LineFeature[] {
  const filtered = features.filter((feature) => {
    const kind = feature.properties?.kind;
    return kind !== "ditch" && kind !== "drain";
  });

  filtered.sort((a, b) => {
    // Named reaches first so city-scale caps never drop Jones Falls / Patapsco
    // in favor of anonymous high-visibility drains.
    const namedBonus =
      (typeof b.properties?.name === "string" && b.properties.name ? 1 : 0) -
      (typeof a.properties?.name === "string" && a.properties.name ? 1 : 0);
    if (namedBonus) return namedBonus;
    const rankDiff = Number(b.properties?.rank ?? 0) - Number(a.properties?.rank ?? 0);
    if (rankDiff) return rankDiff;
    return Number(b.properties?.lengthKm ?? 0) - Number(a.properties?.lengthKm ?? 0);
  });

  return filtered.slice(0, max).map(simplifyLineFeature);
}

function trimPolys(features: PolyFeature[], max: number): PolyFeature[] {
  if (features.length <= max) return features.map(simplifyPolyFeature);
  // Prefer larger rings (more vertices ≈ larger waterbodies) then named ones.
  const ranked = [...features].sort((a, b) => {
    const size = (f: PolyFeature) => {
      if (f.geometry.type === "Polygon") return f.geometry.coordinates[0]?.length ?? 0;
      return f.geometry.coordinates.reduce((n, poly) => n + (poly[0]?.length ?? 0), 0);
    };
    const named =
      (typeof b.properties?.name === "string" && b.properties.name ? 1 : 0) -
      (typeof a.properties?.name === "string" && a.properties.name ? 1 : 0);
    if (named) return named;
    return size(b) - size(a);
  });
  return ranked.slice(0, max).map(simplifyPolyFeature);
}

async function overpass(query: string, timeoutMs = OVERPASS_ATTEMPT_MS): Promise<OverpassElement[]> {
  const body = new URLSearchParams({ data: query }).toString();
  const controllers = OVERPASS_ENDPOINTS.map(() => new AbortController());

  const attempts = OVERPASS_ENDPOINTS.map(async (endpoint, index) => {
    const timer = setTimeout(() => controllers[index].abort(), timeoutMs);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        signal: controllers[index].signal,
        next: { revalidate: 3600 },
      });
      if (!res.ok) throw new Error(`Overpass responded ${res.status}`);
      const json = (await res.json()) as { elements: OverpassElement[] };
      return json.elements ?? [];
    } finally {
      clearTimeout(timer);
    }
  });

  try {
    const elements = await Promise.any(attempts);
    for (const controller of controllers) controller.abort();
    return elements;
  } catch {
    console.warn("Overpass unavailable; falling back to NHD / already-loaded layers.");
    return [];
  }
}

function emptyOsm() {
  return {
    flowlines: [] as LineFeature[],
    waterbodies: [] as PolyFeature[],
    wetlands: [] as PolyFeature[],
    buildings: [] as GeoJSON.Feature<GeoJSON.Polygon>[],
    roads: [] as LineFeature[],
  };
}

/**
 * Fast path: rivers/streams/canals + water + wetlands only.
 * Ditches/drains are excluded (dense irrigation grids like Kofu tank FPS).
 */
async function fetchOsmWater(center: Bounds) {
  const wide = bboxString(center);
  const query = `[out:json][timeout:10][maxsize:25165824];
(
  way["waterway"="river"](${wide});
  way["waterway"~"^(stream|canal|tidal_channel)$"]["name"](${wide});
  way["natural"="water"](${wide});
  relation["natural"="water"](${wide});
  way["landuse"="reservoir"](${wide});
  way["natural"="wetland"](${wide});
);
out geom;`;

  const elements = await overpass(query);
  const flowlines: LineFeature[] = [];
  const waterbodies: PolyFeature[] = [];
  const wetlands: PolyFeature[] = [];

  for (const element of elements) {
    const tags = element.tags ?? {};

    if (element.type === "relation") {
      const polygons: number[][][][] = [];
      for (const member of element.members ?? []) {
        if (member.role !== "outer" || !member.geometry) continue;
        const shell = ring(member.geometry);
        if (shell) polygons.push([shell]);
      }
      if (polygons.length && tags.natural === "water") {
        waterbodies.push({
          type: "Feature",
          id: `r${element.id}`,
          geometry: { type: "MultiPolygon", coordinates: polygons },
          properties: { name: tags.name ?? null, kind: tags.water ?? "water" },
        });
      }
      continue;
    }

    if (!element.geometry || element.geometry.length < 2) continue;
    const coords = element.geometry.map((p) => [p.lon, p.lat] as [number, number]);

    if (tags.waterway && !tags.natural) {
      flowlines.push({
        type: "Feature",
        id: `w${element.id}`,
        geometry: { type: "LineString", coordinates: coords },
        properties: {
          name: tags.name ?? null,
          kind: tags.waterway,
          rank: osmChannelRank(tags.waterway),
          regime:
            tags.intermittent === "yes" || tags.seasonal === "yes" || tags.ephemeral === "yes"
              ? tags.ephemeral === "yes"
                ? "ephemeral"
                : "intermittent"
              : "perennial",
          lengthKm: lineLengthKm(coords),
          source: "OpenStreetMap",
        },
      });
      continue;
    }

    if (tags.natural === "water" || tags.landuse === "reservoir") {
      const shell = ring(element.geometry);
      if (shell) {
        waterbodies.push({
          type: "Feature",
          id: `w${element.id}`,
          geometry: { type: "Polygon", coordinates: [shell] },
          properties: { name: tags.name ?? null, kind: tags.water ?? tags.landuse ?? "water" },
        });
      }
      continue;
    }

    if (tags.natural === "wetland") {
      const shell = ring(element.geometry);
      if (shell) {
        wetlands.push({
          type: "Feature",
          id: `w${element.id}`,
          geometry: { type: "Polygon", coordinates: [shell] },
          properties: { name: tags.name ?? null, kind: tags.wetland ?? "wetland" },
        });
      }
    }
  }

  return { flowlines, waterbodies, wetlands, buildings: [], roads: [] };
}

/** Slower path: buildings + roads in a tight radius only. */
async function fetchOsmBuilt(inner: Bounds) {
  const tight = bboxString(inner);
  const query = `[out:json][timeout:8][maxsize:12582912];
(
  way["building"](${tight});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential)$"](${tight});
);
out geom;`;

  const elements = await overpass(query);
  const buildings: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
  const roads: LineFeature[] = [];

  for (const element of elements) {
    if (element.type !== "way" || !element.geometry || element.geometry.length < 2) continue;
    const tags = element.tags ?? {};
    const coords = element.geometry.map((p) => [p.lon, p.lat] as [number, number]);

    if (tags.building) {
      const shell = ring(element.geometry);
      if (shell && buildings.length < MAX_BUILDINGS) {
        const levels = Number.parseFloat(tags["building:levels"] ?? "");
        const height = Number.parseFloat(tags.height ?? "");
        const simplified = simplifyCoords(shell, 24);
        buildings.push({
          type: "Feature",
          id: `w${element.id}`,
          geometry: { type: "Polygon", coordinates: [simplified] },
          properties: {
            name: tags.name ?? null,
            height: Number.isFinite(height)
              ? height
              : Number.isFinite(levels)
                ? levels * 3.2
                : 6.5,
            roof: tags["roof:material"] ?? tags["roof:shape"] ?? null,
          },
        });
      }
      continue;
    }

    if (tags.highway && roads.length < MAX_ROADS) {
      roads.push(
        simplifyLineFeature({
          type: "Feature",
          id: `w${element.id}`,
          geometry: { type: "LineString", coordinates: coords },
          properties: {
            name: tags.name ?? null,
            kind: tags.highway,
            major: ["motorway", "trunk", "primary", "secondary"].includes(tags.highway),
            lengthKm: lineLengthKm(coords),
          },
        }),
      );
    }
  }

  return { buildings, roads };
}

type NhdFeature = GeoJSON.Feature<
  GeoJSON.LineString | GeoJSON.MultiLineString,
  {
    gnis_name?: string | null;
    ftype?: number;
    fcode?: number;
    visibilityfilter?: number;
    lengthkm?: number;
  }
>;

function nhdRegime(fcode: number | undefined): "perennial" | "intermittent" | "ephemeral" | "artificial" {
  if (fcode === 46007) return "ephemeral";
  if (fcode === 46003) return "intermittent";
  if (fcode === 33600 || fcode === 33601 || fcode === 33603 || fcode === 55800) return "artificial";
  return "perennial";
}

async function fetchNhd(bounds: Bounds): Promise<LineFeature[]> {
  const url = new URL("https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6/query");
  url.searchParams.set("geometry", `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`);
  url.searchParams.set("geometryType", "esriGeometryEnvelope");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  // StreamRiver / CanalDitch always. Also ArtificialPath (558) + Connector (334) so
  // named urban rivers (Jones Falls, Gwynns Falls) survive where NHD routes them
  // through waterbodies. Coastline (566) stays out — it rings harbors as fake channels.
  url.searchParams.set("where", "ftype IN (460,336,558,334)");
  url.searchParams.set("outFields", "gnis_name,ftype,fcode,visibilityfilter,lengthkm");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("f", "geojson");
  url.searchParams.set("resultRecordCount", "2000");

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
      next: { revalidate: 86400 },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`NHD responded ${res.status}`);
    const json = (await res.json()) as { features?: NhdFeature[] };
    const features: LineFeature[] = [];

    for (const feature of json.features ?? []) {
      if (!feature.geometry) continue;
      const parts =
        feature.geometry.type === "LineString"
          ? [feature.geometry.coordinates]
          : feature.geometry.coordinates;
      const props = feature.properties ?? {};
      const named = Boolean(props.gnis_name?.trim());
      const visibility = props.visibilityfilter ?? 0;
      const regime = nhdRegime(props.fcode);
      const ftype = props.ftype ?? 0;

      // Unnamed ArtificialPath / Connector = harbor filler and block drains. Named ones
      // are real through-flow (e.g. Jones Falls into the Inner Harbor).
      if ((ftype === 558 || ftype === 334) && !named) continue;

      // Keep map-scale streams and named reaches. Drop ephemeral headwaters and
      // ultra-local drains that make cities look like irrigation grids.
      if (regime === "ephemeral" && !named) continue;
      if (!named && visibility > 0 && visibility < 24000) continue;

      parts.forEach((coords, index) => {
        if (coords.length < 2) return;
        features.push({
          type: "Feature",
          id: `nhd-${features.length}-${index}`,
          geometry: { type: "LineString", coordinates: coords },
          properties: {
            name: props.gnis_name?.trim() || null,
            kind: ftype === 336 ? "canal" : "stream",
            rank: nhdChannelRank(props.visibilityfilter, ftype),
            regime,
            lengthKm: props.lengthkm ?? lineLengthKm(coords),
            source: "USGS NHD",
          },
        });
      });
    }
    return features;
  } catch (error) {
    console.warn("NHD unavailable:", error);
    return [];
  }
}

async function sampleElevation(lat: number, lon: number) {
  try {
    const url = new URL("https://epqs.nationalmap.gov/v1/json");
    url.searchParams.set("x", String(lon));
    url.searchParams.set("y", String(lat));
    url.searchParams.set("units", "Meters");
    url.searchParams.set("wkid", "4326");
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { value?: number | string };
    const value = typeof json.value === "string" ? Number.parseFloat(json.value) : json.value;
    return Number.isFinite(value) && value !== -1000000 ? (value as number) : null;
  } catch {
    return null;
  }
}

function buildStats(
  flowlines: LineFeature[],
  osm: ReturnType<typeof emptyOsm>,
  elevations: (number | null)[],
) {
  const sources = new Set<string>();
  for (const feature of flowlines) {
    const source = feature.properties?.source;
    if (typeof source === "string") sources.add(source);
  }

  const channelKm = flowlines.reduce(
    (total, feature) => total + Number(feature.properties?.lengthKm ?? 0),
    0,
  );
  const named = new Set<string>();
  for (const feature of flowlines) {
    const name = feature.properties?.name;
    if (typeof name === "string" && name) named.add(name);
  }

  const knownElevations = elevations.filter((value): value is number => value !== null);

  return {
    channelCount: flowlines.length,
    channelKm: Number(channelKm.toFixed(2)),
    waterbodyCount: osm.waterbodies.length,
    wetlandCount: osm.wetlands.length,
    buildingCount: osm.buildings.length,
    impervousKm: Number(
      osm.roads
        .reduce((total, road) => total + Number(road.properties?.lengthKm ?? 0), 0)
        .toFixed(2),
    ),
    namedChannels: [...named].sort(),
    sources: [...sources],
    elevationRange: knownElevations.length
      ? ([
          Number(Math.min(...knownElevations).toFixed(1)),
          Number(Math.max(...knownElevations).toFixed(1)),
        ] as [number, number])
      : null,
  };
}

export type CollectOptions = {
  asOf?: string;
  /** `channels` skips buildings/roads so the map can paint during descent. */
  mode?: "channels" | "full";
};

function isConus(lat: number, lon: number) {
  return lat > 24.5 && lat < 49.5 && lon > -125 && lon < -66.5;
}

/**
 * Collect hydrology. Default `channels` mode returns NHD/OSM water fast; call again
 * with `mode: "full"` to merge buildings and roads without blocking first paint.
 */
export async function collectHydrology(
  lat: number,
  lon: number,
  radiusKm: number,
  options: CollectOptions | string = {},
): Promise<HydrologyResponse> {
  const opts: CollectOptions =
    typeof options === "string" ? { asOf: options || undefined } : options;
  const { asOf, mode = "channels" } = opts;

  const key = cacheKey(lat, lon, radiusKm, asOf, mode);
  const hit = hydrologyCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  // Prefer a full-cache hit when asking for channels.
  if (mode === "channels") {
    const fullHit = hydrologyCache.get(cacheKey(lat, lon, radiusKm, asOf, "full"));
    if (fullHit && Date.now() - fullHit.at < CACHE_TTL_MS) return fullHit.data;
  }

  const wide = boundsAround(lat, lon, radiusKm);
  const inner = boundsAround(lat, lon, Math.min(radiusKm, 1.2));
  const conus = isConus(lat, lon);

  // Channels mode in the US: NHD alone is enough for first paint - skip Overpass.
  const needOsmWater = !asOf && !(mode === "channels" && conus);
  const needBuilt = mode === "full" && !asOf;

  const [osmWater, nhd, elevations, built] = await Promise.all([
    asOf || !needOsmWater
      ? Promise.resolve(emptyOsm())
      : fetchOsmWater(wide),
    conus ? fetchNhd(wide) : Promise.resolve([] as LineFeature[]),
    Promise.all(
      [
        [lat, lon],
        [wide.north, wide.west],
        [wide.south, wide.east],
      ].map(([y, x]) => sampleElevation(y, x)),
    ),
    needBuilt ? fetchOsmBuilt(inner) : Promise.resolve({ buildings: [], roads: [] as LineFeature[] }),
  ]);

  // Full mode still wants waterbodies/wetlands even in CONUS.
  let osm = {
    ...osmWater,
    buildings: built.buildings,
    roads: built.roads,
  };

  if (mode === "full" && conus && !asOf && !osm.waterbodies.length) {
    const water = await fetchOsmWater(wide);
    osm = {
      ...osm,
      flowlines: water.flowlines,
      waterbodies: water.waterbodies,
      wetlands: water.wetlands,
    };
  }

  let flowlines =
    asOf && osm.flowlines.length >= 4
      ? osm.flowlines
      : nhd.length >= 4
        ? nhd
        : osm.flowlines.length
          ? osm.flowlines
          : nhd;

  // Outside the US with empty NHD, channels mode still needs OSM waterways.
  if (mode === "channels" && !conus && !asOf && flowlines.length < 4 && !osm.flowlines.length) {
    const water = await fetchOsmWater(wide);
    osm = { ...osm, ...water };
    flowlines = water.flowlines.length ? water.flowlines : flowlines;
  }

  const resolvedRaw =
    nhd.length >= 4 && !asOf
      ? nhd
      : osm.flowlines.length >= 4
        ? osm.flowlines
        : flowlines;

  const resolvedFlow = trimFlowlines(resolvedRaw, flowlineCap(radiusKm));
  const waterbodies = trimPolys(osm.waterbodies, MAX_WATERBODIES);
  const wetlands = trimPolys(osm.wetlands, MAX_WETLANDS);
  const trimmedOsm = {
    ...osm,
    waterbodies,
    wetlands,
    buildings: osm.buildings.slice(0, MAX_BUILDINGS),
    roads: osm.roads.slice(0, MAX_ROADS),
  };

  const data: HydrologyResponse = {
    center: { lat, lon },
    radiusKm,
    flowlines: { type: "FeatureCollection", features: resolvedFlow },
    waterbodies: { type: "FeatureCollection", features: waterbodies },
    wetlands: { type: "FeatureCollection", features: wetlands },
    buildings: { type: "FeatureCollection", features: trimmedOsm.buildings },
    roads: { type: "FeatureCollection", features: trimmedOsm.roads },
    asOf,
    stats: buildStats(resolvedFlow, trimmedOsm, elevations),
  };

  rememberHydrology(key, data);
  return data;
}
