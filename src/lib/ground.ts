/** Site ground context: SSURGO soil + FEMA flood zone + simple flood outlook. */

export type SoilSummary = {
  mapUnit: string;
  component: string;
  hydrologicGroup: string | null;
  drainageClass: string | null;
  taxonomy: string | null;
  /** Available water storage 0-150 cm (cm). */
  availableWaterCm: number | null;
  /** Saturated conductivity of the surface horizon (µm/s). */
  ksatUmPerSec: number | null;
  sandPct: number | null;
  clayPct: number | null;
  organicMatterPct: number | null;
  infiltrationLabel: string;
  infiltrationNote: string;
  source: string;
};

export type FloodLevel = "coastal" | "base" | "moderate" | "minimal" | "undetermined";

export type FloodZone = {
  zone: string;
  subtype: string | null;
  specialFloodHazardArea: boolean;
  /** FEMA flood level bucket used for map coloring and the legend. */
  floodLevel: FloodLevel;
  label: string;
};

export type FloodOutlook = {
  level: "low" | "moderate" | "elevated" | "high";
  headline: string;
  body: string;
  drivers: string[];
};

export type GroundSummary = {
  coordinates: { lat: number; lon: number };
  soil: SoilSummary | null;
  floodZone: FloodZone | null;
  floodPolygons: GeoJSON.FeatureCollection;
  outlook: FloodOutlook;
  surfaceWater: {
    waterbodyCount: number;
    wetlandCount: number;
    namedChannels: string[];
    note: string;
  };
  sources: string[];
};

type SdaTable = { Table?: (string | number | null)[][] };

const HYDRO_GROUP_NOTE: Record<string, { label: string; note: string }> = {
  A: {
    label: "Fast infiltration",
    note: "Sandy / gravelly soils (Group A) take water in quickly and produce little runoff.",
  },
  B: {
    label: "Moderate infiltration",
    note: "Loamy soils (Group B) absorb stormwater at a moderate rate.",
  },
  C: {
    label: "Slow infiltration",
    note: "Fine soils (Group C) restrict downward flow - more water runs off into channels.",
  },
  D: {
    label: "Very slow infiltration",
    note: "Clay-heavy or high water-table soils (Group D) shed most rainfall as runoff.",
  },
};

function hydroNote(group: string | null) {
  if (!group) {
    return {
      label: "Infiltration unknown",
      note: "No SSURGO hydrologic soil group is published for this point.",
    };
  }
  const key = group.replace(/\s+/g, "").split("/")[0]?.toUpperCase() ?? "";
  const dual = group.includes("/");
  const base = HYDRO_GROUP_NOTE[key] ?? {
    label: `Group ${group}`,
    note: `Hydrologic soil group ${group} from USDA SSURGO.`,
  };
  if (dual) {
    return {
      label: base.label,
      note: `${base.note} Dual rating ${group} means drained vs undrained behavior differs.`,
    };
  }
  return base;
}

function classifyFloodLevel(
  zone: string,
  subtype: string | null,
  sfha: boolean,
): FloodLevel {
  const z = zone.toUpperCase();
  if (z === "VE" || z === "V" || z === "VO") return "coastal";
  if (sfha || z.startsWith("A")) return "base";
  if (z === "X" && /0\.2|500/i.test(subtype ?? "")) return "moderate";
  if (z === "D" || !z) return "undetermined";
  return "minimal";
}

function zoneLabel(zone: string, subtype: string | null, sfha: boolean): string {
  const level = classifyFloodLevel(zone, subtype, sfha);
  if (level === "coastal") return "Coastal high-velocity flood (V / VE)";
  if (level === "base") return `1% annual-chance flood (100-year, Zone ${zone})`;
  if (level === "moderate") return "0.2% annual-chance flood (500-year)";
  if (level === "undetermined") return "Flood hazard undetermined (Zone D)";
  return "Minimal flood hazard (Zone X)";
}

export const FLOOD_LEVEL_META: Record<
  FloodLevel,
  { label: string; color: string; short: string }
> = {
  coastal: { label: "Coastal / high velocity", color: "#9f1239", short: "V / VE" },
  base: { label: "100-year floodplain (1%)", color: "#dc2626", short: "A / AE" },
  moderate: { label: "500-year flood hazard (0.2%)", color: "#ea580c", short: "X shaded" },
  minimal: { label: "Minimal flood hazard", color: "#ca8a04", short: "X" },
  undetermined: { label: "Undetermined", color: "#a8a29e", short: "D" },
};

function outlookLevel(
  flood: FloodZone | null,
  soil: SoilSummary | null,
  gaugePercentile: number | null,
): FloodOutlook {
  let score = 0;
  const drivers: string[] = [];

  if (flood?.specialFloodHazardArea) {
    score += 3;
    drivers.push(`Inside FEMA SFHA (${flood.zone})`);
  } else if (flood && /0\.2|500/i.test(flood.subtype ?? "")) {
    score += 1.5;
    drivers.push("Inside 0.2% annual-chance flood hazard");
  } else if (flood?.zone === "X") {
    drivers.push("Outside mapped special flood hazard area");
  } else if (!flood) {
    drivers.push("No FEMA flood polygon returned at this point (common outside mapped communities)");
  }

  const group = soil?.hydrologicGroup?.replace(/\s+/g, "").split("/")[0]?.toUpperCase();
  if (group === "D") {
    score += 1.5;
    drivers.push("Very slow soil infiltration (Group D)");
  } else if (group === "C") {
    score += 1;
    drivers.push("Slow soil infiltration (Group C)");
  } else if (group === "A") {
    score -= 0.5;
    drivers.push("Fast-draining soils reduce runoff");
  } else if (group === "B") {
    drivers.push("Moderate soil infiltration");
  }

  if (gaugePercentile != null) {
    if (gaugePercentile >= 0.9) {
      score += 2;
      drivers.push(`Nearby gauge at ${Math.round(gaugePercentile * 100)}th percentile discharge`);
    } else if (gaugePercentile >= 0.75) {
      score += 1;
      drivers.push(`Nearby gauge elevated (${Math.round(gaugePercentile * 100)}th percentile)`);
    } else if (gaugePercentile <= 0.25) {
      score -= 0.5;
      drivers.push(`Nearby gauge below typical (${Math.round(gaugePercentile * 100)}th percentile)`);
    } else {
      drivers.push(`Nearby gauge near normal (${Math.round(gaugePercentile * 100)}th percentile)`);
    }
  }

  const level: FloodOutlook["level"] =
    score >= 4 ? "high" : score >= 2.5 ? "elevated" : score >= 1.2 ? "moderate" : "low";

  const headlines: Record<FloodOutlook["level"], string> = {
    low: "Flood pressure looks limited right now",
    moderate: "Moderate flood watchfulness at this site",
    elevated: "Elevated flood sensitivity",
    high: "High flood-runoff pressure",
  };

  const bodies: Record<FloodOutlook["level"], string> = {
    low: "Mapped flood hazard is limited and soils / flows are not stacking toward a flood signal. Still illustrative - not a forecast.",
    moderate: "Some combination of floodplain proximity, soil runoff, or gauge stage suggests you should watch water levels here.",
    elevated: "FEMA mapping and/or wet soils / high gauge flow point to meaningful flood sensitivity at this site.",
    high: "Special flood hazard area and/or very high measured flow stack with runoff-prone soils. Treat as exploration context only.",
  };

  return {
    level,
    headline: headlines[level],
    body: bodies[level],
    drivers,
  };
}

async function querySoil(lat: number, lon: number): Promise<SoilSummary | null> {
  const sql = `SELECT TOP 1
    mu.mukey, mu.muname, co.compname, co.comppct_r, co.hydgrp, co.drainagecl,
    co.taxclname, ch.aws0150wta, hz.ksat_r, hz.claytotal_r, hz.sandtotal_r, hz.om_r
  FROM mapunit mu
  INNER JOIN component co ON mu.mukey = co.mukey AND co.majcompflag = 'Yes'
  LEFT JOIN muaggatt ch ON mu.mukey = ch.mukey
  OUTER APPLY (
    SELECT TOP 1 ksat_r, claytotal_r, sandtotal_r, om_r
    FROM chorizon WHERE cokey = co.cokey ORDER BY hzdept_r ASC
  ) hz
  WHERE mu.mukey IN (
    SELECT TOP 1 * FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('POINT(${lon} ${lat})')
  )
  ORDER BY co.comppct_r DESC`;

  try {
    const res = await fetch("https://SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ query: sql, format: "JSON+COLUMNNAME" }),
      next: { revalidate: 86400 },
    });
    if (!res.ok) throw new Error(`SDA ${res.status}`);
    const json = (await res.json()) as SdaTable;
    const table = json.Table;
    if (!table || table.length < 2) return null;
    const headers = table[0].map((h) => String(h).toLowerCase());
    const row = table[1];
    const get = (name: string) => {
      const i = headers.indexOf(name);
      return i >= 0 ? row[i] : null;
    };
    const num = (name: string) => {
      const raw = get(name);
      const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? ""));
      return Number.isFinite(n) ? n : null;
    };
    const hydgrp = get("hydgrp") != null ? String(get("hydgrp")) : null;
    const note = hydroNote(hydgrp);
    return {
      mapUnit: String(get("muname") ?? "Unknown map unit"),
      component: String(get("compname") ?? "Unknown"),
      hydrologicGroup: hydgrp,
      drainageClass: get("drainagecl") != null ? String(get("drainagecl")) : null,
      taxonomy: get("taxclname") != null ? String(get("taxclname")) : null,
      availableWaterCm: num("aws0150wta"),
      ksatUmPerSec: num("ksat_r"),
      sandPct: num("sandtotal_r"),
      clayPct: num("claytotal_r"),
      organicMatterPct: num("om_r"),
      infiltrationLabel: note.label,
      infiltrationNote: note.note,
      source: "USDA SSURGO via Soil Data Access",
    };
  } catch (error) {
    console.warn("SSURGO query failed:", error);
    return null;
  }
}

async function queryFlood(
  lat: number,
  lon: number,
): Promise<{
  zone: FloodZone | null;
  polygons: GeoJSON.FeatureCollection;
}> {
  const pad = 0.035;
  const envelope = {
    xmin: lon - pad,
    ymin: lat - pad,
    xmax: lon + pad,
    ymax: lat + pad,
  };

  const pointUrl = new URL(
    "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query",
  );
  pointUrl.searchParams.set("geometry", `${lon},${lat}`);
  pointUrl.searchParams.set("geometryType", "esriGeometryPoint");
  pointUrl.searchParams.set("inSR", "4326");
  pointUrl.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  pointUrl.searchParams.set("outFields", "FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE");
  pointUrl.searchParams.set("returnGeometry", "false");
  pointUrl.searchParams.set("f", "json");

  const polyUrl = new URL(
    "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query",
  );
  polyUrl.searchParams.set("geometry", JSON.stringify(envelope));
  polyUrl.searchParams.set("geometryType", "esriGeometryEnvelope");
  polyUrl.searchParams.set("inSR", "4326");
  polyUrl.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  polyUrl.searchParams.set("outFields", "FLD_ZONE,ZONE_SUBTY,SFHA_TF");
  polyUrl.searchParams.set("returnGeometry", "true");
  polyUrl.searchParams.set("outSR", "4326");
  polyUrl.searchParams.set("f", "geojson");
  polyUrl.searchParams.set("resultRecordCount", "40");

  let zone: FloodZone | null = null;
  let polygons: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

  try {
    const [pointRes, polyRes] = await Promise.all([
      fetch(pointUrl, { next: { revalidate: 86400 } }),
      fetch(polyUrl, { next: { revalidate: 86400 } }),
    ]);

    if (pointRes.ok) {
      const pointJson = (await pointRes.json()) as {
        features?: { attributes: Record<string, string | number | null> }[];
      };
      const attrs = pointJson.features?.[0]?.attributes;
      if (attrs) {
        const fld = String(attrs.FLD_ZONE ?? "X");
        const subtype = attrs.ZONE_SUBTY != null ? String(attrs.ZONE_SUBTY) : null;
        const sfha = String(attrs.SFHA_TF ?? "").toUpperCase() === "T";
        const floodLevel = classifyFloodLevel(fld, subtype, sfha);
        zone = {
          zone: fld,
          subtype,
          specialFloodHazardArea: sfha,
          floodLevel,
          label: zoneLabel(fld, subtype, sfha),
        };
      }
    }

    if (polyRes.ok) {
      const geo = (await polyRes.json()) as GeoJSON.FeatureCollection;
      const features = (geo.features ?? []).map((feature) => {
        const props = feature.properties ?? {};
        const fld = String(props.FLD_ZONE ?? props.fld_zone ?? "X");
        const subtype =
          props.ZONE_SUBTY != null
            ? String(props.ZONE_SUBTY)
            : props.zone_subty != null
              ? String(props.zone_subty)
              : null;
        const sfha = String(props.SFHA_TF ?? props.sfha_tf ?? "")
          .toUpperCase()
          .startsWith("T");
        const floodLevel = classifyFloodLevel(fld, subtype, sfha);
        return {
          ...feature,
          properties: {
            ...props,
            zone: fld,
            sfha,
            floodLevel,
          },
        };
      });
      polygons = {
        type: "FeatureCollection",
        features,
      };
    }
  } catch (error) {
    console.warn("FEMA NFHL query failed:", error);
  }

  return { zone, polygons };
}

export async function loadGround(input: {
  lat: number;
  lon: number;
  waterbodyCount?: number;
  wetlandCount?: number;
  namedChannels?: string[];
  gaugePercentile?: number | null;
}): Promise<GroundSummary> {
  const [soil, flood] = await Promise.all([
    querySoil(input.lat, input.lon),
    queryFlood(input.lat, input.lon),
  ]);

  const surfaceWater = {
    waterbodyCount: input.waterbodyCount ?? 0,
    wetlandCount: input.wetlandCount ?? 0,
    namedChannels: input.namedChannels ?? [],
    note:
      (input.waterbodyCount ?? 0) + (input.wetlandCount ?? 0) > 0
        ? "Surface water comes from USGS NHD / OpenStreetMap waterbodies and wetlands already loaded for this site."
        : "No mapped lakes, ponds, or wetlands in the study radius - channel flow may still be present.",
  };

  const outlook = outlookLevel(flood.zone, soil, input.gaugePercentile ?? null);
  const sources = [
    soil ? "USDA SSURGO" : null,
    flood.zone || flood.polygons.features.length ? "FEMA NFHL" : null,
    "USGS NHD / OpenStreetMap (surface water)",
    "USGS topo / Mapzen terrain (elevation)",
  ].filter(Boolean) as string[];

  return {
    coordinates: { lat: input.lat, lon: input.lon },
    soil,
    floodZone: flood.zone,
    floodPolygons: flood.polygons,
    outlook,
    surfaceWater,
    sources,
  };
}
