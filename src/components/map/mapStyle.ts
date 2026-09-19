import type {
  ExpressionSpecification,
  SkySpecification,
  StyleSpecification,
} from "maplibre-gl";

export const ESRI_IMAGERY =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

export const ESRI_LABELS =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";

const TERRARIUM_DEM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

export const EMPTY_FEATURES: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

/**
 * Channel stroke widths, scaled by measured discharge so the drawn river matches the
 * flow the gauge recorded on the day the selected imagery was captured.
 */
export function channelWidth(
  base: [number, number],
  perRank: [number, number],
  scale: number,
): ExpressionSpecification {
  return [
    "interpolate",
    ["exponential", 1.6],
    ["zoom"],
    10,
    ["+", base[0] * scale, ["*", perRank[0] * scale, ["coalesce", ["get", "rank"], 2]]],
    18,
    ["+", base[1] * scale, ["*", perRank[1] * scale, ["coalesce", ["get", "rank"], 2]]],
  ];
}

export const CHANNEL_WIDTHS = {
  "flow-casing": { base: [1.6, 7] as [number, number], perRank: [0.5, 2.6] as [number, number] },
  "flow-body": { base: [0.7, 3.4] as [number, number], perRank: [0.32, 1.5] as [number, number] },
  "flow-pulse": { base: [0.5, 2.2] as [number, number], perRank: [0.22, 1.1] as [number, number] },
};

/**
 * Raster basemap with a real DEM behind it, so terrain and hillshade line up with the
 * aerial imagery instead of being draped over a flat plane.
 */
export function buildStyle(): StyleSpecification {
  return {
    version: 8,
    projection: { type: "globe" },
    sources: {
      "imagery-current": {
        type: "raster",
        tiles: [ESRI_IMAGERY],
        tileSize: 256,
        maxzoom: 19,
        attribution:
          "Imagery &copy; Esri, Maxar, Earthstar Geographics | Elevation: Mapzen/AWS Terrain Tiles",
      },
      "imagery-historic": {
        type: "raster",
        tiles: [ESRI_IMAGERY],
        tileSize: 256,
        maxzoom: 19,
        attribution: "Historical imagery &copy; Esri World Imagery Wayback",
      },
      labels: {
        type: "raster",
        tiles: [ESRI_LABELS],
        tileSize: 256,
        maxzoom: 13,
      },
      dem: {
        type: "raster-dem",
        tiles: [TERRARIUM_DEM],
        tileSize: 256,
        encoding: "terrarium",
        maxzoom: 14,
      },
      flowlines: { type: "geojson", data: EMPTY_FEATURES, lineMetrics: true },
      waterbodies: { type: "geojson", data: EMPTY_FEATURES },
      wetlands: { type: "geojson", data: EMPTY_FEATURES },
      buildings: { type: "geojson", data: EMPTY_FEATURES },
      roads: { type: "geojson", data: EMPTY_FEATURES },
    },
    layers: [
      { id: "space", type: "background", paint: { "background-color": "#04060c" } },
      {
        id: "imagery-current",
        type: "raster",
        source: "imagery-current",
        paint: { "raster-opacity": 1, "raster-fade-duration": 200 },
      },
      {
        id: "imagery-historic",
        type: "raster",
        source: "imagery-historic",
        layout: { visibility: "none" },
        paint: {
          "raster-opacity": 0,
          "raster-opacity-transition": { duration: 450, delay: 0 },
          "raster-fade-duration": 200,
        },
      },
      {
        id: "hillshade",
        type: "hillshade",
        source: "dem",
        paint: {
          "hillshade-exaggeration": 0.28,
          "hillshade-shadow-color": "#01040a",
          "hillshade-highlight-color": "#cfe4ff",
          "hillshade-accent-color": "#0d2136",
        },
      },
      {
        id: "labels",
        type: "raster",
        source: "labels",
        maxzoom: 9,
        paint: { "raster-opacity": 0.55 },
      },
      {
        id: "wetlands-fill",
        type: "fill",
        source: "wetlands",
        layout: { visibility: "none" },
        paint: { "fill-color": "#3fd39a", "fill-opacity": 0.18 },
      },
      {
        id: "wetlands-edge",
        type: "line",
        source: "wetlands",
        layout: { visibility: "none" },
        paint: { "line-color": "#63e6b5", "line-width": 1.1, "line-opacity": 0.6 },
      },
      {
        id: "roads-line",
        type: "line",
        source: "roads",
        layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["case", ["get", "major"], "#ffce7a", "#ffb15c"],
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            12,
            ["case", ["get", "major"], 1.4, 0.7],
            18,
            ["case", ["get", "major"], 5.5, 2.4],
          ],
          "line-opacity": 0.7,
        },
      },
      {
        id: "buildings-extrusion",
        type: "fill-extrusion",
        source: "buildings",
        layout: { visibility: "none" },
        paint: {
          "fill-extrusion-color": [
            "interpolate",
            ["linear"],
            ["get", "height"],
            3,
            "#8fb6df",
            12,
            "#c6dcf3",
            40,
            "#f2f7ff",
          ],
          "fill-extrusion-height": ["get", "height"],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.82,
        },
      },
      {
        id: "waterbodies-fill",
        type: "fill",
        source: "waterbodies",
        paint: { "fill-color": "#1c7fd6", "fill-opacity": 0.42 },
      },
      {
        id: "waterbodies-edge",
        type: "line",
        source: "waterbodies",
        paint: { "line-color": "#7fe3ff", "line-width": 1.2, "line-opacity": 0.8 },
      },
      // Three stacked strokes give the channel a readable dark casing, a solid body and
      // a travelling highlight, instead of a dotted line.
      {
        id: "flow-casing",
        type: "line",
        source: "flowlines",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#03121f",
          "line-opacity": 0.75,
          "line-blur": 1.4,
          "line-width": channelWidth(
            CHANNEL_WIDTHS["flow-casing"].base,
            CHANNEL_WIDTHS["flow-casing"].perRank,
            1,
          ),
          "line-width-transition": { duration: 900, delay: 0 },
        },
      },
      {
        id: "flow-body",
        type: "line",
        source: "flowlines",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#2a9fd6",
          "line-opacity": 0.95,
          "line-width": channelWidth(
            CHANNEL_WIDTHS["flow-body"].base,
            CHANNEL_WIDTHS["flow-body"].perRank,
            1,
          ),
          "line-width-transition": { duration: 900, delay: 0 },
        },
      },
      {
        id: "flow-pulse",
        type: "line",
        source: "flowlines",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-opacity": 0.95,
          "line-blur": 0.6,
          "line-width": channelWidth(
            CHANNEL_WIDTHS["flow-pulse"].base,
            CHANNEL_WIDTHS["flow-pulse"].perRank,
            1,
          ),
          "line-width-transition": { duration: 900, delay: 0 },
          "line-gradient": [
            "interpolate",
            ["linear"],
            ["line-progress"],
            0,
            "rgba(120, 220, 255, 0)",
            1,
            "rgba(120, 220, 255, 0)",
          ],
        },
      },
      // Chevrons repeated along each channel, pointing downstream.
      {
        id: "flow-arrows",
        type: "symbol",
        source: "flowlines",
        minzoom: 11,
        layout: {
          "symbol-placement": "line",
          "symbol-spacing": ["interpolate", ["linear"], ["zoom"], 11, 46, 18, 78],
          "icon-image": "flow-arrow",
          "icon-size": ["interpolate", ["linear"], ["zoom"], 11, 0.26, 15, 0.42, 18, 0.62],
          "icon-rotation-alignment": "map",
          "icon-pitch-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: { "icon-opacity": 0.95 },
      },
    ],
  };
}

/**
 * Atmosphere for the tilted close-up view. MapLibre cannot compute a fog matrix while
 * the globe projection is active, so this is applied only above the zoom at which the
 * map has already switched to mercator.
 */
export const SKY: SkySpecification = {
  "sky-color": "#0a1b33",
  "horizon-color": "#2b4a70",
  "fog-color": "#0b1524",
  "sky-horizon-blend": 0.6,
  "horizon-fog-blend": 0.55,
  "fog-ground-blend": 0.5,
};

export const SKY_MIN_ZOOM = 12.5;
