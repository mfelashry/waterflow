import { NextResponse } from "next/server";
import type { AnalysisResult, HydrologyStats } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type AnalysisRequest = {
  place: { name: string; detail: string; lat: number; lon: number };
  stats: HydrologyStats | null;
  imageryYears: number[];
  streamflow?: {
    gauge: string;
    median: number;
    reading: { date: string; discharge: number; percentile: number; ratioToMedian: number } | null;
  } | null;
};

const XAI_ENDPOINT = "https://api.x.ai/v1/chat/completions";

function asNumber(value: unknown, fallback = 0) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeStats(raw: HydrologyStats | null | undefined): HydrologyStats {
  return {
    channelCount: asNumber(raw?.channelCount),
    channelKm: asNumber(raw?.channelKm),
    waterbodyCount: asNumber(raw?.waterbodyCount),
    wetlandCount: asNumber(raw?.wetlandCount),
    buildingCount: asNumber(raw?.buildingCount),
    impervousKm: asNumber(raw?.impervousKm),
    namedChannels: Array.isArray(raw?.namedChannels)
      ? raw.namedChannels.filter((name): name is string => typeof name === "string" && name.length > 0)
      : [],
    sources: Array.isArray(raw?.sources)
      ? raw.sources.filter((name): name is string => typeof name === "string" && name.length > 0)
      : [],
    elevationRange:
      Array.isArray(raw?.elevationRange) &&
      raw.elevationRange.length === 2 &&
      Number.isFinite(raw.elevationRange[0]) &&
      Number.isFinite(raw.elevationRange[1])
        ? [Number(raw.elevationRange[0]), Number(raw.elevationRange[1])]
        : null,
  };
}

function drainageDensity(stats: HydrologyStats, radiusKm: number) {
  const areaKm2 = Math.PI * radiusKm ** 2;
  return stats.channelKm / areaKm2;
}

function riskFrom(stats: HydrologyStats, density: number): AnalysisResult["riskLevel"] {
  const builtPressure = stats.buildingCount / 400 + stats.impervousKm / 25;
  const score = density * 0.9 + builtPressure - stats.wetlandCount * 0.08;
  if (score > 3.2) return "high";
  if (score > 2.1) return "elevated";
  if (score > 1.2) return "moderate";
  return "low";
}

function normalizeRisk(value: unknown): AnalysisResult["riskLevel"] {
  if (value === "low" || value === "moderate" || value === "elevated" || value === "high") {
    return value;
  }
  return "moderate";
}

/** Deterministic read of the measured layers, used when no xAI key is configured. */
function localAnalysis(body: AnalysisRequest): AnalysisResult {
  const place = body.place ?? { name: "This site", detail: "", lat: 0, lon: 0 };
  const stats = normalizeStats(body.stats);
  const imageryYears = Array.isArray(body.imageryYears)
    ? body.imageryYears.filter((year) => Number.isFinite(year))
    : [];
  const density = drainageDensity(stats, 3);
  const risk = riskFrom(stats, density);
  const relief = stats.elevationRange
    ? `${stats.elevationRange[0]} m to ${stats.elevationRange[1]} m (${(
        stats.elevationRange[1] - stats.elevationRange[0]
      ).toFixed(1)} m of relief)`
    : "not available outside the USGS elevation coverage";
  const span =
    imageryYears.length >= 2
      ? `${imageryYears[0]} to ${imageryYears[imageryYears.length - 1]}`
      : imageryYears.length === 1
        ? String(imageryYears[0])
        : "a single capture";

  const reading = body.streamflow?.reading;
  const ratio = reading ? asNumber(reading.ratioToMedian, 1) : 1;

  return {
    headline: `${place.name}: ${stats.channelCount} mapped channels across ${stats.channelKm.toFixed(1)} km`,
    summary: `Within a 3 km radius of ${place.name}, ${stats.sources.join(" and ") || "the mapped network"} records ${
      stats.channelCount
    } channel segments totalling ${stats.channelKm.toFixed(1)} km, a drainage density of ${density.toFixed(
      2,
    )} km per km². Terrain across the site ranges ${relief}. Aerial imagery is available for ${span}.`,
    riskLevel: risk,
    sections: [
      {
        heading: "Channel network",
        body: `${stats.channelCount} segments were extracted${
          stats.namedChannels.length
            ? `, including ${stats.namedChannels.slice(0, 4).join(", ")}`
            : ""
        }. Drainage density of ${density.toFixed(2)} km/km² indicates ${
          density > 2.5
            ? "a finely dissected landscape where rainfall reaches a channel quickly"
            : density > 1.2
              ? "a moderately dissected landscape with measurable channel storage"
              : "a coarse network where overland flow dominates before reaching a channel"
        }.`,
      },
      {
        heading: "Built surface pressure",
        body: `${stats.buildingCount} building footprints and ${stats.impervousKm.toFixed(
          1,
        )} km of roadway sit inside the inner study area. Roofs and pavement convert rainfall to runoff almost immediately, so this figure scales directly with peak discharge in the channels highlighted on the map.`,
      },
      {
        heading: "Natural attenuation",
        body: `${stats.wetlandCount} wetland polygons and ${stats.waterbodyCount} waterbodies were found nearby. ${
          stats.wetlandCount > 0
            ? "These features buffer storm peaks and should be protected in any site plan."
            : "With no mapped wetlands, there is little natural storage between the built surface and the channel network."
        }`,
      },
      {
        heading: "Measured flow",
        body: reading
          ? `The nearest USGS gauge, ${body.streamflow?.gauge ?? "nearby"}, recorded ${asNumber(reading.discharge).toFixed(1)} ft³/s on ${reading.date}, ${
              ratio >= 1
                ? `${ratio.toFixed(2)} times its median`
                : ratio > 0
                  ? `${(1 / ratio).toFixed(2)} times below its median`
                  : "far below its median"
            } of ${asNumber(body.streamflow?.median).toFixed(1)} ft³/s. Channel widths on the map are scaled to this discharge, so switching capture years redraws the network at the flow the river was actually carrying that day.`
          : "No USGS gauge near this site has a record covering the available captures, so channel widths are drawn at their default scale.",
      },
      {
        heading: "Change detection",
        body:
          imageryYears.length >= 2
            ? `Distinct aerial captures exist for ${imageryYears.join(
                ", ",
              )}. Compare the oldest and newest layers over the highlighted channels to see where new roofs, pavement or channel modification appeared.`
            : "Only one distinct aerial capture covers this location, so on-site change cannot be established from imagery alone.",
      },
    ],
    model: "hydroscope-local",
    generatedBy: "local",
  };
}

async function xaiAnalysis(body: AnalysisRequest, apiKey: string): Promise<AnalysisResult> {
  const model = process.env.XAI_MODEL || "grok-4-latest";
  const stats = normalizeStats(body.stats);
  const density = drainageDensity(stats, 3).toFixed(2);
  const imageryYears = Array.isArray(body.imageryYears) ? body.imageryYears : [];

  const prompt = `Site: ${body.place.name} (${body.place.detail})
Coordinates: ${body.place.lat.toFixed(5)}, ${body.place.lon.toFixed(5)}
Mapped channel segments: ${stats.channelCount}
Total channel length: ${stats.channelKm} km
Drainage density: ${density} km/km^2
Named channels: ${stats.namedChannels.join(", ") || "none"}
Waterbodies: ${stats.waterbodyCount}
Wetland polygons: ${stats.wetlandCount}
Building footprints: ${stats.buildingCount}
Mapped roadway: ${stats.impervousKm} km
Elevation samples: ${stats.elevationRange ? stats.elevationRange.join(" to ") + " m" : "unavailable"}
Aerial imagery epochs: ${imageryYears.join(", ") || "unknown"}
Data sources: ${stats.sources.join(", ") || "OpenStreetMap"}
${
  body.streamflow?.reading
    ? `Nearest USGS gauge: ${body.streamflow.gauge}
Measured discharge on ${body.streamflow.reading.date}: ${body.streamflow.reading.discharge} cubic feet per second
Gauge median discharge: ${body.streamflow.median} cubic feet per second
That day sits at the ${Math.round(asNumber(body.streamflow.reading.percentile) * 100)}th percentile of the gauge record`
    : "Nearest USGS gauge: none with a record for these dates"
}`;

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
            "You are a hydrologist reviewing a site for stormwater and runoff risk. Use only the measurements provided; never invent numbers. Respond with JSON matching {\"headline\":string,\"summary\":string,\"riskLevel\":\"low\"|\"moderate\"|\"elevated\"|\"high\",\"sections\":[{\"heading\":string,\"body\":string}]}. Provide four sections covering the channel network, built surface pressure, natural attenuation, and the measured discharge on the selected capture date. Keep each body under 90 words and write plainly.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) throw new Error(`xAI responded ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("xAI returned an empty completion");

  const parsed = JSON.parse(content) as Partial<AnalysisResult>;
  const fallback = localAnalysis({ ...body, stats });
  return {
    headline: typeof parsed.headline === "string" && parsed.headline ? parsed.headline : fallback.headline,
    summary: typeof parsed.summary === "string" && parsed.summary ? parsed.summary : fallback.summary,
    riskLevel: normalizeRisk(parsed.riskLevel),
    sections:
      Array.isArray(parsed.sections) && parsed.sections.length
        ? parsed.sections
            .filter(
              (section): section is { heading: string; body: string } =>
                Boolean(section) &&
                typeof section.heading === "string" &&
                typeof section.body === "string",
            )
            .slice(0, 8)
        : fallback.sections,
    model,
    generatedBy: "xai",
  };
}

export async function POST(request: Request) {
  let body: AnalysisRequest;
  try {
    body = (await request.json()) as AnalysisRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body.place?.name) {
    return NextResponse.json({ error: "place is required" }, { status: 400 });
  }

  const safeBody: AnalysisRequest = {
    place: body.place,
    stats: body.stats ?? null,
    imageryYears: Array.isArray(body.imageryYears) ? body.imageryYears : [],
    streamflow: body.streamflow ?? null,
  };

  const apiKey = process.env.XAI_API_KEY?.trim();
  if (apiKey) {
    try {
      return NextResponse.json(await xaiAnalysis(safeBody, apiKey));
    } catch (error) {
      console.warn("xAI analysis failed, using local model:", error);
    }
  }

  try {
    return NextResponse.json(localAnalysis(safeBody));
  } catch (error) {
    console.error("local analysis failed:", error);
    return NextResponse.json({
      headline: `${safeBody.place.name}: site insight unavailable`,
      summary:
        "The screening map loaded, but the insight brief could not finish reading every measurement. Open Ground or Ask Grok for flood, soil, and local research context, then retry this tab.",
      riskLevel: "moderate" as const,
      sections: [
        {
          heading: "What to do next",
          body: "Use the Ground tab for FEMA flood and soil context, Ask Grok for case studies, and Marimo for charts. Then tap Retry on this insight.",
        },
      ],
      model: "hydroscope-local-fallback",
      generatedBy: "local" as const,
    } satisfies AnalysisResult);
  }
}
