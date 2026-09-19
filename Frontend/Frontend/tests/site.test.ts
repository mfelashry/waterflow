import { describe, expect, it } from "vitest";
import { formatArea, validateMetrics } from "../lib/site";
import { localExplanation } from "../lib/explain";

const metrics = {
  roof_area_m2: 96718.95,
  roof_area_acres: 23.9,
  vegetation_loss_m2: 281331,
  downstream_buildings: 102,
  schools_downstream: 0,
  road_segments: 164,
  road_length_km: 15.59,
  wetland_features: 41,
  wetland_area_hectares: 15.62,
  flow_path_length_km: 37.85,
  corridor_area_hectares: 218.37,
  additional_runoff_gallons_1in: 486736,
  pre_development_runoff_coefficient: 0.2,
  roof_runoff_coefficient: 0.95,
};

describe("site contract", () => {
  it("accepts the backend metrics payload", () => expect(validateMetrics(metrics)).toBe(true));
  it("rejects partial payloads", () => expect(validateMetrics({ downstream_buildings: 2 })).toBe(false));
  it("formats mapped area", () => expect(formatArea(18420)).toBe("18,420 m²"));
  it("keeps explanations appropriately uncertain", () => {
    const result = localExplanation(metrics);
    expect(result.resident).toContain("does not mean flooding or damage occurred");
    expect(result.professional).toContain("not modeled");
  });
});
