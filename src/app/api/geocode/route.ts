import { NextResponse } from "next/server";
import { USER_AGENT } from "@/lib/geo";
import type { Place } from "@/lib/types";

export const runtime = "nodejs";
export const revalidate = 3600;

type NominatimResult = {
  place_id: number;
  osm_type?: string;
  osm_id?: number;
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  type: string;
  class: string;
  importance?: number;
  boundingbox?: [string, string, string, string];
};

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_id?: number;
    osm_type?: string;
    name?: string;
    osm_value?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
    extent?: [number, number, number, number];
  };
};

/** Photon is a second OpenStreetMap-backed geocoder used when Nominatim rate-limits. */
async function photonSearch(query: string): Promise<Place[]> {
  const url = new URL("https://photon.komoot.io/api");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "8");
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Photon responded ${res.status}`);
  const json = (await res.json()) as { features?: PhotonFeature[] };

  return (json.features ?? [])
    .filter((feature) => feature.geometry?.coordinates)
    .map((feature, index) => {
      const p = feature.properties;
      const detail = [p.city, p.county, p.state, p.country].filter(Boolean).join(", ");
      return {
        id: `photon-${p.osm_type ?? "x"}-${p.osm_id ?? index}`,
        name: p.name ?? detail ?? query,
        detail,
        lat: feature.geometry.coordinates[1],
        lon: feature.geometry.coordinates[0],
        category: (p.osm_value ?? "place").replace(/_/g, " "),
        importance: 1 - index / 20,
        bbox: p.extent
          ? [p.extent[0], p.extent[3], p.extent[2], p.extent[1]]
          : undefined,
      } satisfies Place;
    });
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) {
    return NextResponse.json({ results: [] satisfies Place[] });
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "8");
  url.searchParams.set("addressdetails", "0");
  url.searchParams.set("dedupe", "1");

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error(`Nominatim responded ${res.status}`);
    const raw = (await res.json()) as NominatimResult[];

    const results: Place[] = raw.map((item) => {
      const parts = item.display_name.split(", ");
      const name = item.name?.trim() || parts[0];
      return {
        id: `${item.osm_type ?? "p"}-${item.osm_id ?? item.place_id}`,
        name,
        detail: parts.slice(name === parts[0] ? 1 : 0).join(", "),
        lat: Number.parseFloat(item.lat),
        lon: Number.parseFloat(item.lon),
        category: item.type.replace(/_/g, " "),
        importance: item.importance ?? 0,
        bbox: item.boundingbox
          ? [
              Number.parseFloat(item.boundingbox[2]),
              Number.parseFloat(item.boundingbox[0]),
              Number.parseFloat(item.boundingbox[3]),
              Number.parseFloat(item.boundingbox[1]),
            ]
          : undefined,
      };
    });

    if (results.length) return NextResponse.json({ results });
    throw new Error("Nominatim returned no results");
  } catch (nominatimError) {
    try {
      return NextResponse.json({ results: await photonSearch(query) });
    } catch {
      return NextResponse.json(
        {
          results: [],
          error: nominatimError instanceof Error ? nominatimError.message : "Search failed",
        },
        { status: 502 },
      );
    }
  }
}
