import { haversineKm, USER_AGENT } from "@/lib/geo";

const SITE_SERVICE = "https://waterservices.usgs.gov/nwis/site/";
const DAILY_SERVICE = "https://waterservices.usgs.gov/nwis/dv/";
const DISCHARGE = "00060";

export type Gauge = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  distanceKm: number;
};

export type FlowReading = {
  date: string;
  /** Mean daily discharge in cubic feet per second. */
  discharge: number;
  /** Where this day sits in the gauge's full record, 0 to 1. */
  percentile: number;
  /** Discharge relative to the gauge's median flow. */
  ratioToMedian: number;
};

export type StreamflowResult = {
  gauge: Gauge;
  median: number;
  readings: FlowReading[];
};

async function text(url: string | URL, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Stream gauges near a point, nearest first. */
async function nearbyGauges(lat: number, lon: number, spanDeg = 0.45): Promise<Gauge[]> {
  const url = new URL(SITE_SERVICE);
  url.searchParams.set("format", "rdb");
  url.searchParams.set(
    "bBox",
    [lon - spanDeg, lat - spanDeg * 0.7, lon + spanDeg, lat + spanDeg * 0.7]
      .map((value) => value.toFixed(4))
      .join(","),
  );
  url.searchParams.set("parameterCd", DISCHARGE);
  url.searchParams.set("siteType", "ST");
  url.searchParams.set("hasDataTypeCd", "dv");

  const body = await text(url);
  const gauges: Gauge[] = [];

  for (const line of body.split("\n")) {
    if (!line.startsWith("USGS\t")) continue;
    const parts = line.split("\t");
    const gaugeLat = Number.parseFloat(parts[4]);
    const gaugeLon = Number.parseFloat(parts[5]);
    if (!Number.isFinite(gaugeLat) || !Number.isFinite(gaugeLon)) continue;
    gauges.push({
      id: parts[1],
      name: parts[2].replace(/\s+/g, " ").trim(),
      lat: gaugeLat,
      lon: gaugeLon,
      distanceKm: Number(haversineKm(lat, lon, gaugeLat, gaugeLon).toFixed(1)),
    });
  }

  return gauges.sort((a, b) => a.distanceKm - b.distanceKm);
}

type DailyValues = { json: { value?: { timeSeries?: TimeSeries[] } } };
type TimeSeries = {
  values: { value: { value: string; dateTime: string }[] }[];
};

/** Mean daily discharge for a gauge over a date range, keyed by `YYYY-MM-DD`. */
async function dailySeries(siteId: string, from: string, to: string) {
  const url = new URL(DAILY_SERVICE);
  url.searchParams.set("format", "json");
  url.searchParams.set("sites", siteId);
  url.searchParams.set("parameterCd", DISCHARGE);
  url.searchParams.set("startDT", from);
  url.searchParams.set("endDT", to);
  url.searchParams.set("siteStatus", "all");

  const parsed = JSON.parse(await text(url, 40000)) as DailyValues["json"];
  const series = parsed.value?.timeSeries?.[0];
  const values = new Map<string, number>();

  for (const entry of series?.values?.[0]?.value ?? []) {
    const discharge = Number.parseFloat(entry.value);
    if (!Number.isFinite(discharge) || discharge < 0) continue;
    values.set(entry.dateTime.slice(0, 10), discharge);
  }
  return values;
}

function quantile(sorted: number[], fraction: number) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, (sorted.length - 1) * fraction));
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

/**
 * Measured discharge on each requested date at the closest gauge that has a record for
 * them. This is what makes the rendered flow track the aerial capture: the channels are
 * drawn at the discharge the river was actually carrying the day the photo was taken.
 */
export async function flowOnDates(
  lat: number,
  lon: number,
  dates: string[],
): Promise<StreamflowResult | null> {
  if (!dates.length) return null;
  const sorted = [...dates].sort();
  const from = sorted[0];
  const to = sorted[sorted.length - 1];

  let gauges: Gauge[] = [];
  try {
    gauges = await nearbyGauges(lat, lon);
  } catch (error) {
    console.warn("USGS site lookup failed:", error);
    return null;
  }

  for (const gauge of gauges.slice(0, 4)) {
    try {
      const series = await dailySeries(gauge.id, from, to);
      const matched = sorted.filter((date) => series.has(date));
      // A gauge is only useful here if it covers most of the capture dates.
      if (matched.length < Math.max(2, Math.ceil(sorted.length * 0.6))) continue;

      const record = [...series.values()].sort((a, b) => a - b);
      const median = quantile(record, 0.5);

      const readings: FlowReading[] = matched.map((date) => {
        const discharge = series.get(date) as number;
        const below = record.filter((value) => value <= discharge).length;
        return {
          date,
          discharge: Number(discharge.toFixed(2)),
          percentile: Number((below / record.length).toFixed(3)),
          ratioToMedian: Number((discharge / (median || 1)).toFixed(2)),
        };
      });

      return { gauge, median: Number(median.toFixed(2)), readings };
    } catch (error) {
      console.warn(`USGS daily values failed for ${gauge.id}:`, error);
    }
  }

  return null;
}
