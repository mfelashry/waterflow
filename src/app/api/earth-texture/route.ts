import { USER_AGENT } from "@/lib/geo";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Full-globe equirectangular textures from NASA GIBS. Served through the app so the
 * globe gets one cached request per layer instead of stitching a tile pyramid.
 */
const LAYERS: Record<string, { layer: string; width: number; height: number }> = {
  day: { layer: "BlueMarble_ShadedRelief_Bathymetry", width: 2048, height: 1024 },
  night: { layer: "VIIRS_CityLights_2012", width: 2048, height: 1024 },
};

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("layer") ?? "day";
  const config = LAYERS[key];
  if (!config) return new Response("Unknown layer", { status: 400 });

  const url = new URL("https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi");
  url.searchParams.set("SERVICE", "WMS");
  url.searchParams.set("VERSION", "1.3.0");
  url.searchParams.set("REQUEST", "GetMap");
  url.searchParams.set("LAYERS", config.layer);
  url.searchParams.set("CRS", "EPSG:4326");
  url.searchParams.set("BBOX", "-90,-180,90,180");
  url.searchParams.set("WIDTH", String(config.width));
  url.searchParams.set("HEIGHT", String(config.height));
  url.searchParams.set("FORMAT", "image/jpeg");
  url.searchParams.set("STYLES", "");

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      next: { revalidate: 604800 },
    });
    if (!res.ok) throw new Error(`GIBS responded ${res.status}`);
    return new Response(await res.arrayBuffer(), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=604800, immutable",
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Texture unavailable", {
      status: 502,
    });
  }
}
