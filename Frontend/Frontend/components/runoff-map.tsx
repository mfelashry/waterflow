"use client";

import { useEffect, useRef } from "react";
import { AttributionControl, LngLatBounds, Map, setWorkerUrl, type GeoJSONSource, type MapGeoJSONFeature, type StyleSpecification } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import type { SiteLayers, SiteManifest } from "@/lib/site";

if (typeof window !== "undefined") {
  setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
}

export type CameraView = "orbit" | "site" | "corridor";

type Props = {
  site: SiteManifest;
  layers: SiteLayers | null;
  traced: boolean;
  compare: number;
  view: CameraView;
  viewToken: number;
  onUserInteract?: () => void;
  onFeature?: (feature: MapGeoJSONFeature | null) => void;
};

const empty: FeatureCollection = { type: "FeatureCollection", features: [] };

const ORBIT = { zoom: 2.35, pitch: 0, bearing: 0 };
const SITE = { zoom: 16.8, pitch: 58, bearing: -24 };
const SECONDS_PER_REVOLUTION = 160;
const SPIN_MAX_ZOOM = 6;

const DASH_FRAMES = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0],
  [0, 0.5, 3, 3.5],
  [0, 1, 3, 3],
  [0, 1.5, 3, 2.5],
  [0, 2, 3, 2],
  [0, 2.5, 3, 1.5],
  [0, 3, 3, 1],
  [0, 3.5, 3, 0.5],
];

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function corridorBounds(layers: SiteLayers) {
  const bounds = new LngLatBounds();
  const visit = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    ) {
      bounds.extend([value[0], value[1]]);
      return;
    }
    value.forEach(visit);
  };

  [
    layers.runoffPaths,
    layers.affectedBuildings,
    layers.roads,
    layers.wetlands,
  ].forEach((collection) => {
    collection.features.forEach((feature) => {
      if (!feature.geometry) return;
      if ("coordinates" in feature.geometry) {
        visit(feature.geometry.coordinates);
      } else {
        feature.geometry.geometries.forEach((geometry) => {
          if ("coordinates" in geometry) visit(geometry.coordinates);
        });
      }
    });
  });
  return bounds;
}

const satelliteStyle = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  projection: { type: "globe" },
  sources: {
    satellite: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics",
    },
    terrain: {
      type: "raster-dem",
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
      tileSize: 256,
      encoding: "terrarium",
      maxzoom: 15,
    },
  },
  layers: [
    { id: "space", type: "background", paint: { "background-color": "#02050b" } },
    { id: "satellite", type: "raster", source: "satellite" },
  ],
  terrain: { source: "terrain", exaggeration: 1.25 },
  sky: {
    "sky-color": "#0a2a45",
    "horizon-color": "#7fd9ff",
    "fog-color": "#05131f",
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.6,
    "fog-ground-blend": 0.2,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.9, 6, 0.55, 10, 0],
  },
} as StyleSpecification;

export function RunoffMap({ site, layers, traced, compare, view, viewToken, onUserInteract, onFeature }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const spinning = useRef(view === "orbit");
  const spinStep = useRef<() => void>(() => {});
  const dragging = useRef(false);
  const flying = useRef(false);
  const coordRef = useRef<HTMLSpanElement>(null);
  const altRef = useRef<HTMLSpanElement>(null);
  const headingRef = useRef<HTMLSpanElement>(null);

  const onFeatureRef = useRef(onFeature);
  const onUserInteractRef = useRef(onUserInteract);

  useEffect(() => {
    onFeatureRef.current = onFeature;
    onUserInteractRef.current = onUserInteract;
  }, [onFeature, onUserInteract]);

  useEffect(() => {
    if (!container.current) return;

    const map = new Map({
      container: container.current,
      style: satelliteStyle,
      center: [site.center[0] + 18, 26],
      zoom: ORBIT.zoom,
      pitch: ORBIT.pitch,
      bearing: ORBIT.bearing,
      minZoom: 1.4,
      maxZoom: 18,
      maxPitch: 80,
      attributionControl: false,
      canvasContextAttributes: { antialias: true },
    });
    map.addControl(new AttributionControl({ compact: true }), "bottom-left");
    mapRef.current = map;

    const spin = () => {
      if (!spinning.current || flying.current || dragging.current || prefersReducedMotion()) return;
      if (map.getZoom() > SPIN_MAX_ZOOM) return;
      const center = map.getCenter();
      center.lng -= 360 / SECONDS_PER_REVOLUTION;
      map.easeTo({ center, duration: 1000, easing: (t) => t });
    };
    spinStep.current = spin;

    const grab = () => {
      dragging.current = true;
      onUserInteractRef.current?.();
    };
    const release = () => {
      dragging.current = false;
      spin();
    };

    let frame = 0;
    const syncReadout = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const { lng, lat } = map.getCenter();
        const ns = lat >= 0 ? "N" : "S";
        const ew = lng >= 0 ? "E" : "W";
        if (coordRef.current) coordRef.current.textContent = `${Math.abs(lat).toFixed(3)}°${ns} ${Math.abs(lng).toFixed(3)}°${ew}`;
        if (altRef.current) altRef.current.textContent = `Z${map.getZoom().toFixed(2)}`;
        if (headingRef.current) headingRef.current.textContent = `${((map.getBearing() + 360) % 360).toFixed(0).padStart(3, "0")}°`;
      });
    };

    const addSiteLayers = () => {
      const add = (id: keyof SiteLayers) => {
        if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: empty });
      };
      add("development");
      add("runoffPaths");
      add("affectedBuildings");
      add("roads");
      add("wetlands");

      if (map.getLayer("wetlands-fill")) return;
      map.addLayer({ id: "wetlands-fill", type: "fill", source: "wetlands", paint: { "fill-color": "#22d3a6", "fill-opacity": 0.28 } });
      map.addLayer({ id: "roads-line", type: "line", source: "roads", paint: { "line-color": "#ffb43f", "line-width": 2, "line-opacity": 0.72 } });
      map.addLayer({
        id: "affected-buildings",
        type: "fill-extrusion",
        source: "affectedBuildings",
        filter: ["!=", ["get", "id"], 1071709973],
        paint: {
          "fill-extrusion-color": "#ff6b00",
          "fill-extrusion-height": ["coalesce", ["get", "height"], 28],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0,
        },
      });
      map.addLayer({
        id: "affected-buildings-outline",
        type: "line",
        source: "affectedBuildings",
        filter: ["!=", ["get", "id"], 1071709973],
        paint: {
          "line-color": "#ffd0a3",
          "line-width": 2.5,
          "line-opacity": 0,
        },
      });
      map.addLayer({
        id: "development",
        type: "fill-extrusion",
        source: "development",
        paint: {
          "fill-extrusion-color": "#a3e635",
          "fill-extrusion-height": ["coalesce", ["get", "height"], 11],
          "fill-extrusion-opacity": 0.5,
        },
      });
      map.addLayer({ id: "development-outline", type: "line", source: "development", paint: { "line-color": "#ecfccb", "line-width": 2, "line-opacity": 0.9 } });
      map.addLayer({ id: "runoff-glow", type: "line", source: "runoffPaths", paint: { "line-color": "#2ad4ff", "line-width": 14, "line-blur": 9, "line-opacity": 0 } });
      map.addLayer({
        id: "runoff-paths",
        type: "line",
        source: "runoffPaths",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#d6f7ff", "line-width": 4, "line-opacity": 0 },
      });
    };

    const hitLayers = () => ["development", "affected-buildings"].filter((id) => Boolean(map.getLayer(id)));

    map.on("load", () => {
      addSiteLayers();
      map.resize();
      syncReadout();
      spin();
    });
    map.on("style.load", addSiteLayers);
    map.on("moveend", spin);
    map.on("move", syncReadout);
    map.on("mousedown", grab);
    map.on("touchstart", grab);
    map.on("mouseup", release);
    map.on("touchend", release);
    map.on("dragend", release);
    map.on("wheel", () => onUserInteractRef.current?.());

    map.on("click", (event) => {
      const queryable = hitLayers();
      if (!queryable.length) return;
      onFeatureRef.current?.(map.queryRenderedFeatures(event.point, { layers: queryable })[0] ?? null);
    });
    map.on("mousemove", (event) => {
      const queryable = hitLayers();
      if (!queryable.length) return;
      map.getCanvas().style.cursor = map.queryRenderedFeatures(event.point, { layers: queryable }).length ? "pointer" : "";
    });

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container.current);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [site.center]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layers) return;
    const update = () => Object.entries(layers).forEach(([id, data]) => (map.getSource(id) as GeoJSONSource | undefined)?.setData(data));
    if (map.isStyleLoaded()) update();
    else map.once("load", update);
  }, [layers]);

  // Dash offsets cycled to make traced flow read as moving downhill.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !traced || prefersReducedMotion()) return;
    let step = 0;
    const timer = setInterval(() => {
      if (!map.getLayer("runoff-paths")) return;
      step = (step + 1) % DASH_FRAMES.length;
      map.setPaintProperty("runoff-paths", "line-dasharray", DASH_FRAMES[step]);
    }, 90);
    return () => clearInterval(timer);
  }, [traced]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const update = () => {
      if (!map.getLayer("runoff-glow")) return;
      map.setPaintProperty("runoff-glow", "line-opacity", traced ? 0.55 : 0);
      map.setPaintProperty("runoff-paths", "line-opacity", traced ? 1 : 0);
      map.setPaintProperty("affected-buildings", "fill-extrusion-opacity", traced ? 1 : 0);
      map.setPaintProperty("affected-buildings-outline", "line-opacity", traced ? 0.95 : 0);
    };
    if (map.isStyleLoaded()) update();
    else map.once("load", update);
  }, [traced]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || viewToken === 0) return;

    // Stop the spin (and any easing already in flight) before retargeting the
    // camera, so the interrupted animation's moveend cannot cancel this one.
    spinning.current = false;
    flying.current = true;
    map.stop();

    let cancelled = false;
    const arrive = () => {
      if (cancelled) return;
      flying.current = false;
      if (view === "orbit") {
        spinning.current = true;
        spinStep.current();
      }
    };

    if (view === "site") {
      map.flyTo({ center: site.center, ...SITE, duration: 4200, curve: 1.5, essential: true });
    } else if (view === "corridor" && layers) {
      const padding = window.innerWidth <= 900
        ? { top: 90, right: 42, bottom: 110, left: 42 }
        : { top: 100, right: 460, bottom: 110, left: 70 };
      const camera = map.cameraForBounds(corridorBounds(layers), {
        padding,
        maxZoom: 13,
      });
      if (camera) {
        map.easeTo({
          center: camera.center,
          zoom: camera.zoom,
          pitch: 46,
          bearing: -16,
          duration: 3600,
          easing: (t) => 1 - Math.pow(1 - t, 3),
          essential: true,
        });
      } else {
        arrive();
      }
    } else {
      // flyTo refuses to zoom back out with globe projection + terrain, so the
      // outbound leg eases instead.
      map.easeTo({
        center: [site.center[0] + 12, 24],
        ...ORBIT,
        duration: 3200,
        easing: (t) => 1 - Math.pow(1 - t, 3),
        essential: true,
      });
    }
    map.once("moveend", arrive);

    return () => {
      cancelled = true;
      map.off("moveend", arrive);
    };
  }, [view, viewToken, site.center, layers]);

  return (
    <div className="map-shell">
      <div ref={container} className="map" aria-label="Interactive 3D runoff map" />
      <div className="scan-wash" style={{ width: `${100 - compare}%` }} aria-hidden="true" />
      <div className="readout" aria-hidden="true">
        <span className="readout-row"><i>LAT/LON</i><span ref={coordRef}>—</span></span>
        <span className="readout-row"><i>ZOOM</i><span ref={altRef}>—</span></span>
        <span className="readout-row"><i>HDG</i><span ref={headingRef}>—</span></span>
      </div>
    </div>
  );
}
