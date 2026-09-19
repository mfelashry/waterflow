import { NextResponse } from "next/server";
import type { FlowReading, HydrologyStats } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type AskRequest = {
  question: string;
  place: { name: string; detail: string; lat: number; lon: number };
  stats: HydrologyStats | null;
  imageryYears: number[];
  streamflow?: { gauge: string; median: number; reading: FlowReading | null } | null;
};

const XAI_ENDPOINT = "https://api.x.ai/v1/chat/completions";

function siteBriefing(body: AskRequest) {
  const { place, stats, streamflow } = body;
  const lines = [
    `Site: ${place.name}${place.detail ? ` (${place.detail})` : ""}`,
    `Coordinates: ${place.lat.toFixed(5)}, ${place.lon.toFixed(5)}`,
  ];

  if (stats) {
    lines.push(
      `Mapped channel segments: ${stats.channelCount}`,
      `Total channel length: ${stats.channelKm} km`,
      `Named channels: ${stats.namedChannels.join(", ") || "none"}`,
      `Waterbodies: ${stats.waterbodyCount}, wetlands: ${stats.wetlandCount}`,
      `Building footprints: ${stats.buildingCount}, mapped roadway: ${stats.impervousKm} km`,
      `Elevation samples: ${stats.elevationRange ? `${stats.elevationRange[0]} to ${stats.elevationRange[1]} m` : "unavailable"}`,
      `Channel data source: ${stats.sources.join(", ") || "OpenStreetMap"}`,
    );
  }

  if (body.imageryYears.length) {
    lines.push(`Aerial captures available: ${body.imageryYears.join(", ")}`);
  }

  if (streamflow?.reading) {
    lines.push(
      `Nearest USGS gauge: ${streamflow.gauge}`,
      `Discharge on ${streamflow.reading.date}: ${streamflow.reading.discharge} ft³/s (median ${streamflow.median} ft³/s, ${Math.round(streamflow.reading.percentile * 100)}th percentile)`,
    );
  }

  return lines.join("\n");
}

export async function POST(request: Request) {
  let body: AskRequest;
  try {
    body = (await request.json()) as AskRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const question = body.question?.trim();
  if (!question) {
    return NextResponse.json({ error: "A question is required" }, { status: 400 });
  }

  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      answer:
        "Grok is not connected yet. Add an XAI_API_KEY to this deployment and the same site measurements shown in this panel will be sent to Grok to answer questions like this one.",
      model: "unconfigured",
      generatedBy: "local" as const,
    });
  }

  const model = process.env.XAI_MODEL || "grok-4-latest";

  try {
    const res = await fetch(XAI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content:
              "You are a hydrologist answering questions about one specific site. Use only the measurements provided; never invent numbers, and say plainly when a measurement needed to answer is not available. Answer in at most 130 words of plain prose, no markdown formatting or bullet points.",
          },
          { role: "user", content: `${siteBriefing(body)}\n\nQuestion: ${question}` },
        ],
      }),
    });

    if (!res.ok) throw new Error(`xAI responded ${res.status}`);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const answer = json.choices?.[0]?.message?.content?.trim();
    if (!answer) throw new Error("xAI returned an empty completion");

    return NextResponse.json({ answer, model, generatedBy: "xai" as const });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Grok is unavailable" },
      { status: 502 },
    );
  }
}
