import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MARIMO_ORIGIN =
  process.env.MARIMO_ORIGIN?.replace(/\/$/, "") || "http://127.0.0.1:2718";

/** Lightweight probe so the Marimo tab can show install/run instructions. */
export async function GET() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1800);
    const res = await fetch(MARIMO_ORIGIN, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    return NextResponse.json({
      online: res.ok || res.status === 404 || res.status === 405,
      origin: MARIMO_ORIGIN,
      status: res.status,
    });
  } catch {
    return NextResponse.json({ online: false, origin: MARIMO_ORIGIN, status: 0 });
  }
}
