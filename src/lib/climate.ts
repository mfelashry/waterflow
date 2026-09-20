import { USER_AGENT } from "@/lib/geo";
import type { ImageryEpoch } from "@/lib/types";

export type RainYear = {
  year: number;
  /** Total precipitation in mm for that calendar year. */
  precipMm: number;
};

export type ClimateSummary = {
  years: RainYear[];
  wettestYear: number | null;
  driestYear: number | null;
  source: "open-meteo";
};

/**
 * Annual precipitation for the given years from Open-Meteo Archive (ERA5).
 * Keyless, global, and fast enough to pair with Wayback captures.
 */
export async function rainForYears(
  lat: number,
  lon: number,
  years: number[],
): Promise<ClimateSummary> {
  const unique = [...new Set(years.filter((year) => year >= 1940 && year <= 2100))].sort();
  if (!unique.length) {
    return { years: [], wettestYear: null, driestYear: null, source: "open-meteo" };
  }

  const start = `${unique[0]}-01-01`;
  const end = `${unique[unique.length - 1]}-12-31`;
  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  url.searchParams.set("latitude", lat.toFixed(4));
  url.searchParams.set("longitude", lon.toFixed(4));
  url.searchParams.set("start_date", start);
  url.searchParams.set("end_date", end);
  url.searchParams.set("daily", "precipitation_sum");
  url.searchParams.set("timezone", "UTC");

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`Open-Meteo responded ${res.status}`);

    const json = (await res.json()) as {
      daily?: { time?: string[]; precipitation_sum?: (number | null)[] };
    };
    const times = json.daily?.time ?? [];
    const precip = json.daily?.precipitation_sum ?? [];
    const totals = new Map<number, number>();

    for (let i = 0; i < times.length; i += 1) {
      const year = Number.parseInt(times[i].slice(0, 4), 10);
      if (!unique.includes(year)) continue;
      const value = precip[i];
      if (value == null || !Number.isFinite(value)) continue;
      totals.set(year, (totals.get(year) ?? 0) + value);
    }

    const yearsOut: RainYear[] = unique
      .map((year) => ({
        year,
        precipMm: Number((totals.get(year) ?? 0).toFixed(1)),
      }))
      .filter((item) => item.precipMm > 0);

    if (!yearsOut.length) {
      return { years: [], wettestYear: null, driestYear: null, source: "open-meteo" };
    }

    let wettest = yearsOut[0];
    let driest = yearsOut[0];
    for (const item of yearsOut) {
      if (item.precipMm > wettest.precipMm) wettest = item;
      if (item.precipMm < driest.precipMm) driest = item;
    }

    return {
      years: yearsOut,
      wettestYear: wettest.year,
      driestYear: driest.year,
      source: "open-meteo",
    };
  } catch (error) {
    console.warn("Open-Meteo archive failed:", error);
    return { years: [], wettestYear: null, driestYear: null, source: "open-meteo" };
  }
}

/** Prefer a Wayback epoch whose year matches; else nearest year. */
export function epochForYear(epochs: ImageryEpoch[], year: number | null) {
  if (year == null || !epochs.length) return null;
  const exact = epochs.find((item) => item.year === year);
  if (exact) return exact;
  return [...epochs].sort((a, b) => Math.abs(a.year - year) - Math.abs(b.year - year))[0] ?? null;
}
