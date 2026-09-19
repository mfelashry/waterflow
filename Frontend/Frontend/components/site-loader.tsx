"use client";

import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, ServerCrash } from "lucide-react";
import type { SiteManifest } from "@/lib/site";
import { validateMetrics } from "@/lib/site";
import { RunoffWorkspace } from "./runoff-workspace";

const API_URL =
  process.env.NEXT_PUBLIC_RUNOFF_API_URL ?? "http://127.0.0.1:8000";

function isSiteManifest(value: unknown): value is SiteManifest {
  if (!value || typeof value !== "object") return false;
  const site = value as Partial<SiteManifest>;
  return (
    typeof site.id === "string" &&
    typeof site.name === "string" &&
    Array.isArray(site.center) &&
    site.center.length === 2 &&
    site.center.every((coordinate) => typeof coordinate === "number") &&
    Boolean(site.layers) &&
    typeof site.analysisUrl === "string" &&
    validateMetrics(site.metrics)
  );
}

export function SiteLoader() {
  const [site, setSite] = useState<SiteManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setError(null);
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${API_URL}/api/site`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Backend returned HTTP ${response.status}`);
        }
        const payload: unknown = await response.json();
        if (!isSiteManifest(payload)) {
          throw new Error("Backend returned an invalid site manifest");
        }
        setSite(payload);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        const detail = reason instanceof Error ? reason.message : "Unknown error";
        setError(
          `Could not reach the runoff API at ${API_URL}. ${detail}`,
        );
      });

    return () => controller.abort();
  }, [attempt]);

  if (site) return <RunoffWorkspace initialSite={site} />;

  return (
    <main className="hud">
      <div className="stage">
        <div className="stage-error" role={error ? "alert" : "status"}>
          {error ? <ServerCrash size={24} /> : <LoaderCircle className="spin" size={24} />}
          <strong>{error ? "Backend offline" : "Loading verified analysis"}</strong>
          <span>{error ?? "Connecting to the Clear Brook data service…"}</span>
          {error && <button type="button" onClick={retry}>Retry connection</button>}
        </div>
      </div>
    </main>
  );
}
