"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Compass } from "lucide-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import DemoPath from "@/components/DemoPath";
import SearchBar from "@/components/SearchBar";
import AnalysisPanel from "@/components/panel/AnalysisPanel";
import PlaceWikiCard from "@/components/panel/PlaceWikiCard";
import { Button } from "@/components/ui/button";
import type { CityContext } from "@/lib/city";
import { epochForYear } from "@/lib/climate";
import { flowlinesForReading } from "@/lib/flowEpoch";
import { clamp, placeHydrologyRadiusKm } from "@/lib/geo";
import type { GroundSummary } from "@/lib/ground";
import { prefetchTiles } from "@/lib/prefetch";
import type { LayerToggles } from "@/components/map/SiteMap";
import type {
  ClimateSummary,
  FlowReading,
  HydrologyResponse,
  ImageryEpoch,
  ImageryTimeline,
  Place,
  StreamflowResult,
} from "@/lib/types";

/** Browser-session cache so revisiting a site skips the network round-trip. */
const clientHydroCache = new Map<string, HydrologyResponse>();
const CLIENT_HYDRO_MAX = 24;

function clientHydroKey(lat: number, lon: number, radiusKm: number, mode: string) {
  return `v8:${lat.toFixed(3)},${lon.toFixed(3)},${radiusKm},${mode}`;
}

function rememberClientHydro(key: string, data: HydrologyResponse) {
  if (!data.stats.channelCount && !data.stats.waterbodyCount) return;
  clientHydroCache.set(key, data);
  if (clientHydroCache.size > CLIENT_HYDRO_MAX) {
    const oldest = clientHydroCache.keys().next().value;
    if (oldest) clientHydroCache.delete(oldest);
  }
}

const Globe = dynamic(() => import("@/components/globe/Globe"), { ssr: false });
const SiteMap = dynamic(() => import("@/components/map/SiteMap"), { ssr: false });

type Phase = "orbit" | "returning" | "descending" | "site";

const DEFAULT_TOGGLES: LayerToggles = {
  flow: true,
  waterbodies: false,
  wetlands: false,
  buildings: false,
  roads: false,
  topo: false,
  flood: false,
};

/** The reveal never waits on tiles longer than this. */
const REVEAL_CAP_MS = 1800;
/** Fade only during the final dive, after the camera has travelled to the target. */
const FADE_START = 0.72;
const FADE_END = 0.96;

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Map a discharge ratio onto how wide and how fast the channels are drawn. */
function flowFromReading(reading: FlowReading | null) {
  if (!reading) return { scale: 1, speed: 0.62, waterOpacity: 0.42 };
  const ratio = clamp(reading.ratioToMedian, 0.12, 6);
  return {
    scale: Number(clamp(0.32 + 0.95 * Math.sqrt(ratio), 0.32, 2.8).toFixed(3)),
    speed: Number(clamp(0.22 + 0.55 * ratio, 0.18, 1.8).toFixed(3)),
    waterOpacity: Number(clamp(0.16 + 0.34 * Math.sqrt(ratio), 0.16, 0.58).toFixed(3)),
  };
}

export default function Experience() {
  const [phase, setPhase] = useState<Phase>("orbit");
  const [place, setPlace] = useState<Place | null>(null);
  const [fromPlace, setFromPlace] = useState<Place | null>(null);
  const [mapRevealed, setMapRevealed] = useState(false);
  const [descentFade, setDescentFade] = useState(0);

  const [hydrology, setHydrology] = useState<HydrologyResponse | null>(null);
  const [baseHydrology, setBaseHydrology] = useState<HydrologyResponse | null>(null);
  const [hydrologyError, setHydrologyError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<ImageryTimeline | null>(null);
  const [streamflow, setStreamflow] = useState<StreamflowResult | null>(null);
  const [climate, setClimate] = useState<ClimateSummary | null>(null);
  const [ground, setGround] = useState<GroundSummary | null>(null);
  const [epoch, setEpoch] = useState<ImageryEpoch | null>(null);
  const [epochBlend, setEpochBlend] = useState(1);
  const [epochLoading, setEpochLoading] = useState(false);
  const [toggles, setToggles] = useState<LayerToggles>(DEFAULT_TOGGLES);
  const [speedBias, setSpeedBias] = useState(1);
  const [view, setView] = useState({ zoom: 12.4, pitch: 48, bearing: -14 });

  const [wiki, setWiki] = useState<CityContext | null>(null);
  const [wikiLoading, setWikiLoading] = useState(false);
  const [wikiOpen, setWikiOpen] = useState(true);

  const requestRef = useRef(0);
  const mapRef = useRef<MapLibreMap | null>(null);
  const timers = useRef<number[]>([]);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((id) => window.clearTimeout(id));
  }, []);

  const globeTarget = useMemo(
    () => (place ? { lat: place.lat, lon: place.lon } : null),
    [place],
  );

  const globeFrom = useMemo(
    () => (fromPlace ? { lat: fromPlace.lat, lon: fromPlace.lon } : null),
    [fromPlace],
  );

  const selectPlace = useCallback(
    (next: Place) => {
      requestRef.current += 1;
      setMapRevealed(false);
      setDescentFade(0);
      setHydrology(null);
      setBaseHydrology(null);
      setHydrologyError(null);
      setTimeline(null);
      setStreamflow(null);
      setClimate(null);
      setGround(null);
      setEpoch(null);
      setEpochBlend(1);
      setEpochLoading(false);
      setWiki(null);
      setWikiLoading(true);
      setWikiOpen(true);
      setToggles(DEFAULT_TOGGLES);

      setFromPlace(phase === "site" ? place : null);
      if (phase === "site") mapRef.current = null;
      setPlace(next);
      setPhase("descending");
    },
    [phase, place],
  );

  // Wikipedia / place card - starts as soon as a search is chosen.
  useEffect(() => {
    if (!place) return;
    const id = requestRef.current;
    const controller = new AbortController();

    const params = new URLSearchParams({
      name: place.name,
      detail: place.detail || "",
    });

    fetch(`/api/place?${params}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Place lookup ${res.status}`);
        return (await res.json()) as { found: boolean; city: CityContext | null };
      })
      .then((data) => {
        if (id !== requestRef.current) return;
        setWiki(data.city);
        setWikiOpen(true);
      })
      .catch((error: Error) => {
        if (error.name === "AbortError" || id !== requestRef.current) return;
        setWiki(null);
      })
      .finally(() => {
        if (id === requestRef.current) setWikiLoading(false);
      });

    return () => controller.abort();
  }, [place]);

  // Channels first (fast), then buildings/roads, so the map paints during the dive.
  useEffect(() => {
    if (!place) return;
    const id = requestRef.current;
    const radiusKm = placeHydrologyRadiusKm(place);
    const channelKey = clientHydroKey(place.lat, place.lon, radiusKm, "channels");
    const fullKey = clientHydroKey(place.lat, place.lon, radiusKm, "full");
    const params = new URLSearchParams({
      lat: String(place.lat),
      lon: String(place.lon),
      radiusKm: String(radiusKm),
      mode: "channels",
    });
    const emptyMessage = `No mapped channels within ${radiusKm} km. Try a river or one of the demo sites.`;

    const cachedFull = clientHydroCache.get(fullKey);
    const cachedChannels = cachedFull ?? clientHydroCache.get(channelKey);

    const applyHydro = (data: HydrologyResponse, key: string) => {
      if (id !== requestRef.current) return;
      rememberClientHydro(key, data);
      setBaseHydrology(data);
      setHydrology(data);
      if (data.stats.channelCount === 0) {
        setHydrologyError(emptyMessage);
      }
    };

    if (cachedChannels) {
      // Defer so we don't sync-set state inside the effect body (React Compiler lint).
      queueMicrotask(() => {
        if (id !== requestRef.current) return;
        setBaseHydrology(cachedChannels);
        setHydrology(cachedChannels);
        if (cachedChannels.stats.channelCount === 0) {
          setHydrologyError(emptyMessage);
        }
      });
    }

    const loadFull = () => {
      const fullParams = new URLSearchParams(params);
      fullParams.set("mode", "full");
      void fetch(`/api/hydrology?${fullParams}`)
        .then(async (res) => (res.ok ? ((await res.json()) as HydrologyResponse) : null))
        .then((full) => {
          if (!full) return;
          applyHydro(full, fullKey);
        })
        .catch(() => undefined);
    };

    if (cachedFull) {
      // Session hit: skip network for hydrology.
    } else if (cachedChannels) {
      loadFull();
    } else {
      fetch(`/api/hydrology?${params}`)
        .then(async (res) => {
          if (!res.ok) throw new Error(`Hydrology service returned ${res.status}`);
          return (await res.json()) as HydrologyResponse;
        })
        .then((data) => {
          applyHydro(data, channelKey);
          loadFull();
        })
        .catch((error: Error) => {
          if (id !== requestRef.current) return;
          setHydrologyError(error.message);
        });
    }

    fetch(`/api/imagery/timeline?lat=${place.lat}&lon=${place.lon}`)
      .then(async (res) => (res.ok ? ((await res.json()) as ImageryTimeline) : null))
      .then((data) => {
        if (id !== requestRef.current || !data) return;
        setTimeline(data);
      })
      .catch(() => undefined);
  }, [place]);

  useEffect(() => {
    if (!place || !timeline?.epochs.length) return;
    const id = requestRef.current;
    const dates = timeline.epochs.map((item) => item.date).join(",");
    const years = timeline.epochs.map((item) => item.year).join(",");

    fetch(`/api/streamflow?lat=${place.lat}&lon=${place.lon}&dates=${dates}`)
      .then(async (res) => (res.ok ? ((await res.json()) as StreamflowResult) : null))
      .then((data) => {
        if (id !== requestRef.current || !data?.gauge) return;
        setStreamflow(data);
      })
      .catch(() => undefined);

    fetch(`/api/climate?lat=${place.lat}&lon=${place.lon}&years=${years}`)
      .then(async (res) => (res.ok ? ((await res.json()) as ClimateSummary) : null))
      .then((data) => {
        if (id !== requestRef.current || !data) return;
        setClimate(data);
      })
      .catch(() => undefined);
  }, [place, timeline]);

  const reading = useMemo(() => {
    if (!streamflow) return null;
    const date = epoch?.date ?? streamflow.readings[streamflow.readings.length - 1]?.date;
    return streamflow.readings.find((item) => item.date === date) ?? null;
  }, [streamflow, epoch]);

  useEffect(() => {
    if (!place || !hydrology) return;
    const id = requestRef.current;
    const params = new URLSearchParams({
      lat: String(place.lat),
      lon: String(place.lon),
      waterbodies: String(hydrology.stats.waterbodyCount),
      wetlands: String(hydrology.stats.wetlandCount),
      named: hydrology.stats.namedChannels.slice(0, 8).join("|"),
    });
    if (reading?.percentile != null) {
      params.set("percentile", String(reading.percentile));
    }

    fetch(`/api/ground?${params}`)
      .then(async (res) => (res.ok ? ((await res.json()) as GroundSummary) : null))
      .then((data) => {
        if (id !== requestRef.current || !data) return;
        setGround(data);
      })
      .catch(() => undefined);
  }, [place, hydrology, reading?.percentile]);

  const flow = useMemo(() => flowFromReading(reading), [reading]);

  const mappedHydrology = useMemo(
    () => (hydrology ? flowlinesForReading(hydrology, reading) : null),
    [hydrology, reading],
  );

  const prefetchEpoch = useCallback((item: ImageryEpoch) => {
    const map = mapRef.current;
    if (!map) return;
    const centre = map.getCenter();
    prefetchTiles(item.tileUrl, { lat: centre.lat, lon: centre.lng, zoom: map.getZoom() });
  }, []);

  const jumpWetDry = useCallback(
    (kind: "wettest" | "driest") => {
      if (!timeline?.epochs.length || !climate) return;
      const year = kind === "wettest" ? climate.wettestYear : climate.driestYear;
      const next = epochForYear(timeline.epochs, year);
      if (!next) return;
      prefetchEpoch(next);
      setEpoch(next);
      setEpochBlend(1);
    },
    [timeline, climate, prefetchEpoch],
  );

  const returnToOrbit = () => {
    requestRef.current += 1;
    mapRef.current = null;
    setPhase("orbit");
    setPlace(null);
    setFromPlace(null);
    setMapRevealed(false);
    setDescentFade(0);
    setHydrology(null);
    setBaseHydrology(null);
    setTimeline(null);
    setStreamflow(null);
    setClimate(null);
    setGround(null);
    setEpoch(null);
    setWiki(null);
    setWikiLoading(false);
    setWikiOpen(true);
  };

  const showMap = phase === "site" && place !== null;
  const descending = phase === "descending";
  const covered = showMap && !mapRevealed;

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-[#04060c]">
      <div className={`absolute inset-0 ${phase === "orbit" || descending ? "" : "pointer-events-none"}`}>
        <Globe
          target={globeTarget}
          from={globeFrom}
          flying={phase === "descending"}
          interactive={phase === "orbit"}
          onProgress={(t) => setDescentFade(smoothstep(FADE_START, FADE_END, t))}
          onArrive={() => {
            setPhase("site");
            later(() => setMapRevealed(true), REVEAL_CAP_MS);
          }}
        />
      </div>

      {showMap && (
        <div className="absolute inset-0">
          <SiteMap
            center={{ lat: place.lat, lon: place.lon }}
            bounds={place.bbox}
            hydrology={mappedHydrology}
            floodPolygons={ground?.floodPolygons ?? null}
            epoch={epoch}
            epochBlend={epochBlend}
            toggles={toggles}
            flowSpeed={flow.speed * speedBias}
            flowScale={flow.scale}
            waterOpacity={flow.waterOpacity}
            onReady={(map) => {
              mapRef.current = map;
            }}
            onFirstIdle={() => setMapRevealed(true)}
            onEpochLoadingChange={setEpochLoading}
            onViewChange={setView}
          />
        </div>
      )}

      <motion.div
        className="pointer-events-none absolute inset-0 z-40 bg-[#04060c]"
        initial={false}
        animate={{ opacity: descending ? descentFade : covered ? 1 : 0 }}
        transition={
          descending
            ? { duration: 0.12, ease: "linear" }
            : { duration: 0.45, ease: "easeInOut" }
        }
      />

      <AnimatePresence>
        {phase === "orbit" && (
          <motion.div
            key="hero"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.3 } }}
            className="pointer-events-none absolute inset-0 flex flex-col"
          >
            <div className="absolute inset-y-0 left-0 w-full bg-gradient-to-r from-[#04060c]/95 via-[#04060c]/55 to-transparent md:w-[46%]" />

            <div className="pointer-events-auto relative flex flex-col gap-6 px-6 pt-10 md:gap-7 md:px-14 md:pt-14">
              <h1 className="max-w-lg text-3xl leading-[1.08] font-semibold tracking-tight text-[#e9eff8] md:text-[44px]">
                Trace where the <span className="text-[#38bdf8]">water</span> flows.
              </h1>

              <div className="w-full max-w-xl">
                <SearchBar onSelect={selectPlace} autoFocus />
              </div>

              <DemoPath onSelect={selectPlace} />
            </div>

            <div className="relative mt-auto flex items-end justify-between px-6 pb-6 text-[11px] text-[#4a5d78] md:px-14 md:pb-8">
              <span className="pointer-events-auto flex items-center gap-1.5">
                <Compass className="size-3.5" />
                Drag to orbit · scroll to zoom
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showMap && (
          <motion.div
            key="site-chrome"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, delay: 0.12 }}
            className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start gap-2 p-3 md:gap-3 md:p-5"
          >
            <Button
              variant="outline"
              size="icon"
              onClick={returnToOrbit}
              className="pointer-events-auto shrink-0"
              aria-label="Back to the globe"
            >
              <ArrowLeft />
            </Button>
            <div className="pointer-events-auto w-full max-w-sm">
              <SearchBar onSelect={selectPlace} compact placeholder="Search another place" />
            </div>
            <div className="glass-dark tabular ml-auto hidden shrink-0 items-center gap-3 rounded-md px-3 py-2 text-[11px] text-[#9fb3cd] lg:flex">
              <span>z {view.zoom.toFixed(1)}</span>
              <span className="text-[#3d4f68]">|</span>
              <span>{view.pitch}° pitch</span>
              <span className="text-[#3d4f68]">|</span>
              <span>{view.bearing}° bearing</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {place && phase === "site" && (
        <div className="pointer-events-none absolute inset-0 z-30">
          {wikiOpen ? (
            <PlaceWikiCard
              key={place.id}
              placeName={place.name}
              city={wiki}
              loading={wikiLoading}
              visible={Boolean(wiki) || wikiLoading}
              onClose={() => setWikiOpen(false)}
            />
          ) : (
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center p-3 md:p-5">
              <button
                type="button"
                onClick={() => setWikiOpen(true)}
                className="glass-dark pointer-events-auto flex items-center gap-2 rounded-md px-2.5 py-3 text-[#b7c7dc] transition-colors hover:text-white"
                aria-label="Show Wikipedia card"
                title="Wikipedia"
              >
                <span className="text-[11px] font-medium tracking-wide">Wiki</span>
              </button>
            </div>
          )}
        </div>
      )}

      {showMap && (
        <AnalysisPanel
          key={place.id}
          place={place}
          hydrology={baseHydrology}
          hydrologyError={hydrologyError}
          timeline={timeline}
          streamflow={streamflow}
          climate={climate}
          ground={ground}
          reading={reading}
          epoch={epoch}
          epochBlend={epochBlend}
          epochLoading={epochLoading}
          toggles={toggles}
          speedBias={speedBias}
          onEpochChange={setEpoch}
          onEpochPrefetch={prefetchEpoch}
          onBlendChange={setEpochBlend}
          onSpeedBiasChange={setSpeedBias}
          onWetDry={jumpWetDry}
          onToggle={(key) => setToggles((current) => ({ ...current, [key]: !current[key] }))}
        />
      )}
    </main>
  );
}
