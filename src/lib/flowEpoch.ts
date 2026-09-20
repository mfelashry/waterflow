import type { FlowReading, HydrologyResponse } from "@/lib/types";

type FlowFeature = GeoJSON.Feature<GeoJSON.LineString>;

function rankOf(feature: FlowFeature) {
  const rank = Number(feature.properties?.rank);
  return Number.isFinite(rank) ? rank : 1;
}

function regimeOf(feature: FlowFeature) {
  const regime = feature.properties?.regime;
  return typeof regime === "string" ? regime : "perennial";
}

/**
 * Keep the channels a river would actually have been carrying on a given capture
 * day: dry years drop headwaters and intermittent reaches, wet years keep them.
 */
export function flowlinesForReading(
  hydrology: HydrologyResponse,
  reading: FlowReading | null,
): HydrologyResponse {
  if (!reading) return hydrology;

  const ratio = reading.ratioToMedian;
  const minRank = ratio < 0.45 ? 3 : ratio < 0.85 ? 2 : 1;
  const hideIntermittent = ratio < 0.7;
  const hideEphemeral = ratio < 1;

  const features = hydrology.flowlines.features.filter((feature) => {
    if (rankOf(feature) < minRank) return false;
    const regime = regimeOf(feature);
    if (hideEphemeral && regime === "ephemeral") return false;
    if (hideIntermittent && regime === "intermittent") return false;
    return true;
  });

  const channelKm = features.reduce(
    (total, feature) => total + Number(feature.properties?.lengthKm ?? 0),
    0,
  );

  return {
    ...hydrology,
    flowlines: { type: "FeatureCollection", features },
    stats: {
      ...hydrology.stats,
      channelCount: features.length,
      channelKm: Number(channelKm.toFixed(2)),
    },
  };
}
