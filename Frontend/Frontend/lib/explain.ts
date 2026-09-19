import type { SiteMetrics } from "./site";

export type Explanation = { resident: string; professional: string; source: "backend" | "grok" | "local" };

export function localExplanation(metrics: SiteMetrics): Explanation {
  return {
    source: "local",
    resident: `The mapped roof covers ${metrics.roof_area_acres.toLocaleString()} acres. A 1 inch storm is estimated to create about ${metrics.additional_runoff_gallons_1in.toLocaleString()} additional gallons of runoff compared with the assumed previous land cover. The modeled screening corridor contains ${metrics.downstream_buildings} buildings, ${metrics.road_segments} road segments, and ${metrics.wetland_features} wetland features. This does not mean flooding or damage occurred.`,
    professional: `The D8 terrain analysis maps ${metrics.flow_path_length_km.toLocaleString()} km of overland flow paths in a ${metrics.corridor_area_hectares.toLocaleString()} ha corridor. The runoff estimate applies coefficients ${metrics.pre_development_runoff_coefficient.toFixed(2)} and ${metrics.roof_runoff_coefficient.toFixed(2)} to a ${metrics.roof_area_m2.toLocaleString()} m² roof footprint. Storm drains, culverts, detention facilities, and underground infrastructure are not modeled.`,
  };
}
