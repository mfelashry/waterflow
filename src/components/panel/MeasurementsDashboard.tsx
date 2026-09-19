"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { HydrologyStats, Place, StreamflowResult } from "@/lib/types";

type MeasurementsDashboardProps = {
  place: Place;
  stats: HydrologyStats | undefined;
  streamflow: StreamflowResult | null;
};

/** URL-safe base64 of a UTF-8 JSON string, matching the notebook's decoder. */
function encodePayload(payload: unknown): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * The site measurements, rendered by the Marimo (Python) notebook exported to a
 * static WASM app under /public/marimo. The current site's data is handed to the
 * notebook through a base64 `data` query param that its first cell decodes.
 */
export default function MeasurementsDashboard({
  place,
  stats,
  streamflow,
}: MeasurementsDashboardProps) {
  // Track which src has finished loading so a new site shows the loader again
  // without calling setState from an effect.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);

  const src = useMemo(() => {
    if (!stats) return null;
    const payload = {
      place: { name: place.name, detail: place.detail },
      stats,
      streamflow: streamflow
        ? {
            gauge: {
              name: streamflow.gauge.name,
              distanceKm: streamflow.gauge.distanceKm,
            },
            median: streamflow.median,
            readings: streamflow.readings,
          }
        : null,
    };
    return `/marimo/index.html?theme=dark&data=${encodePayload(payload)}`;
  }, [place.name, place.detail, stats, streamflow]);

  const loaded = loadedSrc === src;

  if (!stats) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-[#93a7c0]">
        <Loader2 className="size-3.5 animate-spin text-[#38bdf8]" />
        Collecting the channel network
      </div>
    );
  }

  return (
    <div className="relative">
      {!loaded && (
        <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 py-2 text-[13px] text-[#93a7c0]">
          <Loader2 className="size-3.5 animate-spin text-[#38bdf8]" />
          Loading the Marimo dashboard
        </div>
      )}
      <iframe
        key={src ?? "empty"}
        src={src ?? undefined}
        title="Site measurements dashboard"
        onLoad={() => setLoadedSrc(src)}
        className="h-[560px] w-full rounded border border-white/10 bg-transparent"
        style={{ colorScheme: "dark" }}
      />
    </div>
  );
}
