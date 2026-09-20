import { NextResponse } from "next/server";
import { loadGround } from "@/lib/ground";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = Number.parseFloat(searchParams.get("lat") ?? "");
  const lon = Number.parseFloat(searchParams.get("lon") ?? "");
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "lat and lon required" }, { status: 400 });
  }

  const waterbodyCount = Number.parseInt(searchParams.get("waterbodies") ?? "0", 10);
  const wetlandCount = Number.parseInt(searchParams.get("wetlands") ?? "0", 10);
  const named = (searchParams.get("named") ?? "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  const percentileRaw = searchParams.get("percentile");
  const gaugePercentile =
    percentileRaw != null && percentileRaw !== ""
      ? Number.parseFloat(percentileRaw)
      : null;

  const ground = await loadGround({
    lat,
    lon,
    waterbodyCount: Number.isFinite(waterbodyCount) ? waterbodyCount : 0,
    wetlandCount: Number.isFinite(wetlandCount) ? wetlandCount : 0,
    namedChannels: named,
    gaugePercentile: Number.isFinite(gaugePercentile as number) ? gaugePercentile : null,
  });

  return NextResponse.json(ground, {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
