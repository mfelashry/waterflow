import { lonLatToTile } from "@/lib/geo";

/**
 * Warms the browser cache with the tiles covering a view, so switching to an archived
 * capture paints immediately instead of resolving tile by tile.
 */
export function prefetchTiles(
  template: string,
  view: { lat: number; lon: number; zoom: number },
  radius = 1,
) {
  const zoom = Math.min(18, Math.max(0, Math.round(view.zoom)));
  const { x, y } = lonLatToTile(view.lon, view.lat, zoom);
  const limit = 2 ** zoom;

  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= limit || ty >= limit) continue;
      const url = template
        .replace("{z}", String(zoom))
        .replace("{x}", String(tx))
        .replace("{y}", String(ty));
      // Fire and forget; failures simply mean no warm cache.
      void fetch(url, { mode: "cors", cache: "force-cache" }).catch(() => undefined);
    }
  }
}
