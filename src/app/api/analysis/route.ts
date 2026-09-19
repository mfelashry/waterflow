import { NextResponse } from "next/server";
import type { AnalysisResult, HydrologyStats } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type AnalysisRequest = {
  place: { name: string; detail: string; lat: number; lon: number };
  stats: HydrologyStats;
  imageryYears: number[];
  streamflow?: {
    gauge: string;
    median: number;
    reading: { date: string; discharge: number; percentile: number; ratioToMedian: number } | null;
  } | null;
};

const XAI_ENDPOINT = "https://api.x.ai/v1/chat/completions";

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

/** Deterministic read of the measured layers, used when no xAI key is configured. */
function localAnalysis(body: AnalysisRequest): AnalysisResult {
  const { place, stats, imageryYears } = body;
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
      : "a single capture";

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
        body: body.streamflow?.reading
          ? `The nearest USGS gauge, ${body.streamflow.gauge}, recorded ${body.streamflow.reading.discharge} ft³/s on ${body.streamflow.reading.date}, ${
              body.streamflow.reading.ratioToMedian >= 1
                ? `${body.streamflow.reading.ratioToMedian.toFixed(2)} times its median`
                : `${(1 / body.streamflow.reading.ratioToMedian).toFixed(2)} times below its median`
            } of ${body.streamflow.median} ft³/s. Channel widths on the map are scaled to this discharge, so switching capture years redraws the network at the flow the river was actually carrying that day.`
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
  const density = drainageDensity(body.stats, 3).toFixed(2);

  const prompt = `Site: ${body.place.name} (${body.place.detail})
Coordinates: ${body.place.lat.toFixed(5)}, ${body.place.lon.toFixed(5)}
Mapped channel segments: ${body.stats.channelCount}
Total channel length: ${body.stats.channelKm} km
Drainage density: ${density} km/km^2
Named channels: ${body.stats.namedChannels.join(", ") || "none"}
Waterbodies: ${body.stats.waterbodyCount}
Wetland polygons: ${body.stats.wetlandCount}
Building footprints: ${body.stats.buildingCount}
Mapped roadway: ${body.stats.impervousKm} km
Elevation samples: ${body.stats.elevationRange ? body.stats.elevationRange.join(" to ") + " m" : "unavailable"}
Aerial imagery epochs: ${body.imageryYears.join(", ") || "unknown"}
Data sources: ${body.stats.sources.join(", ") || "OpenStreetMap"}
${
  body.streamflow?.reading
    ? `Nearest USGS gauge: ${body.streamflow.gauge}
Measured discharge on ${body.streamflow.reading.date}: ${body.streamflow.reading.discharge} cubic feet per second
Gauge median discharge: ${body.streamflow.median} cubic feet per second
That day sits at the ${Math.round(body.streamflow.reading.percentile * 100)}th percentile of the gauge record`
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

  const parsed = JSON.parse(content) as Omit<AnalysisResult, "model" | "generatedBy">;
  return { ...parsed, model, generatedBy: "xai" };
}

export async function POST(request: Request) {
  let body: AnalysisRequest;
  try {
    body = (await request.json()) as AnalysisRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const apiKey = process.env.XAI_API_KEY;
  if (apiKey) {
    try {
      return NextResponse.json(await xaiAnalysis(body, apiKey));
    } catch (error) {
      console.warn("xAI analysis failed, using local model:", error);
    }
  }
  return NextResponse.json(localAnalysis(body));
}
