import { NextResponse } from "next/server";
import { clamp } from "@/lib/geo";
import { collectHydrology } from "@/lib/hydrology";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lat = Number.parseFloat(params.get("lat") ?? "");
  const lon = Number.parseFloat(params.get("lon") ?? "");
  const radiusKm = clamp(Number.parseFloat(params.get("radiusKm") ?? "3") || 3, 0.5, 16);
  const date = params.get("date") ?? "";
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
  const mode = params.get("mode") === "full" ? "full" : "channels";

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "lat and lon are required" }, { status: 400 });
  }

  try {
    const data = await collectHydrology(lat, lon, radiusKm, { asOf, mode });
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Hydrology lookup failed" },
      { status: 502 },
    );
  }
}
