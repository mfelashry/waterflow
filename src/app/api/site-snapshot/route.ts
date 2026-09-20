import { NextResponse } from "next/server";
import type { ClimateSummary, HydrologyStats, StreamflowResult } from "@/lib/types";
import type { GroundSummary } from "@/lib/ground";

export const runtime = "nodejs";

/**
 * Compact site payload for the Marimo companion notebook.
 * Marimo fetches this from the Next.js app rather than embedding Python in Next.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lat = Number.parseFloat(params.get("lat") ?? "");
  const lon = Number.parseFloat(params.get("lon") ?? "");
  const name = params.get("name")?.trim() || "Site";
  const detail = params.get("detail")?.trim() || "";

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "lat and lon are required" }, { status: 400 });
  }

  const years = [2016, 2018, 2020, 2022, 2024];
  const dates = years.map((year) => `${year}-07-15`).join(",");
  const origin = new URL(request.url).origin;
  const qs = `lat=${lat}&lon=${lon}`;

  const [hydroRes, climateRes, streamRes, groundRes] = await Promise.all([
    fetch(`${origin}/api/hydrology?${qs}&radiusKm=3&mode=channels`, { next: { revalidate: 300 } }),
    fetch(`${origin}/api/climate?${qs}&years=${years.join(",")}`, { next: { revalidate: 3600 } }).catch(
      () => null,
    ),
    fetch(`${origin}/api/streamflow?${qs}&dates=${dates}`, { next: { revalidate: 1800 } }).catch(() => null),
    fetch(
      `${origin}/api/ground?${qs}&named=${encodeURIComponent(name)}`,
      { next: { revalidate: 3600 } },
    ).catch(() => null),
  ]);

  const hydrology = hydroRes.ok
    ? ((await hydroRes.json()) as { stats: HydrologyStats; radiusKm: number })
    : null;
  const climate = climateRes?.ok ? ((await climateRes.json()) as ClimateSummary) : null;
  const streamflow = streamRes?.ok ? ((await streamRes.json()) as StreamflowResult) : null;
  const ground = groundRes?.ok ? ((await groundRes.json()) as GroundSummary) : null;

  const rainByYear = (climate?.years ?? []).map((item) => ({
    year: item.year,
    precipMm: item.precipMm,
  }));

  const gaugeSeries = (streamflow?.readings ?? []).map((item) => ({
    date: item.date,
    discharge: item.discharge,
    ratioToMedian: item.ratioToMedian,
    percentile: item.percentile,
  }));

  return NextResponse.json(
    {
      place: { name, detail, lat, lon },
      generatedAt: new Date().toISOString(),
      hydrology: hydrology
        ? {
            radiusKm: hydrology.radiusKm,
            channelCount: hydrology.stats.channelCount,
            channelKm: hydrology.stats.channelKm,
            waterbodyCount: hydrology.stats.waterbodyCount,
            wetlandCount: hydrology.stats.wetlandCount,
            buildingCount: hydrology.stats.buildingCount,
            impervousKm: hydrology.stats.impervousKm,
            namedChannels: hydrology.stats.namedChannels,
            elevationRange: hydrology.stats.elevationRange,
            sources: hydrology.stats.sources,
          }
        : null,
      rainByYear,
      wettestYear: climate?.wettestYear ?? null,
      driestYear: climate?.driestYear ?? null,
      streamflow: streamflow?.gauge
        ? {
            gauge: streamflow.gauge.name,
            gaugeId: streamflow.gauge.id,
            median: streamflow.median,
            readings: gaugeSeries,
          }
        : null,
      soil: ground?.soil
        ? {
            mapUnit: ground.soil.mapUnit,
            component: ground.soil.component,
            hydrologicGroup: ground.soil.hydrologicGroup,
            infiltrationLabel: ground.soil.infiltrationLabel,
            ksatUmPerSec: ground.soil.ksatUmPerSec,
            availableWaterCm: ground.soil.availableWaterCm,
            sandPct: ground.soil.sandPct,
            clayPct: ground.soil.clayPct,
          }
        : null,
      flood: ground?.floodZone
        ? {
            zone: ground.floodZone.zone,
            label: ground.floodZone.label,
            floodLevel: ground.floodZone.floodLevel,
            sfha: ground.floodZone.specialFloodHazardArea,
            outlook: ground.outlook?.headline ?? null,
            drivers: ground.outlook?.drivers ?? [],
          }
        : null,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
