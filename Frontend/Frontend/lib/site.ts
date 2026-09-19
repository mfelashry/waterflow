import type { FeatureCollection, Geometry } from "geojson";

export type SiteMetrics = {
  roof_area_m2: number;
  roof_area_acres: number;
  vegetation_loss_m2: number;
  downstream_buildings: number;
  schools_downstream: number;
  road_segments: number;
  road_length_km: number;
  wetland_features: number;
  wetland_area_hectares: number;
  flow_path_length_km: number;
  corridor_area_hectares: number;
  additional_runoff_gallons_1in: number;
  pre_development_runoff_coefficient: number;
  roof_runoff_coefficient: number;
};

export type SiteManifest = {
  id: string;
  name: string;
  location: string;
  center: [number, number];
  years: { before: number; after: number };
  status: "demo" | "verified";
  analysisType: string;
  analysisUrl: string;
  dataSources: string[];
  limitations: string[];
  layers: {
    development: string;
    runoffPaths: string;
    affectedBuildings: string;
    roads: string;
    wetlands: string;
  };
  metrics: SiteMetrics;
};

export type SiteLayers = Record<keyof SiteManifest["layers"], FeatureCollection<Geometry>>;

export function formatArea(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value) + " m²";
}

export function validateMetrics(value: unknown): value is SiteMetrics {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  return [
    "roof_area_m2",
    "roof_area_acres",
    "vegetation_loss_m2",
    "downstream_buildings",
    "schools_downstream",
    "road_segments",
    "road_length_km",
    "wetland_features",
    "wetland_area_hectares",
    "flow_path_length_km",
    "corridor_area_hectares",
    "additional_runoff_gallons_1in",
    "pre_development_runoff_coefficient",
    "roof_runoff_coefficient",
  ].every((key) => typeof m[key] === "number" && Number.isFinite(m[key]));
}
