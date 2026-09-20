import { NextResponse } from "next/server";
import { cityContext } from "@/lib/city";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const name = (params.get("name") ?? "").trim();
  const detail = (params.get("detail") ?? "").trim();

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  try {
    const city = await cityContext(name, detail || undefined);
    if (!city) {
      return NextResponse.json(
        { found: false, city: null },
        { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
      );
    }
    return NextResponse.json(
      { found: true, city },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Place lookup failed" },
      { status: 502 },
    );
  }
}
