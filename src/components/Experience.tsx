"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Compass } from "lucide-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import SearchBar from "@/components/SearchBar";
import AnalysisPanel from "@/components/panel/AnalysisPanel";
import { Button } from "@/components/ui/button";
import { clamp } from "@/lib/geo";
import { prefetchTiles } from "@/lib/prefetch";
import type { LayerToggles } from "@/components/map/SiteMap";
import type {
  FlowReading,
  HydrologyResponse,
  ImageryEpoch,
  ImageryTimeline,
  Place,
  StreamflowResult,
} from "@/lib/types";

const Globe = dynamic(() => import("@/components/globe/Globe"), { ssr: false });
const SiteMap = dynamic(() => import("@/components/map/SiteMap"), { ssr: false });

type Phase = "orbit" | "returning" | "descending" | "site";

const DEFAULT_TOGGLES: LayerToggles = {
  flow: true,
  waterbodies: true,
  wetlands: true,
  buildings: true,
  roads: false,
};

/** How long the globe is given to climb back to orbit before the next descent. */
const PULL_BACK_MS = 1150;
/** The reveal never waits on tiles longer than this. */
const REVEAL_CAP_MS = 2400;

/** Map a discharge ratio onto how wide and how fast the channels are drawn. */
function flowFromReading(reading: FlowReading | null) {
  if (!reading) return { scale: 1, speed: 0.62 };
  const ratio = clamp(reading.ratioToMedian, 0.15, 6);
  return {
    scale: Number(clamp(0.6 + 0.72 * Math.sqrt(ratio), 0.6, 2.3).toFixed(3)),
    speed: Number(clamp(0.34 + 0.46 * ratio, 0.24, 1.6).toFixed(3)),
  };
}

export default function Experience() {
  const [phase, setPhase] = useState<Phase>("orbit");
  const [place, setPlace] = useState<Place | null>(null);
  const [mapRevealed, setMapRevealed] = useState(false);

  const [hydrology, setHydrology] = useState<HydrologyResponse | null>(null);
  const [hydrologyError, setHydrologyError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<ImageryTimeline | null>(null);
  const [streamflow, setStreamflow] = useState<StreamflowResult | null>(null);
  const [epoch, setEpoch] = useState<ImageryEpoch | null>(null);
  const [epochBlend, setEpochBlend] = useState(1);
  const [epochLoading, setEpochLoading] = useState(false);
  const [toggles, setToggles] = useState<LayerToggles>(DEFAULT_TOGGLES);
  const [speedBias, setSpeedBias] = useState(1);
  const [view, setView] = useState({ zoom: 13.6, pitch: 52, bearing: -18 });

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

  const beginDescent = useCallback((next: Place) => {
    setPlace(next);
    setPhase("descending");
  }, []);

  const selectPlace = useCallback(
    (next: Place) => {
      requestRef.current += 1;
      setMapRevealed(false);
      setHydrology(null);
      setHydrologyError(null);
      setTimeline(null);
      setStreamflow(null);
      setEpoch(null);
      setEpochBlend(1);
      setEpochLoading(false);

      // Coming from a site, climb back to orbit first so the move reads as leaving one
      // place and travelling to another rather than teleporting.
      if (phase === "site") {
        mapRef.current = null;
        setPlace(null);
        setPhase("returning");
        later(() => beginDescent(next), PULL_BACK_MS);
        return;
      }
      beginDescent(next);
    },
    [phase, later, beginDescent],
  );

  // Site data is fetched while the camera is still descending, so the map has layers
  // the moment it appears.
  useEffect(() => {
    if (!place) return;
    const id = (requestRef.current += 1);
    const params = `lat=${place.lat}&lon=${place.lon}`;

    fetch(`/api/hydrology?${params}&radiusKm=3`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Hydrology service returned ${res.status}`);
        return (await res.json()) as HydrologyResponse;
      })
      .then((data) => {
        if (id !== requestRef.current) return;
        setHydrology(data);
        if (data.stats.channelCount === 0) {
          setHydrologyError("No mapped channels within 3 km of this point.");
        }
      })
      .catch((error: Error) => {
        if (id !== requestRef.current) return;
        setHydrologyError(error.message);
      });

    fetch(`/api/imagery/timeline?${params}`)
      .then(async (res) => (res.ok ? ((await res.json()) as ImageryTimeline) : null))
      .then((data) => {
        if (id !== requestRef.current || !data) return;
        setTimeline(data);
      })
      .catch(() => undefined);
  }, [place]);

  // Measured discharge on each capture date, so switching imagery also switches the
  // river to the flow the gauge recorded that day.
  useEffect(() => {
    if (!place || !timeline?.epochs.length) return;
    const id = requestRef.current;
    const dates = timeline.epochs.map((item) => item.date).join(",");

    fetch(`/api/streamflow?lat=${place.lat}&lon=${place.lon}&dates=${dates}`)
      .then(async (res) => (res.ok ? ((await res.json()) as StreamflowResult) : null))
      .then((data) => {
        if (id !== requestRef.current || !data?.gauge) return;
        setStreamflow(data);
      })
      .catch(() => undefined);
  }, [place, timeline]);

  const reading = useMemo(() => {
    if (!streamflow) return null;
    const date = epoch?.date ?? streamflow.readings[streamflow.readings.length - 1]?.date;
    return streamflow.readings.find((item) => item.date === date) ?? null;
  }, [streamflow, epoch]);

  const flow = useMemo(() => flowFromReading(reading), [reading]);

  const prefetchEpoch = useCallback((item: ImageryEpoch) => {
    const map = mapRef.current;
    if (!map) return;
    const centre = map.getCenter();
    prefetchTiles(item.tileUrl, { lat: centre.lat, lon: centre.lng, zoom: map.getZoom() });
  }, []);

  const returnToOrbit = () => {
    requestRef.current += 1;
    mapRef.current = null;
    setPhase("orbit");
    setPlace(null);
    setMapRevealed(false);
    setHydrology(null);
    setTimeline(null);
    setStreamflow(null);
    setEpoch(null);
  };

  const showMap = phase === "site" && place !== null;
  const showGlobe = phase !== "site";
  const covered = phase === "descending" || (showMap && !mapRevealed);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-[#04060c]">
      {/* The globe is torn down once the map takes over; nothing renders behind it. */}
      {showGlobe && (
        <div className="absolute inset-0">
          <Globe
            target={globeTarget}
            flying={phase === "descending"}
            interactive={phase === "orbit"}
            onArrive={() => {
              setPhase("site");
              later(() => setMapRevealed(true), REVEAL_CAP_MS);
            }}
          />
        </div>
      )}

      {showMap && (
        <div className="absolute inset-0">
          <SiteMap
            center={{ lat: place.lat, lon: place.lon }}
            hydrology={hydrology}
            epoch={epoch}
            epochBlend={epochBlend}
            toggles={toggles}
            flowSpeed={flow.speed * speedBias}
            flowScale={flow.scale}
            onReady={(map) => {
              mapRef.current = map;
            }}
            onFirstIdle={() => setMapRevealed(true)}
            onEpochLoadingChange={setEpochLoading}
            onViewChange={setView}
          />
        </div>
      )}

      {/* The screen goes dark across the handover so no coarse tiles are ever seen. */}
      <motion.div
        className="pointer-events-none absolute inset-0 z-40 bg-[#04060c]"
        initial={false}
        animate={{ opacity: covered ? 1 : 0 }}
        transition={{
          duration: phase === "descending" ? 0.42 : 0.5,
          delay: phase === "descending" ? 1.95 : 0,
          ease: "easeInOut",
        }}
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

            <div className="pointer-events-auto relative flex flex-col gap-7 px-6 pt-10 md:px-14 md:pt-14">
              <h1 className="max-w-lg text-3xl leading-[1.08] font-semibold tracking-tight text-[#e9eff8] md:text-[44px]">
                Trace where the water goes,
                <span className="block text-[#8fe0f8]">anywhere on Earth.</span>
              </h1>

              <div className="w-full max-w-xl">
                <SearchBar onSelect={selectPlace} autoFocus />
              </div>
            </div>

            <div className="relative mt-auto flex items-center justify-between px-6 pb-6 text-[11px] text-[#4a5d78] md:px-14 md:pb-8">
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
            transition={{ duration: 0.45, delay: 0.15 }}
            className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start gap-3 p-3 md:p-5"
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

      {showMap && (
        <AnalysisPanel
          key={place.id}
          place={place}
          hydrology={hydrology}
          hydrologyError={hydrologyError}
          timeline={timeline}
          streamflow={streamflow}
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
          onToggle={(key) => setToggles((current) => ({ ...current, [key]: !current[key] }))}
        />
      )}
    </main>
  );
}
