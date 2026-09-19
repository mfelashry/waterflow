"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  buildStyle,
  channelWidth,
  CHANNEL_WIDTHS,
  EMPTY_FEATURES,
  ESRI_IMAGERY,
  SKY,
  SKY_MIN_ZOOM,
} from "@/components/map/mapStyle";
import type { HydrologyResponse, ImageryEpoch } from "@/lib/types";

export type LayerToggles = {
  flow: boolean;
  waterbodies: boolean;
  wetlands: boolean;
  buildings: boolean;
  roads: boolean;
};

export type SiteMapProps = {
  center: { lat: number; lon: number };
  hydrology: HydrologyResponse | null;
  epoch: ImageryEpoch | null;
  epochBlend: number;
  toggles: LayerToggles;
  flowSpeed: number;
  /** Channel width multiplier derived from measured discharge. */
  flowScale: number;
  /** Waterbody fill opacity for the selected capture's discharge. */
  waterOpacity: number;
  onReady?: (map: MapLibreMap) => void;
  onFirstIdle?: () => void;
  onEpochLoadingChange?: (loading: boolean) => void;
  onViewChange?: (view: { zoom: number; pitch: number; bearing: number }) => void;
};

/** Where the camera comes to rest after the arrival pull-back. */
const SETTLED_VIEW = { zoom: 13.6, pitch: 52, bearing: -18 };

/** A downstream chevron, drawn once and registered as a map sprite. */
function arrowImage() {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.translate(size / 2, size / 2);
  context.lineWidth = 4.5;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "rgba(4, 22, 38, 0.55)";
  const draw = () => {
    context.beginPath();
    context.moveTo(-6, -7);
    context.lineTo(6, 0);
    context.lineTo(-6, 7);
    context.stroke();
  };
  draw();
  context.lineWidth = 2.6;
  context.strokeStyle = "rgba(226, 250, 255, 0.98)";
  draw();

  return context.getImageData(0, 0, size, size);
}

const TOGGLE_LAYERS: Record<keyof LayerToggles, string[]> = {
  flow: ["flow-casing", "flow-body", "flow-pulse", "flow-arrows"],
  waterbodies: ["waterbodies-fill", "waterbodies-edge"],
  wetlands: ["wetlands-fill", "wetlands-edge"],
  buildings: ["buildings-extrusion"],
  roads: ["roads-line"],
};

/** Gradient stops describing a bright band centred on `head`, fading behind it. */
function pulseGradient(head: number) {
  const tail = 0.26;
  const stops: [number, string][] = [[0, "rgba(125, 226, 255, 0)"]];
  const push = (position: number, color: string) => {
    const clamped = Math.min(1, Math.max(0, position));
    const last = stops[stops.length - 1][0];
    if (clamped <= last) return;
    stops.push([clamped, color]);
  };

  push(head - tail, "rgba(125, 226, 255, 0)");
  push(head - tail * 0.55, "rgba(126, 232, 255, 0.35)");
  push(head - tail * 0.2, "rgba(190, 246, 255, 0.85)");
  push(head, "rgba(255, 255, 255, 0.95)");
  push(head + 0.018, "rgba(125, 226, 255, 0)");
  push(1, "rgba(125, 226, 255, 0)");

  if (stops[stops.length - 1][0] < 1) stops.push([1, "rgba(125, 226, 255, 0)"]);

  return [
    "interpolate",
    ["linear"],
    ["line-progress"],
    ...stops.flat(),
  ] as unknown as maplibregl.ExpressionSpecification;
}

function createMarker() {
  const element = document.createElement("div");
  element.style.cssText =
    "position:relative;width:26px;height:26px;pointer-events:none;display:grid;place-items:center";
  element.innerHTML = `
    <span style="position:absolute;inset:0;border-radius:999px;border:1.5px solid rgba(125,226,255,0.9);animation:reticle-pulse 2.4s ease-out infinite"></span>
    <span style="position:absolute;width:15px;height:15px;border-radius:999px;border:1.5px solid rgba(190,246,255,0.95);box-shadow:0 0 12px rgba(76,201,240,0.75)"></span>
    <span style="position:absolute;width:3px;height:3px;border-radius:999px;background:#eafaff"></span>
  `;
  return element;
}

// maplibre-gl derives its worker URL from `import.meta.url`; under the Next bundler that
// resolves to nothing servable, so no worker starts and every source that needs one
// (GeoJSON, terrain DEM) stays permanently unloaded.
if (typeof window !== "undefined") {
  maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");
}

export default function SiteMap({
  center,
  hydrology,
  epoch,
  epochBlend,
  toggles,
  flowSpeed,
  flowScale,
  waterOpacity,
  onReady,
  onFirstIdle,
  onEpochLoadingChange,
  onViewChange,
}: SiteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const speedRef = useRef(flowSpeed);
  const readyRef = useRef(false);
  // `isStyleLoaded()` can still report false after the load event, so readiness is
  // tracked explicitly rather than re-registering one-shot load listeners.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    speedRef.current = flowSpeed;
  }, [flowSpeed]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildStyle(),
      center: [center.lon, center.lat],
      // The map takes over from the globe mid-descent, so it opens tight and steep and
      // then eases out on its own to frame the whole catchment.
      zoom: 16.6,
      pitch: 72,
      bearing: -26,
      maxPitch: 85,
      canvasContextAttributes: { antialias: true, powerPreference: "high-performance" },
      maxTileCacheSize: 320,
      refreshExpiredTiles: false,
      fadeDuration: 120,
      attributionControl: { compact: true },
      dragRotate: true,
      pitchWithRotate: true,
    });
    mapRef.current = map;
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __hydroMap?: MapLibreMap }).__hydroMap = map;
    }

    let skyApplied: boolean | null = null;
    const syncSky = () => {
      const wanted = map.getZoom() >= SKY_MIN_ZOOM;
      if (wanted === skyApplied) return;
      skyApplied = wanted;
      // Clearing the sky means handing the horizon back to the globe's own atmosphere.
      map.setSky(wanted ? SKY : {});
    };

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: "metric" }), "bottom-left");

    map.on("error", (event) => console.error("MapLibre error:", event.error?.message ?? event));

    map.on("load", () => {
      map.resize();
      map.setTerrain({ source: "dem", exaggeration: 1.35 });

      const arrow = arrowImage();
      if (arrow && !map.hasImage("flow-arrow")) map.addImage("flow-arrow", arrow);
      syncSky();
      markerRef.current = new maplibregl.Marker({ element: createMarker() })
        .setLngLat([center.lon, center.lat])
        .addTo(map);
      readyRef.current = true;
      setReady(true);
      onReady?.(map);

      // Only reveal the map once its tiles have actually arrived, so the handover never
      // shows a half-resolved surface.
      map.once("idle", () => onFirstIdle?.());

      map.easeTo({
        zoom: SETTLED_VIEW.zoom,
        pitch: SETTLED_VIEW.pitch,
        bearing: SETTLED_VIEW.bearing,
        duration: 4200,
        easing: (t) => 1 - (1 - t) ** 3,
        essential: true,
      });
    });

    const report = () => {
      onViewChange?.({
        zoom: Number(map.getZoom().toFixed(2)),
        pitch: Number(map.getPitch().toFixed(0)),
        bearing: Number(map.getBearing().toFixed(0)),
      });
      syncSky();
    };
    map.on("move", report);

    // The map mounts inside a scaling transition, so its container settles after
    // creation and the canvas has to be re-measured.
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);

    let frame = 0;
    let head = -0.26;
    let last = performance.now();
    let lastPaint = 0;
    // Rebuilding a gradient expression is not free, so the highlight is stepped at a
    // fixed rate instead of once per rendered frame.
    const PAINT_INTERVAL = 1000 / 24;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const delta = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!readyRef.current || !map.getLayer("flow-pulse")) return;
      if (map.getLayoutProperty("flow-pulse", "visibility") === "none") return;

      head += delta * speedRef.current;
      if (head > 1.3) head = -0.26;

      if (now - lastPaint < PAINT_INTERVAL) return;
      lastPaint = now;
      map.setPaintProperty("flow-pulse", "line-gradient", pulseGradient(head));
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      readyRef.current = false;
      setReady(false);
      map.remove();
      mapRef.current = null;
    };
    // The map is created once; subsequent prop changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markerRef.current?.setLngLat([center.lon, center.lat]);
    map.flyTo({
      center: [center.lon, center.lat],
      ...SETTLED_VIEW,
      duration: 2600,
      essential: true,
    });
  }, [center.lat, center.lon]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const sources: [string, GeoJSON.FeatureCollection][] = [
      ["flowlines", hydrology?.flowlines ?? EMPTY_FEATURES],
      ["waterbodies", hydrology?.waterbodies ?? EMPTY_FEATURES],
      ["wetlands", hydrology?.wetlands ?? EMPTY_FEATURES],
      ["buildings", hydrology?.buildings ?? EMPTY_FEATURES],
      ["roads", hydrology?.roads ?? EMPTY_FEATURES],
    ];
    for (const [id, data] of sources) {
      const source = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
      source?.setData(data as GeoJSON.GeoJSON);
    }
  }, [hydrology, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    for (const [key, layers] of Object.entries(TOGGLE_LAYERS)) {
      const visible = toggles[key as keyof LayerToggles];
      for (const layer of layers) {
        if (map.getLayer(layer)) {
          map.setLayoutProperty(layer, "visibility", visible ? "visible" : "none");
        }
      }
    }
  }, [toggles, ready]);

  // Measured discharge drives the drawn channel width.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const [layer, spec] of Object.entries(CHANNEL_WIDTHS)) {
      if (!map.getLayer(layer)) continue;
      map.setPaintProperty(layer, "line-width", channelWidth(spec.base, spec.perRank, flowScale));
    }
  }, [flowScale, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getLayer("waterbodies-fill")) return;
    map.setPaintProperty("waterbodies-fill", "fill-opacity", waterOpacity);
  }, [waterOpacity, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource("imagery-historic") as maplibregl.RasterTileSource | undefined;
    if (!source || !map.getLayer("imagery-historic")) return;

    if (!epoch) {
      map.setPaintProperty("imagery-historic", "raster-opacity", 0);
      map.setLayoutProperty("imagery-historic", "visibility", "none");
      return;
    }

    if ((source.tiles ?? [])[0] !== epoch.tileUrl) {
      source.setTiles([epoch.tileUrl]);
      onEpochLoadingChange?.(true);
      map.once("idle", () => onEpochLoadingChange?.(false));
    }
    map.setLayoutProperty("imagery-historic", "visibility", "visible");
    map.setPaintProperty("imagery-historic", "raster-opacity", epochBlend);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch, epochBlend, ready]);

  // maplibre-gl's own stylesheet sets `position: relative` on the container, so the
  // element is sized directly rather than through inset utilities.
  return <div ref={containerRef} className="h-full w-full" />;
}

export { ESRI_IMAGERY };
