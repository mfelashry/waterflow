"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  ArrowUp,
  BarChart3,
  ChevronDown,
  History,
  Layers,
  Loader2,
  MessageSquare,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  AnalysisResult,
  FlowReading,
  HydrologyResponse,
  ImageryEpoch,
  ImageryTimeline,
  Place,
  StreamflowResult,
} from "@/lib/types";
import type { LayerToggles } from "@/components/map/SiteMap";

type AnalysisPanelProps = {
  place: Place;
  hydrology: HydrologyResponse | null;
  hydrologyError: string | null;
  timeline: ImageryTimeline | null;
  streamflow: StreamflowResult | null;
  reading: FlowReading | null;
  epoch: ImageryEpoch | null;
  epochBlend: number;
  epochLoading: boolean;
  toggles: LayerToggles;
  speedBias: number;
  onEpochChange: (epoch: ImageryEpoch | null) => void;
  onEpochPrefetch: (epoch: ImageryEpoch) => void;
  onBlendChange: (value: number) => void;
  onToggle: (key: keyof LayerToggles) => void;
  onSpeedBiasChange: (value: number) => void;
};

type TabKey = "analysis" | "ask" | "measurements" | "imagery" | "layers";

const TABS: { key: TabKey; label: string; icon: typeof Sparkles }[] = [
  { key: "analysis", label: "Analysis", icon: Sparkles },
  { key: "ask", label: "Ask Grok", icon: MessageSquare },
  { key: "measurements", label: "Measurements", icon: BarChart3 },
  { key: "imagery", label: "Imagery", icon: History },
  { key: "layers", label: "Layers", icon: Layers },
];

const TOGGLE_META: { key: keyof LayerToggles; label: string; color: string }[] = [
  { key: "flow", label: "Water flow", color: "#38bdf8" },
  { key: "waterbodies", label: "Water", color: "#2a8fe0" },
  { key: "wetlands", label: "Wetland", color: "#3fd39a" },
  { key: "buildings", label: "Buildings", color: "#c6dcf3" },
  { key: "roads", label: "Roads", color: "#ffb15c" },
];

const RISK_COLOR: Record<AnalysisResult["riskLevel"], string> = {
  low: "#6ee7b7",
  moderate: "#7dd3fc",
  elevated: "#fbd38d",
  high: "#fca5a5",
};

const SUGGESTED = [
  "Where would runoff pond first here?",
  "How does this year compare to the driest capture?",
  "What should I look at before building here?",
];

type Exchange = { question: string; answer: string | null; error?: string };

export default function AnalysisPanel({
  place,
  hydrology,
  hydrologyError,
  timeline,
  streamflow,
  reading,
  epoch,
  epochBlend,
  epochLoading,
  toggles,
  speedBias,
  onEpochChange,
  onEpochPrefetch,
  onBlendChange,
  onToggle,
  onSpeedBiasChange,
}: AnalysisPanelProps) {
  const [tab, setTab] = useState<TabKey>("analysis");
  const [open, setOpen] = useState(true);
  const [detail, setDetail] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const [question, setQuestion] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [asking, setAsking] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hydrology) return;
    const controller = new AbortController();

    fetch("/api/analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        place: { name: place.name, detail: place.detail, lat: place.lat, lon: place.lon },
        stats: hydrology.stats,
        imageryYears: timeline?.epochs.map((item) => item.year) ?? [],
        streamflow: streamflow
          ? { gauge: streamflow.gauge.name, median: streamflow.median, reading }
          : null,
      }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Analysis failed (${res.status})`);
        return (await res.json()) as AnalysisResult;
      })
      .then((result) => {
        setAnalysis(result);
        setFailed(false);
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") setFailed(true);
      });

    return () => controller.abort();
    // Switching capture years should not re-run the analysis; only retry should.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrology, attempt, place.name, place.lat, place.lon, timeline, streamflow]);

  const ask = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || asking) return;
    setQuestion("");
    setAsking(true);
    setExchanges((current) => [...current, { question: trimmed, answer: null }]);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          place: { name: place.name, detail: place.detail, lat: place.lat, lon: place.lon },
          stats: hydrology?.stats ?? null,
          imageryYears: timeline?.epochs.map((item) => item.year) ?? [],
          streamflow: streamflow
            ? { gauge: streamflow.gauge.name, median: streamflow.median, reading }
            : null,
        }),
      });
      const json = (await res.json()) as { answer?: string; error?: string };
      setExchanges((current) =>
        current.map((item, index) =>
          index === current.length - 1
            ? { ...item, answer: json.answer ?? null, error: json.error }
            : item,
        ),
      );
    } catch {
      setExchanges((current) =>
        current.map((item, index) =>
          index === current.length - 1 ? { ...item, error: "Grok could not be reached." } : item,
        ),
      );
    } finally {
      setAsking(false);
      requestAnimationFrame(() =>
        threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" }),
      );
    }
  };

  const retry = () => {
    setAnalysis(null);
    setFailed(false);
    setAttempt((value) => value + 1);
  };

  const stats = hydrology?.stats;
  const pending = !analysis && !failed;

  return (
    <div className="pointer-events-none absolute inset-y-0 left-0 z-30 flex items-center gap-2 p-3 md:p-5">
      <nav
        aria-label="Site information"
        className="glass-dark pointer-events-auto flex flex-col gap-1 rounded-md p-1.5"
      >
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = open && tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                if (open && tab === key) {
                  setOpen(false);
                  return;
                }
                setTab(key);
                setOpen(true);
              }}
              aria-pressed={active}
              title={label}
              className="relative grid size-10 place-items-center rounded transition-colors"
            >
              {active && (
                <motion.span
                  layoutId="tab-highlight"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  className="absolute inset-0 rounded bg-[#38bdf8]"
                />
              )}
              <Icon
                className={cn(
                  "relative size-[18px] transition-colors",
                  active ? "text-[#03151f]" : "text-[#8ea3c0] hover:text-white",
                )}
              />
              <span className="sr-only">{label}</span>
            </button>
          );
        })}
      </nav>

      <AnimatePresence initial={false}>
        {open && (
          <motion.section
            key="drawer"
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
            className="glass-dark scroll-slim pointer-events-auto flex max-h-[calc(100dvh-2.5rem)] w-[min(372px,calc(100vw-6.5rem))] flex-col overflow-hidden rounded-md"
          >
            <header className="flex items-start gap-3 border-b border-white/10 px-4 py-3">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[16px] leading-tight font-semibold tracking-tight text-white">
                  {place.name}
                </h2>
                <p className="truncate text-[12px] text-[#93a7c0]">
                  {place.detail || place.category}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-[#7387a1] transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Close panel"
              >
                <X className="size-4" />
              </button>
            </header>

            <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {hydrologyError && (
                <p className="mb-3 rounded bg-[rgba(242,120,92,0.12)] px-3 py-2 text-[12px] text-[#ffa48c]">
                  {hydrologyError}
                </p>
              )}

              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={tab}
                  initial={{ opacity: 0, x: 18 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -18 }}
                  transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                >
                  {tab === "analysis" && (
                    <>
                      {pending && (
                        <div className="flex items-center gap-2 text-[13px] text-[#93a7c0]">
                          <Loader2 className="size-3.5 animate-spin text-[#38bdf8]" />
                          Reading the channel network
                        </div>
                      )}

                      {failed && (
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[13px] text-[#ffa48c]">Could not be generated.</p>
                          <Button size="sm" variant="subtle" onClick={retry}>
                            <RefreshCw /> Retry
                          </Button>
                        </div>
                      )}

                      {analysis && (
                        <>
                          <div className="flex items-center gap-2">
                            <span
                              className="size-1.5 rounded-full"
                              style={{
                                background: RISK_COLOR[analysis.riskLevel],
                                boxShadow: `0 0 10px ${RISK_COLOR[analysis.riskLevel]}`,
                              }}
                            />
                            <span
                              className="text-[11px] font-medium capitalize"
                              style={{ color: RISK_COLOR[analysis.riskLevel] }}
                            >
                              {analysis.riskLevel} runoff pressure
                            </span>
                          </div>

                          <p className="mt-2 text-[15px] leading-snug font-semibold text-white">
                            {analysis.headline}
                          </p>
                          <p className="mt-2 text-[13px] leading-relaxed text-[#b7c7dc]">
                            {analysis.summary}
                          </p>

                          <AnimatePresence initial={false}>
                            {detail && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                                className="overflow-hidden"
                              >
                                <div className="space-y-3.5 pt-4">
                                  {analysis.sections.map((section, index) => (
                                    <motion.div
                                      key={section.heading}
                                      initial={{ opacity: 0, y: 8 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      transition={{ duration: 0.26, delay: 0.04 * index }}
                                    >
                                      <h4 className="text-[13px] font-semibold text-white/90">
                                        {section.heading}
                                      </h4>
                                      <p className="mt-1 text-[13px] leading-relaxed text-[#9db1c8]">
                                        {section.body}
                                      </p>
                                    </motion.div>
                                  ))}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>

                          <div className="mt-3 flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() => setDetail((value) => !value)}
                              aria-expanded={detail}
                              className="flex items-center gap-1 text-[12px] font-medium text-[#38bdf8] transition-opacity hover:opacity-75"
                            >
                              {detail ? "Less" : "Read more"}
                              <motion.span
                                animate={{ rotate: detail ? 180 : 0 }}
                                transition={{ duration: 0.25 }}
                              >
                                <ChevronDown className="size-3.5" />
                              </motion.span>
                            </button>
                            <span className="text-[10px] text-[#64788f]">
                              {analysis.generatedBy === "xai"
                                ? `Powered by xAI · ${analysis.model}`
                                : "Powered by xAI · add a key"}
                            </span>
                          </div>
                        </>
                      )}
                    </>
                  )}

                  {tab === "ask" && (
                    <div className="flex flex-col gap-3">
                      <p className="text-[12px] leading-relaxed text-[#93a7c0]">
                        Ask about this site. Grok only sees the measurements on this panel.
                      </p>

                      <div ref={threadRef} className="scroll-slim max-h-[38dvh] space-y-3 overflow-y-auto">
                        {exchanges.map((item, index) => (
                          <motion.div
                            key={index}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.25 }}
                            className="space-y-1.5"
                          >
                            <p className="rounded bg-[rgba(56,189,248,0.14)] px-2.5 py-1.5 text-[13px] text-white">
                              {item.question}
                            </p>
                            {item.answer && (
                              <p className="px-0.5 text-[13px] leading-relaxed text-[#b7c7dc]">
                                {item.answer}
                              </p>
                            )}
                            {item.error && (
                              <p className="px-0.5 text-[13px] text-[#ffa48c]">{item.error}</p>
                            )}
                            {!item.answer && !item.error && (
                              <p className="flex items-center gap-2 px-0.5 text-[13px] text-[#93a7c0]">
                                <Loader2 className="size-3.5 animate-spin text-[#38bdf8]" />
                                Thinking
                              </p>
                            )}
                          </motion.div>
                        ))}
                      </div>

                      {exchanges.length === 0 && (
                        <div className="flex flex-col items-start gap-1.5">
                          {SUGGESTED.map((item) => (
                            <button
                              key={item}
                              type="button"
                              onClick={() => ask(item)}
                              className="rounded border border-white/12 px-2.5 py-1.5 text-left text-[12px] text-[#b7c7dc] transition-colors hover:border-[#38bdf8]/60 hover:text-white"
                            >
                              {item}
                            </button>
                          ))}
                        </div>
                      )}

                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          void ask(question);
                        }}
                        className="flex items-center gap-2 rounded border border-white/12 bg-white/[0.04] px-2.5 py-1.5"
                      >
                        <input
                          value={question}
                          onChange={(event) => setQuestion(event.target.value)}
                          placeholder="Ask a question about this site"
                          aria-label="Ask Grok a question about this site"
                          className="min-w-0 flex-1 bg-transparent text-[13px] text-white placeholder:text-[#64788f] outline-none"
                        />
                        <button
                          type="submit"
                          disabled={!question.trim() || asking}
                          aria-label="Send question"
                          className="grid size-6 shrink-0 place-items-center rounded bg-[#38bdf8] text-[#03151f] transition-opacity disabled:opacity-35"
                        >
                          <ArrowUp className="size-3.5" />
                        </button>
                      </form>
                      <span className="text-[10px] text-[#64788f]">Powered by xAI</span>
                    </div>
                  )}

                  {tab === "measurements" &&
                    (stats ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-2">
                          <Figure
                            value={`${stats.channelCount}`}
                            label="channel segments"
                            note={`${stats.channelKm.toFixed(1)} km total`}
                          />
                          <Figure
                            value={
                              stats.elevationRange
                                ? `${(stats.elevationRange[1] - stats.elevationRange[0]).toFixed(0)} m`
                                : "—"
                            }
                            label="relief"
                            note={
                              stats.elevationRange
                                ? `${stats.elevationRange[0]}–${stats.elevationRange[1]} m`
                                : "outside USGS coverage"
                            }
                          />
                          <Figure
                            value={`${stats.buildingCount}`}
                            label="roofs"
                            note={`${stats.impervousKm.toFixed(0)} km of road`}
                          />
                          <Figure
                            value={`${stats.waterbodyCount + stats.wetlandCount}`}
                            label="storage features"
                            note={`${stats.waterbodyCount} water · ${stats.wetlandCount} wetland`}
                          />
                        </div>

                        {stats.namedChannels.length > 0 && (
                          <div>
                            <Label>Named channels</Label>
                            <p className="text-[13px] leading-relaxed text-[#b7c7dc]">
                              {stats.namedChannels.join(" · ")}
                            </p>
                          </div>
                        )}

                        <p className="text-[11px] leading-relaxed text-[#64788f]">
                          Channels from {stats.sources.join(" and ") || "OpenStreetMap"}. Roofs and
                          roads from OpenStreetMap. Elevation from the USGS elevation service.
                        </p>
                      </div>
                    ) : (
                      <Skeleton />
                    ))}

                  {tab === "imagery" &&
                    (timeline ? (
                      <div className="space-y-4">
                        <div>
                          <Label>
                            {timeline.epochs.length} distinct captures
                            {epochLoading ? " · loading" : ""}
                          </Label>
                          <div className="flex flex-wrap gap-1.5">
                            <Chip active={!epoch} onClick={() => onEpochChange(null)}>
                              Today
                            </Chip>
                            {timeline.epochs.map((item) => (
                              <Chip
                                key={item.release}
                                active={epoch?.release === item.release}
                                onClick={() => onEpochChange(item)}
                                onHover={() => onEpochPrefetch(item)}
                                title={`Archived ${item.date}`}
                              >
                                {item.label}
                              </Chip>
                            ))}
                          </div>
                        </div>

                        <AnimatePresence initial={false}>
                          {epoch && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="flex items-center gap-3">
                                <span className="text-[11px] text-[#93a7c0]">Today</span>
                                <input
                                  type="range"
                                  min={0}
                                  max={1}
                                  step={0.02}
                                  value={epochBlend}
                                  onChange={(event) => onBlendChange(Number(event.target.value))}
                                  className="h-1 flex-1 accent-[#38bdf8]"
                                  aria-label="Blend between today's and archived imagery"
                                />
                                <span className="tabular text-[11px] font-medium text-[#38bdf8]">
                                  {epoch.year}
                                </span>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        <div className="rounded border border-white/10 bg-[rgba(56,189,248,0.07)] p-3">
                          <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#38bdf8]">
                            <Activity className="size-3" />
                            Flow on this capture
                          </div>
                          {streamflow && reading ? (
                            <>
                              <p className="tabular mt-1.5 text-[20px] leading-none font-semibold text-white">
                                {reading.discharge.toLocaleString()}
                                <span className="ml-1 text-[12px] font-normal text-[#93a7c0]">
                                  ft³/s
                                </span>
                              </p>
                              <p className="mt-1.5 text-[12px] leading-relaxed text-[#b7c7dc]">
                                {reading.ratioToMedian >= 1
                                  ? `${reading.ratioToMedian.toFixed(2)}× the median flow`
                                  : `${(1 / reading.ratioToMedian).toFixed(2)}× below the median flow`}
                                , at the {Math.round(reading.percentile * 100)}
                                {ordinal(Math.round(reading.percentile * 100))} percentile of the
                                record. The channels are drawn at this discharge.
                              </p>
                              <p className="mt-2 text-[11px] text-[#64788f]">
                                {titleCase(streamflow.gauge.name)} · {streamflow.gauge.distanceKm} km
                                away · measured {epoch?.date ?? reading.date}
                              </p>
                            </>
                          ) : (
                            <p className="mt-1.5 text-[12px] leading-relaxed text-[#93a7c0]">
                              No USGS stream gauge with a record for these dates sits near this
                              site, so the channels keep their default width.
                            </p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <Skeleton />
                    ))}

                  {tab === "layers" && (
                    <div className="space-y-4">
                      <div className="flex flex-wrap gap-1.5">
                        {TOGGLE_META.map((meta) => (
                          <button
                            key={meta.key}
                            type="button"
                            role="switch"
                            aria-checked={toggles[meta.key]}
                            onClick={() => onToggle(meta.key)}
                            className={cn(
                              "flex items-center gap-1.5 rounded border px-2.5 py-1 text-[12px] font-medium transition-colors",
                              toggles[meta.key]
                                ? "border-white/25 bg-white/10 text-white"
                                : "border-white/12 text-[#7387a1] hover:text-[#b7c7dc]",
                            )}
                          >
                            <span
                              className="size-1.5 rounded-full"
                              style={{
                                background: toggles[meta.key] ? meta.color : "transparent",
                                border: `1px solid ${meta.color}`,
                              }}
                            />
                            {meta.label}
                          </button>
                        ))}
                      </div>

                      <div>
                        <Label>Animation speed</Label>
                        <div className="flex items-center gap-3">
                          <input
                            type="range"
                            min={0}
                            max={2.5}
                            step={0.05}
                            value={speedBias}
                            onChange={(event) => onSpeedBiasChange(Number(event.target.value))}
                            className="h-1 flex-1 accent-[#38bdf8]"
                            aria-label="Flow animation speed"
                          />
                          <span className="tabular w-10 text-right text-[11px] text-[#93a7c0]">
                            {speedBias.toFixed(2)}×
                          </span>
                        </div>
                        <p className="mt-1.5 text-[11px] leading-relaxed text-[#64788f]">
                          The base speed already tracks the measured discharge; this scales it.
                        </p>
                      </div>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}

function ordinal(value: number) {
  if (value % 100 >= 11 && value % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][value % 10] ?? "th";
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (character) => character.toUpperCase())
    .replace(/\bVa\b/, "VA");
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-[11px] tracking-[0.09em] text-[#64788f] uppercase">{children}</h3>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="loading-sheen relative h-9 overflow-hidden rounded bg-white/[0.05]"
        />
      ))}
    </div>
  );
}

function Figure({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <div className="rounded border border-white/10 bg-white/[0.04] px-3 py-2.5">
      <div className="tabular text-[18px] leading-none font-semibold text-white">{value}</div>
      <div className="mt-1 text-[11px] text-[#93a7c0]">{label}</div>
      {note && <div className="mt-0.5 truncate text-[10px] text-[#64788f]">{note}</div>}
    </div>
  );
}

function Chip({
  active,
  onClick,
  onHover,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  onHover?: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerEnter={onHover}
      title={title}
      className={cn(
        "tabular rounded border px-2.5 py-1 text-[12px] font-medium transition-colors",
        active
          ? "border-[#38bdf8] bg-[#38bdf8] text-[#03151f]"
          : "border-white/14 text-[#b7c7dc] hover:border-[#38bdf8]/70 hover:text-white",
      )}
    >
      {children}
    </button>
  );
}
