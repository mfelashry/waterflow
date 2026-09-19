export type Place = {
  id: string;
  name: string;
  detail: string;
  lat: number;
  lon: number;
  category: string;
  importance: number;
  bbox?: [number, number, number, number];
};

export type ImageryEpoch = {
  /** Esri Wayback release identifier used to build the tile URL. */
  release: string;
  /** Release date of the archive layer, ISO `YYYY-MM-DD`. */
  date: string;
  year: number;
  label: string;
  tileUrl: string;
};

export type ImageryTimeline = {
  epochs: ImageryEpoch[];
  probed: number;
  location: { lat: number; lon: number };
};

export type HydrologyStats = {
  channelCount: number;
  channelKm: number;
  waterbodyCount: number;
  wetlandCount: number;
  buildingCount: number;
  impervousKm: number;
  namedChannels: string[];
  sources: string[];
  elevationRange: [number, number] | null;
};

export type HydrologyResponse = {
  center: { lat: number; lon: number };
  radiusKm: number;
  flowlines: GeoJSON.FeatureCollection<GeoJSON.LineString>;
  waterbodies: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
  wetlands: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
  buildings: GeoJSON.FeatureCollection<GeoJSON.Polygon>;
  roads: GeoJSON.FeatureCollection<GeoJSON.LineString>;
  stats: HydrologyStats;
};

export type { FlowReading, Gauge, StreamflowResult } from "@/lib/streamflow";

export type AnalysisSection = {
  heading: string;
  body: string;
};

export type AnalysisResult = {
  headline: string;
  summary: string;
  sections: AnalysisSection[];
  riskLevel: "low" | "moderate" | "elevated" | "high";
  model: string;
  generatedBy: "xai" | "local";
};
