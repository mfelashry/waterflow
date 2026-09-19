import { NextResponse } from "next/server";
import { distinctEpochs } from "@/lib/wayback";
import type { ImageryTimeline } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lat = Number.parseFloat(params.get("lat") ?? "");
  const lon = Number.parseFloat(params.get("lon") ?? "");

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "lat and lon are required" }, { status: 400 });
  }

  try {
    const { epochs, probed } = await distinctEpochs(lat, lon);
    const payload: ImageryTimeline = { epochs, probed, location: { lat, lon } };
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Imagery lookup failed" },
      { status: 502 },
    );
  }
}
