import { NextResponse } from "next/server";
import { rainForYears } from "@/lib/climate";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lat = Number.parseFloat(params.get("lat") ?? "");
  const lon = Number.parseFloat(params.get("lon") ?? "");
  const years = (params.get("years") ?? "")
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value));

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !years.length) {
    return NextResponse.json({ error: "lat, lon, and years are required" }, { status: 400 });
  }

  const data = await rainForYears(lat, lon, years);
  return NextResponse.json(data, {
    headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
  });
}
