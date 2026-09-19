import { createHash } from "node:crypto";
import { lonLatToTile, USER_AGENT } from "@/lib/geo";
import type { ImageryEpoch } from "@/lib/types";

const CONFIG_URL =
  "https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json";

type WaybackConfigEntry = {
  itemID: string;
  itemTitle: string;
  itemURL: string;
  metadataLayerUrl?: string;
};

export type WaybackRelease = { release: string; date: string; year: number };

let cachedReleases: { at: number; value: WaybackRelease[] } | null = null;
const CONFIG_TTL_MS = 12 * 60 * 60 * 1000;

/** All Esri World Imagery Wayback releases, oldest first. */
export async function loadReleases(): Promise<WaybackRelease[]> {
  if (cachedReleases && Date.now() - cachedReleases.at < CONFIG_TTL_MS) {
    return cachedReleases.value;
  }
  const res = await fetch(CONFIG_URL, {
    headers: { "User-Agent": USER_AGENT },
    next: { revalidate: 43200 },
  });
  if (!res.ok) throw new Error(`Wayback config responded ${res.status}`);
  const config = (await res.json()) as Record<string, WaybackConfigEntry>;

  const releases: WaybackRelease[] = [];
  for (const [release, entry] of Object.entries(config)) {
    const match = /(\d{4})-(\d{2})-(\d{2})/.exec(entry.itemTitle);
    if (!match) continue;
    releases.push({ release, date: match[0], year: Number(match[1]) });
  }
  releases.sort((a, b) => a.date.localeCompare(b.date));
  cachedReleases = { at: Date.now(), value: releases };
  return releases;
}

export function tileUrlTemplate(release: string) {
  return `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${release}/{z}/{y}/{x}`;
}

function tileUrl(release: string, z: number, y: number, x: number) {
  return tileUrlTemplate(release)
    .replace("{z}", String(z))
    .replace("{y}", String(y))
    .replace("{x}", String(x));
}

async function fingerprint(release: string, z: number, y: number, x: number) {
  try {
    const res = await fetch(tileUrl(release, z, y, x), {
      headers: { "User-Agent": USER_AGENT },
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 512) return null;
    return createHash("md5").update(buf).digest("hex");
  } catch {
    return null;
  }
}

/** One candidate release per year, preferring a mid-year capture. */
function candidatesByYear(releases: WaybackRelease[], maxPerDecade = 40) {
  const byYear = new Map<number, WaybackRelease>();
  for (const release of releases) {
    const current = byYear.get(release.year);
    const month = Number(release.date.slice(5, 7));
    if (!current) {
      byYear.set(release.year, release);
      continue;
    }
    const currentMonth = Number(current.date.slice(5, 7));
    if (Math.abs(month - 7) < Math.abs(currentMonth - 7)) byYear.set(release.year, release);
  }
  return [...byYear.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-maxPerDecade);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Wayback publishes a release every few weeks, but most releases reuse the previous
 * imagery for any given place. Hashing one tile per candidate release and keeping only
 * the first release of each distinct hash yields the dates where the picture actually
 * changed, which is what an imagery comparison needs.
 */
export async function distinctEpochs(lat: number, lon: number) {
  const releases = await loadReleases();
  const candidates = candidatesByYear(releases);

  for (const zoom of [17, 15, 13]) {
    const { x, y, z } = lonLatToTile(lon, lat, zoom);
    const hashes = await mapLimit(candidates, 6, (candidate) =>
      fingerprint(candidate.release, z, y, x),
    );

    const epochs: ImageryEpoch[] = [];
    let previous: string | null = null;
    candidates.forEach((candidate, index) => {
      const hash = hashes[index];
      if (!hash || hash === previous) return;
      previous = hash;
      epochs.push({
        release: candidate.release,
        date: candidate.date,
        year: candidate.year,
        label: `${candidate.year}`,
        tileUrl: tileUrlTemplate(candidate.release),
      });
    });

    if (epochs.length >= 2) return { epochs, probed: candidates.length, zoom };
    if (epochs.length === 1 && zoom === 13) return { epochs, probed: candidates.length, zoom };
  }

  const newest = releases[releases.length - 1];
  return {
    epochs: [
      {
        release: newest.release,
        date: newest.date,
        year: newest.year,
        label: `${newest.year}`,
        tileUrl: tileUrlTemplate(newest.release),
      },
    ],
    probed: candidates.length,
    zoom: 13,
  };
}
