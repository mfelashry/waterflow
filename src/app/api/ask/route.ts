import { NextResponse } from "next/server";
import type { FlowReading, HydrologyStats } from "@/lib/types";
import { researchPlace, type ResearchSource } from "@/lib/research";

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatTurn = { role: "user" | "assistant"; content: string };

type AskRequest = {
  question: string;
  place: { name: string; detail: string; lat: number; lon: number };
  stats: HydrologyStats | null;
  imageryYears: number[];
  streamflow?: { gauge: string; median: number; reading: FlowReading | null } | null;
  climate?: {
    wettestYear?: number | null;
    driestYear?: number | null;
    years?: { year: number; precipMm: number }[];
  } | null;
  ground?: {
    soil?: {
      mapUnit: string;
      component: string;
      hydrologicGroup: string | null;
      infiltrationLabel: string;
    } | null;
    floodZone?: {
      zone: string;
      label: string;
      specialFloodHazardArea: boolean;
      floodLevel: string;
    } | null;
    outlook?: { headline: string; body: string; drivers: string[] } | null;
  } | null;
  history?: ChatTurn[];
};

const XAI_ENDPOINT = "https://api.x.ai/v1/chat/completions";

function siteBriefing(body: AskRequest) {
  const { place, stats, streamflow, climate, ground } = body;
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
  } else {
    lines.push("Hydrology measurements are not loaded yet for this site.");
  }

  if (body.imageryYears.length) {
    lines.push(`Aerial captures available: ${body.imageryYears.join(", ")}`);
  }

  if (streamflow?.reading) {
    lines.push(
      `Nearest USGS gauge: ${streamflow.gauge}`,
      `Discharge on ${streamflow.reading.date}: ${streamflow.reading.discharge} ft³/s (median ${streamflow.median} ft³/s, ${Math.round(streamflow.reading.percentile * 100)}th percentile, ratio ${streamflow.reading.ratioToMedian.toFixed(2)}×)`,
    );
  }

  if (climate?.years?.length) {
    lines.push(
      `Open-Meteo annual rain (mm): ${climate.years.map((item) => `${item.year}=${Math.round(item.precipMm)}`).join(", ")}`,
      `Wettest year among captures: ${climate.wettestYear ?? "n/a"}; driest: ${climate.driestYear ?? "n/a"}`,
    );
  }

  if (ground?.floodZone) {
    lines.push(
      `FEMA at pin: ${ground.floodZone.label} (zone ${ground.floodZone.zone}, level ${ground.floodZone.floodLevel}, SFHA=${ground.floodZone.specialFloodHazardArea})`,
    );
  }
  if (ground?.soil) {
    lines.push(
      `SSURGO: ${ground.soil.mapUnit}; ${ground.soil.component}; group ${ground.soil.hydrologicGroup ?? "n/a"}; ${ground.soil.infiltrationLabel}`,
    );
  }
  if (ground?.outlook) {
    lines.push(`Flood outlook: ${ground.outlook.headline}. Drivers: ${ground.outlook.drivers.join("; ") || "none"}`);
  }

  return lines.join("\n");
}

function numberedSources(sources: ResearchSource[]) {
  return sources
    .slice(0, 8)
    .map((source, index) => `[${index + 1}] ${source.title}\n${source.url}\n${source.snippet}`)
    .join("\n\n");
}

/** Natural prose answer when Grok is offline - still uses live research + map facts. */
function localChatAnswer(
  question: string,
  body: AskRequest,
  sources: ResearchSource[],
  placeName: string,
) {
  const stats = body.stats;
  const reading = body.streamflow?.reading;
  const mapBits: string[] = [];
  if (stats) {
    mapBits.push(
      `${stats.channelCount} channel segments (${stats.channelKm} km) on ${stats.namedChannels.slice(0, 3).join(", ") || "unnamed reaches"}`,
    );
    mapBits.push(
      `${stats.buildingCount} building footprints and ${stats.impervousKm} km of roadway in the study area`,
    );
    if (stats.waterbodyCount || stats.wetlandCount) {
      mapBits.push(
        `${stats.waterbodyCount} waterbodies and ${stats.wetlandCount} wetlands still on the map`,
      );
    }
  }
  if (reading && body.streamflow) {
    mapBits.push(
      `nearest USGS gauge ${body.streamflow.gauge} at ${reading.discharge} ft³/s on ${reading.date} (${reading.ratioToMedian.toFixed(2)}× median)`,
    );
  }
  if (body.ground?.floodZone) {
    mapBits.push(`FEMA pin reading ${body.ground.floodZone.label}`);
  }

  const topical = sources.filter(
    (source) =>
      /data.?cent|loudoun|ashburn|stormwater|watershed|saliniz|water|virginia/i.test(
        `${source.title} ${source.snippet}`,
      ),
  );
  const used = (topical.length ? topical : sources).slice(0, 4);

  const researchBits = used
    .map((source, index) => {
      const snip = source.snippet?.trim() || source.title;
      return `[${index + 1}] ${snip}`;
    })
    .join(" ");

  const aboutCenters = /data\s*cent|datacent|server|hyperscale|cloud/i.test(question);
  const lead = aboutCenters
    ? `${placeName} sits in one of the densest data-center corridors in the U.S., so the water story is less "the river redraws itself overnight" and more how cooling demand, hardscape, and stormwater rules stack onto the same streams Waterflow already maps.`
    : `Here's a straight take on ${placeName} from the live Waterflow map plus public research.`;

  const mapPart = mapBits.length
    ? ` Right now the map shows ${mapBits.join("; ")}. That is today's network and built surface, not a reconstructed pre-boom hydrograph.`
    : " The screening map did not return a full hydrology pack for this pin yet.";

  const researchPart = used.length
    ? ` Local and scholarly coverage of the corridor (${used
        .map((_, index) => `[${index + 1}]`)
        .join(", ")}) talks about Northern Virginia / Loudoun data-center growth, territorial water and land pressure, and stormwater / salinity stress on small streams. ${researchBits}`
    : " Outside research did not return strong local hits for this exact wording, so stay conservative about cause-and-effect beyond the mapped channels.";

  const close = aboutCenters
    ? ` So has waterflow "changed" because of data centers? The map alone cannot prove a before/after cooling-water or streamflow trend. What it can show is a heavily built site on named tributaries, while the research frames Ashburn/Loudoun as a place where industrial water demand and stormwater load are real local issues. For gallon-by-gallon cooling withdrawals you still need utility, DEQ, or operator reports beyond this screening layer.`
    : ` Ask a follow-up about flood zones, a named creek, or a specific imagery year if you want to go deeper.`;

  return `${lead}${mapPart}${researchPart}${close}`;
}

const SYSTEM_PROMPT = `You are Grok helping inside Waterflow, a site hydrology explorer.
Chat naturally like a sharp, concise assistant - plain conversational prose, not labeled sections, not bullet-heavy reports unless the user asks for a list.

You receive:
1) LIVE SITE MEASUREMENTS from the Waterflow map
2) EXTERNAL RESEARCH NOTES with numbered sources

Rules:
- Answer the user's question directly in 2-5 short paragraphs.
- Weave map facts and research together the way a normal AI chat would.
- Cite sources inline as [1], [2] when you lean on them.
- Never invent gauge readings, channel counts, or flood zones that are not in the measurements.
- If the map cannot prove something (for example historical data-center water use), say that clearly and use research for the broader place context.
- No markdown headings like "Waterflow measurements" or "Interpretation".`;

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

  const briefing = siteBriefing(body);
  const research = await researchPlace({
    placeName: body.place.name,
    detail: body.place.detail || "",
    question,
  });

  const apiKey = process.env.XAI_API_KEY?.trim();
  const model = process.env.XAI_MODEL || "grok-4-latest";
  const sourceBlock = numberedSources(research.sources);

  if (!apiKey) {
    const answer = localChatAnswer(question, body, research.sources, body.place.name);
    return NextResponse.json({
      answer,
      sources: research.sources,
      model: "waterflow-local",
      generatedBy: "local" as const,
    });
  }

  const history = (body.history ?? [])
    .filter((turn) => turn.content?.trim() && (turn.role === "user" || turn.role === "assistant"))
    .slice(-8)
    .map((turn) => ({ role: turn.role, content: turn.content.trim() }));

  try {
    const res = await fetch(XAI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.55,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...history,
          {
            role: "user",
            content: `Question: ${question}

LIVE SITE MEASUREMENTS
${briefing}

EXTERNAL RESEARCH NOTES
${sourceBlock || "No external sources returned."}`,
          },
        ],
      }),
    });

    if (!res.ok) throw new Error(`xAI responded ${res.status}`);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const answer = json.choices?.[0]?.message?.content?.trim();
    if (!answer) throw new Error("xAI returned an empty completion");

    return NextResponse.json({
      answer,
      sources: research.sources,
      model,
      generatedBy: "xai" as const,
    });
  } catch (error) {
    const answer = localChatAnswer(question, body, research.sources, body.place.name);
    return NextResponse.json({
      answer,
      sources: research.sources,
      model: "waterflow-local",
      generatedBy: "local" as const,
      warning: error instanceof Error ? error.message : "Grok unavailable",
    });
  }
}
