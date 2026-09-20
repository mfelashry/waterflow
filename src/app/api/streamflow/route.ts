import { NextResponse } from "next/server";
import { flowOnDates } from "@/lib/streamflow";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lat = Number.parseFloat(params.get("lat") ?? "");
  const lon = Number.parseFloat(params.get("lon") ?? "");
  const dates = (params.get("dates") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !dates.length) {
    return NextResponse.json({ error: "lat, lon and dates are required" }, { status: 400 });
  }

  try {
    const result = await flowOnDates(lat, lon, dates);
    return NextResponse.json(result ?? { gauge: null }, {
      headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Streamflow lookup failed" },
      { status: 502 },
    );
  }
}
