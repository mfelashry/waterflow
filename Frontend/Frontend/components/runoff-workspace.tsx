"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, Crosshair, Droplets, GraduationCap, Orbit, Route, Trees, Waves } from "lucide-react";
import { localExplanation, type Explanation } from "@/lib/explain";
import type { SiteLayers, SiteManifest } from "@/lib/site";
import { RunoffMap, type CameraView } from "./runoff-map";

type ViewMode = "resident" | "professional";

const AUTO_LOCK_MS = 7600;

export function RunoffWorkspace({ initialSite }: { initialSite: SiteManifest }) {
  const [layers, setLayers] = useState<SiteLayers | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [traced, setTraced] = useState(false);
  const [compare, setCompare] = useState(100);
  const [mode, setMode] = useState<ViewMode>("resident");
  const [explanation, setExplanation] = useState<Explanation>(() => localExplanation(initialSite.metrics));
  const [analyzing, setAnalyzing] = useState(false);
  const [selectedName, setSelectedName] = useState("Mapped warehouse roof");
  const [view, setView] = useState<CameraView>("orbit");
  const [viewToken, setViewToken] = useState(0);
  const [autoLock, setAutoLock] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all(Object.entries(initialSite.layers).map(async ([key, path]) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`Could not load ${key}`);
      return [key, await response.json()] as const;
    })).then((items) => { if (active) setLayers(Object.fromEntries(items) as SiteLayers); }).catch((error) => { if (active) setLoadError(error.message); });
    return () => { active = false; };
  }, [initialSite.layers]);

  const goToView = useCallback((next: CameraView) => {
    setAutoLock(false);
    setView(next);
    setViewToken((token) => token + 1);
  }, []);

  useEffect(() => {
    if (!autoLock || view !== "orbit") return;
    const timer = setTimeout(() => goToView("site"), AUTO_LOCK_MS);
    return () => clearTimeout(timer);
  }, [autoLock, view, goToView]);

  const analyze = async () => {
    goToView("corridor");
    setTraced(true);
    setAnalyzing(true);
    try {
      const response = await fetch(initialSite.analysisUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site: initialSite.id, metrics: initialSite.metrics }),
      });
      if (!response.ok) throw new Error("Analysis is unavailable");
      setExplanation(await response.json());
    } catch {
      setExplanation(localExplanation(initialSite.metrics));
    } finally {
      setAnalyzing(false);
    }
  };

  const handleFeature = useCallback((feature: { properties?: Record<string, unknown> } | null) => {
    setSelectedName(String(feature?.properties?.name ?? "Mapped feature"));
  }, []);

  const handleUserInteract = useCallback(() => setAutoLock(false), []);

  const m = initialSite.metrics;
  const stats = [
    { icon: Building2, value: m.downstream_buildings, label: "Buildings in corridor" },
    { icon: Route, value: m.road_segments, label: "Road segments" },
    { icon: Trees, value: m.wetland_features, label: "Wetland features" },
    { icon: GraduationCap, value: m.schools_downstream, label: "Schools in corridor" },
  ];
  const coefficientIncrease = Math.round(
    (m.roof_runoff_coefficient - m.pre_development_runoff_coefficient) * 100,
  );

  return (
    <main className="hud">
      <div className="stage">
        {loadError ? (
          <div className="stage-error" role="alert">
            <Waves size={22} />
            <strong>Site layers did not load</strong>
            <span>{loadError}</span>
          </div>
        ) : (
          <RunoffMap
            site={initialSite}
            layers={layers}
            traced={traced}
            compare={compare}
            view={view}
            viewToken={viewToken}
            onUserInteract={handleUserInteract}
            onFeature={handleFeature}
          />
        )}
        <div className="stage-frame" aria-hidden="true" />
        <div className="stage-grid" aria-hidden="true" />
        {view === "orbit" && <div className="stage-sweep" aria-hidden="true" />}
        <div className="map-legend" aria-label="Map legend">
          <span><i className="legend-mark legend-mark--warehouse" />Warehouse</span>
          <span><i className="legend-mark legend-mark--flow" />Modeled flow</span>
          <span><i className="legend-mark legend-mark--features" />Screened features</span>
        </div>
      </div>

      <header className="bar">
        <div className="mark" aria-hidden="true"><Droplets size={16} /></div>
        <div className="wordmark">
          <strong>FLOWPRINT</strong>
          <small>Development impact, traced downstream</small>
        </div>

        <div className="bar-rule" aria-hidden="true" />

        <p className="bar-status">
          <span className={`pip ${view === "orbit" ? "pip--scan" : "pip--lock"}`} aria-hidden="true" />
          {view === "orbit" ? "ORBITAL SCAN" : view === "corridor" ? "CORRIDOR VIEW" : "SITE LOCK"}
          <em>{initialSite.location}</em>
        </p>

        <div className="switch" role="group" aria-label="Camera view">
          <button type="button" className={view === "orbit" ? "on" : ""} onClick={() => goToView("orbit")}>
            <Orbit size={13} /> ORBIT
          </button>
          <button type="button" className={view !== "orbit" ? "on" : ""} onClick={() => goToView("site")}>
            <Crosshair size={13} /> SITE
          </button>
        </div>
      </header>

      <div className={`reticle ${view === "site" ? "reticle--on" : ""}`} aria-hidden="true">
        <span className="reticle-box" />
        <span className="reticle-label">{selectedName}</span>
      </div>

      <section className="deck" aria-label="Site analysis">
        <div className="panel panel--lede" style={{ "--delay": "0ms" } as React.CSSProperties}>
          <p className="eyebrow">SITE ANALYSIS / 001</p>
          <h1>Where new runoff may travel</h1>
          <p className="lede">Backend-calculated D8 overland flow from the mapped warehouse roof through buildings, roads, and wetlands.</p>
        </div>

        <div className="panel panel--metric" style={{ "--delay": "60ms" } as React.CSSProperties}>
          <p className="panel-label">MAPPED WAREHOUSE ROOF</p>
          <p className="figure">{m.roof_area_m2.toLocaleString("en-US")}<i>m²</i></p>
          <div className="gauge"><span style={{ width: `${m.roof_runoff_coefficient * 100}%` }} /></div>
          <p className="panel-foot">{m.roof_area_acres} acres · runoff coefficient +{coefficientIncrease} points</p>
        </div>

        <button className="action" type="button" onClick={analyze} disabled={analyzing || !layers}>
          <span>{analyzing ? "TRACING FLOW" : traced ? "REFRESH ANALYSIS" : "TRACE RUNOFF"}</span>
          {analyzing && <i className="action-sweep" aria-hidden="true" />}
        </button>

        <div className="telemetry" style={{ "--delay": "120ms" } as React.CSSProperties}>
          {stats.map(({ icon: Icon, value, label }) => (
            <div className="cell" key={label}>
              <Icon size={14} />
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>

        <div className="panel panel--explain" style={{ "--delay": "180ms" } as React.CSSProperties}>
          <div className="segmented" role="group" aria-label="Explanation detail">
            <button type="button" className={mode === "resident" ? "on" : ""} onClick={() => setMode("resident")}>Resident</button>
            <button type="button" className={mode === "professional" ? "on" : ""} onClick={() => setMode("professional")}>Professional</button>
          </div>
          <p className="prose">{explanation[mode]}</p>
          <p className="panel-foot">{explanation.source === "backend" ? "Verified backend analysis" : explanation.source === "grok" ? "Generated by Grok from calculated metrics" : "Local fallback from backend metrics"}</p>
        </div>

        <div className="ledger">
          <span>Added runoff / 1 inch storm</span>
          <strong>{m.additional_runoff_gallons_1in.toLocaleString()} gal</strong>
        </div>
        <p className="disclaimer">{m.flow_path_length_km} km combined modeled flow paths · {m.corridor_area_hectares} ha corridor · Not a flood prediction.</p>
      </section>

      <div className="scrub">
        <span>{initialSite.years.before}</span>
        <input
          aria-label="Compare imagery years"
          type="range"
          min="0"
          max="100"
          value={compare}
          onChange={(event) => setCompare(Number(event.target.value))}
        />
        <span>{initialSite.years.after}</span>
      </div>
    </main>
  );
}
