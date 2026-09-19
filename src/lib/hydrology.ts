import { boundsAround, lineLengthKm, USER_AGENT, type Bounds } from "@/lib/geo";
import type { HydrologyResponse } from "@/lib/types";

type LineFeature = GeoJSON.Feature<GeoJSON.LineString>;
type PolyFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];
const OVERPASS_ATTEMPT_MS = 12000;

/** Relative visual weight of a channel, used to drive line widths on the map. */
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
  if (ftype === 336) return 2; // canal / ditch
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

async function overpass(query: string): Promise<OverpassElement[]> {
  const body = new URLSearchParams({ data: query }).toString();
  const controllers = OVERPASS_ENDPOINTS.map(() => new AbortController());

  const attempts = OVERPASS_ENDPOINTS.map(async (endpoint, index) => {
    const timer = setTimeout(() => controllers[index].abort(), OVERPASS_ATTEMPT_MS);
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

async function fetchOsm(center: Bounds, inner: Bounds) {
  const wide = bboxString(center);
  const tight = bboxString(inner);
  const query = `[out:json][timeout:20];
(
  way["waterway"~"^(river|stream|canal|ditch|drain|tidal_channel)$"](${wide});
  way["natural"="water"](${wide});
  relation["natural"="water"](${wide});
  way["landuse"="reservoir"](${wide});
  way["natural"="wetland"](${wide});
  way["building"](${tight});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|service)$"](${tight});
);
out geom;`;

  const elements = await overpass(query);

  const flowlines: LineFeature[] = [];
  const waterbodies: PolyFeature[] = [];
  const wetlands: PolyFeature[] = [];
  const buildings: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
  const roads: LineFeature[] = [];

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
      continue;
    }

    if (tags.building) {
      const shell = ring(element.geometry);
      if (shell && buildings.length < 4000) {
        const levels = Number.parseFloat(tags["building:levels"] ?? "");
        const height = Number.parseFloat(tags.height ?? "");
        buildings.push({
          type: "Feature",
          id: `w${element.id}`,
          geometry: { type: "Polygon", coordinates: [shell] },
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

    if (tags.highway && roads.length < 4000) {
      roads.push({
        type: "Feature",
        id: `w${element.id}`,
        geometry: { type: "LineString", coordinates: coords },
        properties: {
          name: tags.name ?? null,
          kind: tags.highway,
          major: ["motorway", "trunk", "primary", "secondary"].includes(tags.highway),
          lengthKm: lineLengthKm(coords),
        },
      });
    }
  }

  return { flowlines, waterbodies, wetlands, buildings, roads };
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

/**
 * USGS National Hydrography Dataset flowlines. NHD covers every mapped channel in the
 * United States including intermittent headwater streams that OpenStreetMap omits, and
 * its geometry is digitised in the downstream direction so the flow animation runs the
 * correct way.
 */
async function fetchNhd(bounds: Bounds): Promise<LineFeature[]> {
  const url = new URL("https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6/query");
  url.searchParams.set("geometry", `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`);
  url.searchParams.set("geometryType", "esriGeometryEnvelope");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", "gnis_name,ftype,fcode,visibilityfilter,lengthkm");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("f", "geojson");
  url.searchParams.set("resultRecordCount", "4000");

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      next: { revalidate: 86400 },
    });
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
      parts.forEach((coords, index) => {
        if (coords.length < 2) return;
        features.push({
          type: "Feature",
          id: `nhd-${features.length}-${index}`,
          geometry: { type: "LineString", coordinates: coords },
          properties: {
            name: props.gnis_name?.trim() || null,
            kind: props.ftype === 336 ? "canal" : props.ftype === 558 ? "flowpath" : "stream",
            rank: nhdChannelRank(props.visibilityfilter, props.ftype),
            regime: nhdRegime(props.fcode),
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
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { value?: number | string };
    const value = typeof json.value === "string" ? Number.parseFloat(json.value) : json.value;
    return Number.isFinite(value) && value !== -1000000 ? (value as number) : null;
  } catch {
    return null;
  }
}

export async function collectHydrology(
  lat: number,
  lon: number,
  radiusKm: number,
  asOf?: string,
): Promise<HydrologyResponse> {
  const wide = boundsAround(lat, lon, radiusKm);
  const inner = boundsAround(lat, lon, Math.min(radiusKm, 1.6));

  const [osm, nhd, elevations] = await Promise.all([
    // Historic Overpass attic queries 504 on public mirrors; year-matching uses
    // today's NHD plus the gauge reading instead.
    asOf ? Promise.resolve(emptyOsm()) : fetchOsm(wide, inner),
    fetchNhd(wide),
    Promise.all(
      [
        [lat, lon],
        [wide.north, wide.west],
        [wide.north, wide.east],
        [wide.south, wide.west],
        [wide.south, wide.east],
      ].map(([y, x]) => sampleElevation(y, x)),
    ),
  ]);

  // A dated query uses the channels OSM had on that capture day, so the drawn
  // network can follow what the aerial actually shows. Today's map still prefers
  // NHD inside the US, where it is denser than OSM.
  const flowlines =
    asOf && osm.flowlines.length >= 4 ? osm.flowlines : nhd.length >= 4 ? nhd : osm.flowlines;
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
    center: { lat, lon },
    radiusKm,
    flowlines: { type: "FeatureCollection", features: flowlines },
    waterbodies: { type: "FeatureCollection", features: osm.waterbodies },
    wetlands: { type: "FeatureCollection", features: osm.wetlands },
    buildings: { type: "FeatureCollection", features: osm.buildings },
    roads: { type: "FeatureCollection", features: osm.roads },
    asOf,
    stats: {
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
      namedChannels: [...named].sort().slice(0, 12),
      sources: [...sources],
      elevationRange: knownElevations.length
        ? [
            Number(Math.min(...knownElevations).toFixed(1)),
            Number(Math.max(...knownElevations).toFixed(1)),
          ]
        : null,
    },
  };
}
