import { NextResponse } from "next/server";
import { cityContext, type CityContext } from "@/lib/city";
import type { AnalysisResult, HydrologyStats } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type ReportRequest = {
  place: { name: string; detail: string; lat: number; lon: number };
  stats: HydrologyStats;
  imageryYears: number[];
  wettestYear?: number | null;
  driestYear?: number | null;
  rainByYear?: { year: number; precipMm: number }[];
  streamflow?: {
    gauge: string;
    median: number;
    reading: { date: string; discharge: number; percentile: number; ratioToMedian: number } | null;
  } | null;
  analysis?: AnalysisResult | null;
  ground?: {
    soil?: {
      mapUnit: string;
      component: string;
      hydrologicGroup: string | null;
      drainageClass: string | null;
      infiltrationLabel: string;
      infiltrationNote: string;
      ksatUmPerSec: number | null;
      availableWaterCm: number | null;
      sandPct: number | null;
      clayPct: number | null;
    } | null;
    floodZone?: {
      zone: string;
      subtype: string | null;
      specialFloodHazardArea: boolean;
      floodLevel: string;
      label: string;
    } | null;
    outlook?: {
      level: string;
      headline: string;
      body: string;
      drivers: string[];
    } | null;
    surfaceWater?: {
      waterbodyCount: number;
      wetlandCount: number;
      namedChannels: string[];
      note: string;
    } | null;
    sources?: string[];
  } | null;
};

export type CityReport = {
  title: string;
  subtitle: string;
  generatedAt: string;
  coordinates: { lat: number; lon: number };
  city: {
    name: string;
    description: string | null;
    blurb: string;
    population: number | null;
    river: string | null;
    country: string | null;
    areaKm2: number | null;
    sourceUrl: string | null;
    thumbnailUrl: string | null;
  } | null;
  headline: string;
  summary: string;
  riskLevel: AnalysisResult["riskLevel"];
  sections: { heading: string; body: string }[];
  metrics: { label: string; value: string }[];
  rainTable: { year: number; precipMm: number; note: string }[];
  namedChannels: string[];
  dataSources: string[];
  model: string;
  generatedBy: "xai" | "local";
  flood?: {
    zoneLabel: string | null;
    floodLevel: string | null;
    sfha: boolean;
    outlookHeadline: string | null;
    outlookBody: string | null;
    drivers: string[];
  } | null;
  soil?: {
    mapUnit: string;
    component: string;
    hydrologicGroup: string | null;
    drainageClass: string | null;
    infiltrationLabel: string;
    infiltrationNote: string;
    details: string;
  } | null;
};

const XAI_ENDPOINT = "https://api.x.ai/v1/chat/completions";

function drainageDensity(stats: HydrologyStats, radiusKm: number) {
  return stats.channelKm / (Math.PI * radiusKm ** 2);
}

function rainTable(body: ReportRequest) {
  return (body.rainByYear ?? [])
    .slice()
    .sort((a, b) => a.year - b.year)
    .map((item) => ({
      year: item.year,
      precipMm: item.precipMm,
      note:
        item.year === body.wettestYear
          ? "wettest among imagery years"
          : item.year === body.driestYear
            ? "driest among imagery years"
            : "",
    }));
}

function localReport(body: ReportRequest, city: CityContext | null): CityReport {
  const analysis = body.analysis;
  const density = drainageDensity(body.stats, 3);
  const elev = body.stats.elevationRange;
  const relief = elev ? elev[1] - elev[0] : null;

  const wikipediaSection = city
    ? [
        city.description ? `${city.title} - ${city.description}.` : `${city.title}.`,
        city.extract,
        [
          city.population != null ? `Population about ${city.population.toLocaleString()}.` : null,
          city.areaKm2 != null ? `Area about ${city.areaKm2.toLocaleString()} km².` : null,
          city.country ? `Country: ${city.country}.` : null,
          city.river ? `Associated watercourse in Wikidata: ${city.river}.` : null,
          city.url ? `Source: ${city.url}` : null,
        ]
          .filter(Boolean)
          .join(" "),
      ]
        .filter(Boolean)
        .join("\n\n")
    : `${body.place.name} (${body.place.detail || "unspecified region"}) sits at ${body.place.lat.toFixed(5)}°, ${body.place.lon.toFixed(5)}°. No Wikipedia article matched this place name for the report.`;

  const gaugeSection = body.streamflow?.reading
    ? `The nearest USGS gauge, ${body.streamflow.gauge}, recorded ${body.streamflow.reading.discharge.toLocaleString()} ft³/s on ${body.streamflow.reading.date}. That day sits at the ${Math.round(body.streamflow.reading.percentile * 100)}th percentile of the gauge record and is ${body.streamflow.reading.ratioToMedian.toFixed(2)}× the median discharge of ${body.streamflow.median.toLocaleString()} ft³/s. Channel widths on the map are scaled to this measured flow.`
    : "No USGS stream gauge with a daily discharge record covering the imagery dates sits near this site. Channel widths use the default scale.";

  const rainYears = rainTable(body);
  const rainSection = rainYears.length
    ? `Open-Meteo ERA5 archive totals for the imagery years: ${rainYears
        .map((item) => `${item.year} = ${Math.round(item.precipMm)} mm${item.note ? ` (${item.note})` : ""}`)
        .join("; ")}. Wettest year among these captures is ${body.wettestYear ?? "n/a"}; driest is ${body.driestYear ?? "n/a"}. Switch the map to those years to compare how wet or dry the landscape looked from orbit.`
    : "Annual precipitation for the imagery years was unavailable at this coordinate.";

  const ground = body.ground;
  const floodSection = ground?.floodZone
    ? `FEMA National Flood Hazard Layer at the pin: ${ground.floodZone.label} (zone ${ground.floodZone.zone}${ground.floodZone.subtype ? `, ${ground.floodZone.subtype}` : ""}). Special Flood Hazard Area: ${ground.floodZone.specialFloodHazardArea ? "yes" : "no"}. Flood-level bucket used on the map: ${ground.floodZone.floodLevel}. ${ground.outlook ? `${ground.outlook.headline}. ${ground.outlook.body} Drivers: ${ground.outlook.drivers.join("; ") || "none listed"}.` : ""} This is illustrative context from public FEMA polygons - not a flood insurance rate map determination.`
    : ground?.outlook
      ? `${ground.outlook.headline}. ${ground.outlook.body} Drivers: ${ground.outlook.drivers.join("; ") || "none listed"}. No FEMA zone attribute was returned at this exact coordinate (common outside mapped communities or outside the US).`
      : "FEMA flood-zone lookup returned no zone at this coordinate. Outside the US this is expected; inside the US it can mean the point sits outside published NFHL coverage.";

  const soilSection = ground?.soil
    ? `USDA SSURGO map unit: ${ground.soil.mapUnit}. Component: ${ground.soil.component}.${ground.soil.hydrologicGroup ? ` Hydrologic soil group ${ground.soil.hydrologicGroup}.` : ""}${ground.soil.drainageClass ? ` Drainage: ${ground.soil.drainageClass}.` : ""} Infiltration reading: ${ground.soil.infiltrationLabel}. ${ground.soil.infiltrationNote}${ground.soil.ksatUmPerSec != null ? ` Saturated conductivity about ${ground.soil.ksatUmPerSec} µm/s.` : ""}${ground.soil.availableWaterCm != null ? ` Available water storage (0-150 cm) about ${ground.soil.availableWaterCm} cm.` : ""}${ground.soil.sandPct != null || ground.soil.clayPct != null ? ` Texture approx. ${ground.soil.sandPct ?? "-"}% sand / ${ground.soil.clayPct ?? "-"}% clay.` : ""}`
    : "No SSURGO soil map unit at this point (common outside the United States). Runoff character is inferred from mapped channels and climate only.";

  const surfaceSection = ground?.surfaceWater
    ? `${ground.surfaceWater.note} Count in the study radius: ${ground.surfaceWater.waterbodyCount} waterbodies and ${ground.surfaceWater.wetlandCount} wetlands. Named channels used for context: ${ground.surfaceWater.namedChannels.join(", ") || body.stats.namedChannels.join(", ") || "none"}.`
    : `Mapped network lists ${body.stats.waterbodyCount} waterbodies and ${body.stats.wetlandCount} wetlands alongside ${body.stats.channelCount} channel segments.`;

  const sections = [
    {
      heading: "Wikipedia - place context",
      body: wikipediaSection,
    },
    {
      heading: "Site overview",
      body: `Within a 3 km study radius of ${body.place.name}, the mapped network contains ${body.stats.channelCount} channel segments totalling ${body.stats.channelKm.toFixed(1)} km (drainage density ${density.toFixed(2)} km/km²). Named channels: ${body.stats.namedChannels.join(", ") || "none recorded"}. Data sources for channels: ${body.stats.sources.join(", ") || "OpenStreetMap"}. Channels are filtered to real StreamRiver / Canal features (USGS NHD) or named OSM waterways so artificial harbor paths and unnamed drains are not drawn as rivers.`,
    },
    {
      heading: "Flood levels & outlook",
      body: floodSection,
    },
    {
      heading: "Soil & infiltration",
      body: soilSection,
    },
    {
      heading: "Surface water inventory",
      body: surfaceSection,
    },
    ...(analysis?.sections ?? []).map((section) => ({
      heading: section.heading,
      body: section.body,
    })),
    {
      heading: "Terrain & elevation",
      body: elev
        ? `Elevation samples across the site range from ${elev[0]} m to ${elev[1]} m (${relief?.toFixed(1)} m of relief). Steeper relief shortens the time of concentration; flatter sites store more water on the surface before it reaches a channel.`
        : "USGS elevation samples were not available for this coordinate (common outside the United States).",
    },
    {
      heading: "Built surface & natural storage",
      body: `${body.stats.buildingCount.toLocaleString()} building footprints and ${body.stats.impervousKm.toFixed(1)} km of mapped roadway sit in the inner study area. ${body.stats.waterbodyCount} waterbodies and ${body.stats.wetlandCount} wetland polygons provide natural attenuation. Roofs and pavement convert rainfall to runoff almost immediately; wetlands and open water buffer peaks.`,
    },
    {
      heading: "Measured streamflow",
      body: gaugeSection,
    },
    {
      heading: "Wet vs dry years (Open-Meteo + imagery)",
      body: rainSection,
    },
    {
      heading: "Imagery archive",
      body: body.imageryYears.length
        ? `Distinct Esri World Imagery Wayback captures that actually changed at this tile are available for: ${body.imageryYears.join(", ")}. Each year in the panel was fingerprint-checked so identical re-releases are not listed.`
        : "No distinct Wayback imagery years were resolved for this site.",
    },
    {
      heading: "What to watch",
      body: analysis?.sections?.find((section) => /watch|risk|change/i.test(section.heading))?.body
        ?? `Compare the wettest (${body.wettestYear ?? "n/a"}) and driest (${body.driestYear ?? "n/a"}) captures over the highlighted channels. Look for new roofs or pavement near intermittent reaches, channel straightening, and wetland fill. Risk level for runoff pressure on this briefing: ${analysis?.riskLevel ?? ground?.outlook?.level ?? "moderate"}.`,
    },
  ];

  const floodBlock = ground?.floodZone || ground?.outlook
    ? {
        zoneLabel: ground.floodZone?.label ?? null,
        floodLevel: ground.floodZone?.floodLevel ?? null,
        sfha: Boolean(ground.floodZone?.specialFloodHazardArea),
        outlookHeadline: ground.outlook?.headline ?? null,
        outlookBody: ground.outlook?.body ?? null,
        drivers: ground.outlook?.drivers ?? [],
      }
    : null;

  const soilBlock = ground?.soil
    ? {
        mapUnit: ground.soil.mapUnit,
        component: ground.soil.component,
        hydrologicGroup: ground.soil.hydrologicGroup,
        drainageClass: ground.soil.drainageClass,
        infiltrationLabel: ground.soil.infiltrationLabel,
        infiltrationNote: ground.soil.infiltrationNote,
        details: [
          ground.soil.ksatUmPerSec != null ? `Ksat ${ground.soil.ksatUmPerSec} µm/s` : null,
          ground.soil.availableWaterCm != null ? `AWS ${ground.soil.availableWaterCm} cm` : null,
          ground.soil.sandPct != null ? `Sand ${ground.soil.sandPct}%` : null,
          ground.soil.clayPct != null ? `Clay ${ground.soil.clayPct}%` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      }
    : null;

  return {
    title: `Water Flow site briefing - ${body.place.name}`,
    subtitle: body.place.detail || "Hydrology, flood levels, soil, climate years, and place context",
    generatedAt: new Date().toISOString(),
    coordinates: { lat: body.place.lat, lon: body.place.lon },
    city: city
      ? {
          name: city.title,
          description: city.description,
          blurb: city.extract,
          population: city.population,
          river: city.river,
          country: city.country,
          areaKm2: city.areaKm2,
          sourceUrl: city.url,
          thumbnailUrl: city.thumbnailUrl,
        }
      : null,
    headline: analysis?.headline ?? `${body.place.name}: ${body.stats.channelCount} mapped channels across ${body.stats.channelKm} km`,
    summary:
      analysis?.summary ??
      `A ${density.toFixed(2)} km/km² drainage network around ${body.place.name}${ground?.floodZone ? `, FEMA ${ground.floodZone.label}` : ""}${ground?.soil ? `, soils ${ground.soil.infiltrationLabel.toLowerCase()}` : ""}.`,
    riskLevel: analysis?.riskLevel ?? ((ground?.outlook?.level as AnalysisResult["riskLevel"]) || "moderate"),
    sections,
    metrics: [
      { label: "Channels", value: String(body.stats.channelCount) },
      { label: "Channel length", value: `${body.stats.channelKm} km` },
      { label: "Drainage density", value: `${density.toFixed(2)} km/km²` },
      { label: "Waterbodies", value: String(body.stats.waterbodyCount) },
      { label: "Wetlands", value: String(body.stats.wetlandCount) },
      { label: "Flood zone", value: ground?.floodZone?.zone ?? "-" },
      { label: "Flood level", value: ground?.floodZone?.floodLevel ?? "-" },
      { label: "SFHA", value: ground?.floodZone ? (ground.floodZone.specialFloodHazardArea ? "Yes" : "No") : "-" },
      { label: "Soil group", value: ground?.soil?.hydrologicGroup ?? "-" },
      { label: "Infiltration", value: ground?.soil?.infiltrationLabel ?? "-" },
      { label: "Buildings", value: body.stats.buildingCount.toLocaleString() },
      { label: "Roadway", value: `${body.stats.impervousKm} km` },
      {
        label: "Elevation",
        value: elev ? `${elev[0]}-${elev[1]} m` : "-",
      },
      { label: "Wettest year", value: body.wettestYear ? String(body.wettestYear) : "-" },
      { label: "Driest year", value: body.driestYear ? String(body.driestYear) : "-" },
      {
        label: "Population",
        value: city?.population != null ? city.population.toLocaleString() : "-",
      },
      { label: "Outlook", value: (ground?.outlook?.level ?? analysis?.riskLevel ?? "moderate").toUpperCase() },
    ],
    rainTable: rainYears,
    namedChannels: body.stats.namedChannels,
    dataSources: [
      ...body.stats.sources,
      "Open-Meteo Archive",
      "Esri World Imagery Wayback",
      city ? "Wikipedia / Wikidata" : null,
      body.streamflow?.reading ? "USGS NWIS" : null,
      "USGS EPQS",
      ...(ground?.sources ?? []),
    ].filter((value, index, list): value is string => Boolean(value) && list.indexOf(value) === index),
    model: analysis?.model ?? "hydroscope-local",
    generatedBy: analysis?.generatedBy ?? "local",
    flood: floodBlock,
    soil: soilBlock,
  };
}

async function xaiReport(
  body: ReportRequest,
  city: CityContext | null,
  apiKey: string,
): Promise<CityReport> {
  const model = process.env.XAI_MODEL || "grok-4-latest";
  const rain =
    body.rainByYear?.map((item) => `${item.year}: ${item.precipMm} mm`).join("; ") ?? "none";
  const base = localReport(body, city);

  const prompt = `Write a detailed multi-section city water briefing.

Place: ${body.place.name} (${body.place.detail})
Coordinates: ${body.place.lat}, ${body.place.lon}
Channels: ${body.stats.channelCount} segments, ${body.stats.channelKm} km
Named channels: ${body.stats.namedChannels.join(", ") || "none"}
Waterbodies: ${body.stats.waterbodyCount}, wetlands: ${body.stats.wetlandCount}
Buildings: ${body.stats.buildingCount}, roadway: ${body.stats.impervousKm} km
Elevation: ${body.stats.elevationRange ? body.stats.elevationRange.join(" to ") + " m" : "n/a"}
FEMA flood: ${
    body.ground?.floodZone
      ? `${body.ground.floodZone.label}; SFHA=${body.ground.floodZone.specialFloodHazardArea}; level=${body.ground.floodZone.floodLevel}`
      : "unmapped / unavailable"
  }
Flood outlook: ${body.ground?.outlook ? `${body.ground.outlook.headline}. ${body.ground.outlook.body}` : "n/a"}
Soil: ${
    body.ground?.soil
      ? `${body.ground.soil.mapUnit}; ${body.ground.soil.infiltrationLabel}; group ${body.ground.soil.hydrologicGroup ?? "n/a"}`
      : "n/a"
  }
Imagery years: ${body.imageryYears.join(", ") || "n/a"}
Wettest year: ${body.wettestYear ?? "n/a"}; driest: ${body.driestYear ?? "n/a"}
Annual rain (mm): ${rain}
Gauge: ${
    body.streamflow?.reading
      ? `${body.streamflow.gauge}, ${body.streamflow.reading.discharge} cfs on ${body.streamflow.reading.date} (${body.streamflow.reading.ratioToMedian}× median)`
      : "none"
  }
Wikipedia title: ${city?.title ?? "unavailable"}
Wikipedia description: ${city?.description ?? "n/a"}
Wikipedia extract: ${city?.extract ?? "unavailable"}
Population: ${city?.population ?? "n/a"}; country: ${city?.country ?? "n/a"}; river: ${city?.river ?? "n/a"}
Existing analysis: ${body.analysis?.headline ?? "n/a"} - ${body.analysis?.summary ?? "n/a"}

Respond JSON: {"headline":string,"summary":string,"riskLevel":"low"|"moderate"|"elevated"|"high","sections":[{"heading":string,"body":string}]}
Need exactly these section headings in order:
1. Wikipedia - place context
2. Site overview
3. Flood levels & outlook
4. Soil & infiltration
5. Channel network
6. Built surface & runoff
7. Natural attenuation
8. Measured streamflow
9. Wet vs dry years
10. What to watch on the imagery
Each body 70-120 words. Weave the Wikipedia extract into section 1 with concrete facts. Never invent numbers.`;

  const res = await fetch(XAI_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "You are a hydrologist writing a detailed printable briefing for planners and hackathon judges. Use only provided facts. Plain language. Include Wikipedia context in the first section.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) throw new Error(`xAI responded ${res.status}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("empty xAI report");
  const parsed = JSON.parse(content) as {
    headline: string;
    summary: string;
    riskLevel: AnalysisResult["riskLevel"];
    sections: { heading: string; body: string }[];
  };

  // Keep Wikipedia section even if the model shortens it - prepend encyclopedia extract.
  const sections = [...parsed.sections];
  if (city && !sections.some((section) => /wikipedia/i.test(section.heading))) {
    sections.unshift({
      heading: "Wikipedia - place context",
      body: base.sections[0]?.body ?? city.extract,
    });
  } else if (city) {
    const index = sections.findIndex((section) => /wikipedia/i.test(section.heading));
    if (index >= 0 && sections[index].body.length < city.extract.length * 0.5) {
      sections[index] = {
        ...sections[index],
        body: `${city.extract}\n\n${sections[index].body}`,
      };
    }
  }

  return {
    ...base,
    headline: parsed.headline,
    summary: parsed.summary,
    riskLevel: parsed.riskLevel,
    sections,
    model,
    generatedBy: "xai",
  };
}

export async function POST(request: Request) {
  let body: ReportRequest;
  try {
    body = (await request.json()) as ReportRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body.place?.name || !body.stats) {
    return NextResponse.json({ error: "place and stats are required" }, { status: 400 });
  }

  const city = await cityContext(body.place.name, body.place.detail);
  const apiKey = process.env.XAI_API_KEY;

  if (apiKey) {
    try {
      return NextResponse.json(await xaiReport(body, city, apiKey));
    } catch (error) {
      console.warn("xAI city report failed, using local:", error);
    }
  }

  return NextResponse.json(localReport(body, city));
}
