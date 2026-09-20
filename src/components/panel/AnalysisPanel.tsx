"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CloudRain,
  FileText,
  History,
  Layers,
  Loader2,
  MessageSquare,
  Minus,
  RefreshCw,
  Mountain,
  Droplets,
  ShieldAlert,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import MarimoPanel from "@/components/panel/MarimoPanel";
import { buildReportDocument } from "@/lib/reportDocument";
import type { GroundSummary } from "@/lib/ground";
import { FLOOD_LEVEL_META } from "@/lib/ground";
import type { ResearchSource } from "@/lib/research";
import { cn } from "@/lib/utils";
import type {
  AnalysisResult,
  ClimateSummary,
  FlowReading,
  HydrologyResponse,
  ImageryEpoch,
  ImageryTimeline,
  Place,
  StreamflowResult,
} from "@/lib/types";
import type { LayerToggles } from "@/components/map/SiteMap";

type CityReport = {
  title: string;
  subtitle: string;
  generatedAt: string;
  coordinates: { lat: number; lon: number };
  city: {
    name: string;
    description: string | null;
    blurb: string;
    population: number | null;
    river: string | null;
    country: string | null;
    areaKm2: number | null;
    sourceUrl: string | null;
    thumbnailUrl: string | null;
  } | null;
  headline: string;
  summary: string;
  riskLevel: AnalysisResult["riskLevel"];
  sections: { heading: string; body: string }[];
  metrics: { label: string; value: string }[];
  rainTable: { year: number; precipMm: number; note: string }[];
  namedChannels: string[];
  dataSources: string[];
  model: string;
  generatedBy: "xai" | "local";
};

type AnalysisPanelProps = {
  place: Place;
  hydrology: HydrologyResponse | null;
  hydrologyError: string | null;
  timeline: ImageryTimeline | null;
  streamflow: StreamflowResult | null;
  climate: ClimateSummary | null;
  ground: GroundSummary | null;
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
  onWetDry: (kind: "wettest" | "driest") => void;
};

type TabKey =
  | "analysis"
  | "ask"
  | "imagery"
  | "layers"
  | "report"
  | "ground"
  | "marimo";

const TABS: { key: TabKey; label: string; icon: typeof Sparkles }[] = [
  { key: "analysis", label: "Analysis", icon: Sparkles },
  { key: "ask", label: "Chat", icon: MessageSquare },
  { key: "marimo", label: "Charts", icon: Activity },
  { key: "report", label: "Report", icon: FileText },
  { key: "ground", label: "Ground", icon: Mountain },
  { key: "imagery", label: "Imagery", icon: History },
  { key: "layers", label: "Layers", icon: Layers },
];

const TOGGLE_META: { key: keyof LayerToggles; label: string; color: string }[] = [
  { key: "flow", label: "Water flow", color: "#38bdf8" },
  { key: "waterbodies", label: "Surface water", color: "#2a8fe0" },
  { key: "wetlands", label: "Wetland", color: "#3fd39a" },
  { key: "flood", label: "Flood zones", color: "#f87171" },
  { key: "topo", label: "Topo map", color: "#d6d3d1" },
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
  "How have data centers changed water use and stormwater around here?",
  "What should I know about flood risk at this pin?",
  "Which named streams matter most on this map?",
];

type Exchange = {
  question: string;
  answer: string | null;
  sources?: ResearchSource[];
  model?: string;
  generatedBy?: "xai" | "local";
  error?: string;
};

export default function AnalysisPanel({
  place,
  hydrology,
  hydrologyError,
  timeline,
  streamflow,
  climate,
  ground,
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
  onWetDry,
}: AnalysisPanelProps) {
  const [tab, setTab] = useState<TabKey>("analysis");
  const [open, setOpen] = useState(false);
  const [docked, setDocked] = useState(true);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [detail, setDetail] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const [question, setQuestion] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [asking, setAsking] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const [report, setReport] = useState<CityReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrology) return;
    const controller = new AbortController();
    setFailed(false);

    const gaugeName = streamflow?.gauge?.name;
    const payload = {
      place: { name: place.name, detail: place.detail, lat: place.lat, lon: place.lon },
      stats: {
        channelCount: hydrology.stats?.channelCount ?? 0,
        channelKm: hydrology.stats?.channelKm ?? 0,
        waterbodyCount: hydrology.stats?.waterbodyCount ?? 0,
        wetlandCount: hydrology.stats?.wetlandCount ?? 0,
        buildingCount: hydrology.stats?.buildingCount ?? 0,
        impervousKm: hydrology.stats?.impervousKm ?? 0,
        namedChannels: hydrology.stats?.namedChannels ?? [],
        sources: hydrology.stats?.sources ?? [],
        elevationRange: hydrology.stats?.elevationRange ?? null,
      },
      imageryYears: timeline?.epochs.map((item) => item.year) ?? [],
      streamflow:
        gaugeName != null
          ? {
              gauge: gaugeName,
              median: streamflow?.median ?? 0,
              reading,
            }
          : null,
    };

    fetch("/api/analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(payload),
    })
      .then(async (res) => {
        const json = (await res.json()) as AnalysisResult & { error?: string };
        if (!res.ok) throw new Error(json.error || `Analysis failed (${res.status})`);
        if (!json.headline || !json.summary || !Array.isArray(json.sections)) {
          throw new Error("Insight response was incomplete");
        }
        return json;
      })
      .then((result) => {
        setAnalysis(result);
        setFailed(false);
      })
      .catch((error: Error) => {
        if (error.name === "AbortError") return;
        console.warn("Insight generation failed:", error.message);
        setFailed(true);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrology, attempt, place.name, place.lat, place.lon, timeline, streamflow, reading]);

  const ask = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || asking) return;
    setQuestion("");
    setAsking(true);
    setExchanges((current) => [...current, { question: trimmed, answer: null }]);

    try {
      const history = exchanges
        .filter((item) => item.answer)
        .slice(-4)
        .flatMap((item) => [
          { role: "user" as const, content: item.question },
          { role: "assistant" as const, content: item.answer as string },
        ]);

      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          place: { name: place.name, detail: place.detail, lat: place.lat, lon: place.lon },
          stats: hydrology?.stats ?? null,
          imageryYears: timeline?.epochs.map((item) => item.year) ?? [],
          streamflow: streamflow?.gauge?.name
            ? { gauge: streamflow.gauge.name, median: streamflow.median, reading }
            : null,
          climate: climate
            ? {
                wettestYear: climate.wettestYear,
                driestYear: climate.driestYear,
                years: climate.years,
              }
            : null,
          ground: ground
            ? {
                soil: ground.soil
                  ? {
                      mapUnit: ground.soil.mapUnit,
                      component: ground.soil.component,
                      hydrologicGroup: ground.soil.hydrologicGroup,
                      infiltrationLabel: ground.soil.infiltrationLabel,
                    }
                  : null,
                floodZone: ground.floodZone,
                outlook: ground.outlook,
              }
            : null,
          history,
        }),
      });
      const json = (await res.json()) as {
        answer?: string;
        sources?: ResearchSource[];
        model?: string;
        generatedBy?: "xai" | "local";
        error?: string;
      };
      setExchanges((current) =>
        current.map((item, index) =>
          index === current.length - 1
            ? {
                ...item,
                answer: json.answer ?? null,
                sources: json.sources ?? [],
                model: json.model,
                generatedBy: json.generatedBy,
                error: json.error,
              }
            : item,
        ),
      );
    } catch {
      setExchanges((current) =>
        current.map((item, index) =>
          index === current.length - 1 ? { ...item, error: "Chat could not be reached." } : item,
        ),
      );
    } finally {
      setAsking(false);
      requestAnimationFrame(() =>
        threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" }),
      );
    }
  };

  const generateReport = async () => {
    if (!hydrology || reportLoading) return;
    setReportLoading(true);
    setReportError(null);
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          place: { name: place.name, detail: place.detail, lat: place.lat, lon: place.lon },
          stats: hydrology.stats,
          imageryYears: timeline?.epochs.map((item) => item.year) ?? [],
          wettestYear: climate?.wettestYear ?? null,
          driestYear: climate?.driestYear ?? null,
          rainByYear: climate?.years ?? [],
          streamflow: streamflow?.gauge?.name
            ? { gauge: streamflow.gauge.name, median: streamflow.median, reading }
            : null,
          analysis,
          ground: ground
            ? {
                soil: ground.soil,
                floodZone: ground.floodZone,
                outlook: ground.outlook,
                surfaceWater: ground.surfaceWater,
                sources: ground.sources,
              }
            : null,
        }),
      });
      if (!res.ok) throw new Error(`Report failed (${res.status})`);
      setReport((await res.json()) as CityReport);
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "Report failed");
    } finally {
      setReportLoading(false);
    }
  };

  const printReport = () => {
    if (!report) return;

    const html = buildReportDocument({
      ...report,
      placeName: place.name,
      placeDetail: place.detail || place.category || "",
      selectedYear: epoch?.year ?? null,
      gaugeLabel: streamflow
        ? `${streamflow.gauge.name} (#${streamflow.gauge.id})`
        : null,
    });

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank", "noopener,noreferrer");

    if (!win) {
      const link = document.createElement("a");
      link.href = url;
      link.download = `${place.name.replace(/[^\w.-]+/g, "-").toLowerCase()}-water-flow-report.html`;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      return;
    }

    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const retry = () => {
    setAnalysis(null);
    setFailed(false);
    setAttempt((value) => value + 1);
  };

  const pending = !analysis && !failed;
  const wetRain = climate?.years.find((item) => item.year === climate.wettestYear);
  const dryRain = climate?.years.find((item) => item.year === climate.driestYear);

  const openTab = (key: TabKey) => {
    setDocked(false);
    setTab(key);
    setOpen(true);
    setMobileExpanded(true);
  };

  const body = (
    <>
      {hydrologyError && (
        <p className="mb-3 rounded bg-[rgba(242,120,92,0.12)] px-3 py-2 text-[12px] text-[#ffa48c]">
          {hydrologyError}
        </p>
      )}

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
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
                  <p className="text-[13px] text-[#ffa48c]">
                    Insight could not be generated. Retry to rebuild it from the mapped channels.
                  </p>
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
                        background: RISK_COLOR[analysis.riskLevel] ?? RISK_COLOR.moderate,
                        boxShadow: `0 0 10px ${RISK_COLOR[analysis.riskLevel] ?? RISK_COLOR.moderate}`,
                      }}
                    />
                    <span
                      className="text-[11px] font-medium capitalize"
                      style={{ color: RISK_COLOR[analysis.riskLevel] ?? RISK_COLOR.moderate }}
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

                  <WetDryStrip
                    climate={climate}
                    epoch={epoch}
                    onWetDry={onWetDry}
                    wetRain={wetRain?.precipMm}
                    dryRain={dryRain?.precipMm}
                  />

                  <AnimatePresence initial={false}>
                    {detail && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-3.5 pt-4">
                          {analysis.sections.map((section, index) => (
                            <motion.div
                              key={section.heading}
                              initial={{ opacity: 0, y: 8 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.24, delay: 0.04 * index }}
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
                        : "Local model · add XAI_API_KEY for Grok"}
                    </span>
                  </div>
                </>
              )}
            </>
          )}

          {tab === "ask" && (
            <div className="flex flex-col gap-3">
              <div ref={threadRef} className="scroll-slim max-h-[32dvh] space-y-3 overflow-y-auto md:max-h-[42dvh]">
                {exchanges.map((item, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                    className="space-y-2"
                  >
                    <div className="flex justify-end">
                      <p className="max-w-[92%] rounded-2xl rounded-br-md bg-[#38bdf8] px-3 py-2 text-[13px] leading-relaxed text-[#03151f]">
                        {item.question}
                      </p>
                    </div>
                    {item.answer && (
                      <div className="flex justify-start">
                        <div className="max-w-[95%] space-y-2 rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.05] px-3 py-2.5">
                          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#d5e3f2]">
                            {item.answer}
                          </p>
                          {item.sources && item.sources.length > 0 && (
                            <div className="border-t border-white/10 pt-2">
                              <p className="mb-1 text-[10px] tracking-[0.12em] text-[#8096b0] uppercase">
                                Sources
                              </p>
                              <ul className="space-y-1">
                                {item.sources.slice(0, 6).map((source, sourceIndex) => (
                                  <li key={source.url}>
                                    <a
                                      href={source.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-[11px] text-[#7dd3fc] underline-offset-2 hover:underline"
                                    >
                                      [{sourceIndex + 1}] {source.title}
                                    </a>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {item.generatedBy && (
                            <p className="text-[10px] text-[#64788f]">
                              {item.generatedBy === "xai"
                                ? `Grok · ${item.model ?? "xAI"}`
                                : "Local synthesis · add XAI_API_KEY for Grok"}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                    {item.error && (
                      <p className="px-0.5 text-[13px] text-[#ffa48c]">{item.error}</p>
                    )}
                    {!item.answer && !item.error && (
                      <p className="flex items-center gap-2 px-0.5 text-[13px] text-[#93a7c0]">
                        <Loader2 className="size-3.5 animate-spin text-[#38bdf8]" />
                        Thinking…
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
                      className="rounded-full border border-white/12 px-3 py-1.5 text-left text-[12px] text-[#b7c7dc] transition-colors hover:border-[#38bdf8]/60 hover:text-white"
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
                className="flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-3 py-1.5"
              >
                <input
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="Message Grok about this site…"
                  aria-label="Chat with Grok about this site"
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-white placeholder:text-[#64788f] outline-none"
                />
                <button
                  type="submit"
                  disabled={!question.trim() || asking}
                  aria-label="Send message"
                  className="grid size-7 shrink-0 place-items-center rounded-full bg-[#38bdf8] text-[#03151f] transition-opacity disabled:opacity-35"
                >
                  <ArrowUp className="size-3.5" />
                </button>
              </form>
            </div>
          )}

          {tab === "marimo" && <MarimoPanel place={place} />}

          {tab === "report" && (
            <div className="space-y-3">
              <p className="text-[12px] leading-relaxed text-[#93a7c0]">
                One-page city briefing from measurements, Open-Meteo rain years, Wikipedia
                context, and Grok when a key is set.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void generateReport()} disabled={!hydrology || reportLoading}>
                  {reportLoading ? <Loader2 className="animate-spin" /> : <FileText />}
                  {report ? "Regenerate" : "Generate report"}
                </Button>
                {report && (
                  <Button size="sm" variant="subtle" onClick={printReport}>
                    Print / PDF
                  </Button>
                )}
              </div>
              {reportError && <p className="text-[12px] text-[#ffa48c]">{reportError}</p>}
              {report && (
                <div className="space-y-3 rounded border border-white/10 bg-white/[0.03] p-3">
                  <p className="text-[14px] font-semibold text-white">{report.headline}</p>
                  <p className="text-[12px] leading-relaxed text-[#b7c7dc]">{report.summary}</p>

                  {report.city && (
                    <div className="rounded border border-[#38bdf8]/25 bg-[#38bdf8]/08 p-2.5">
                      <div className="mb-1 text-[10px] tracking-[0.12em] text-[#8fe0f8] uppercase">
                        Wikipedia
                      </div>
                      <div className="flex gap-2.5">
                        {report.city.thumbnailUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={report.city.thumbnailUrl}
                            alt=""
                            className="size-14 shrink-0 rounded object-cover"
                          />
                        )}
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-white">{report.city.name}</p>
                          {report.city.description && (
                            <p className="text-[11px] text-[#93a7c0]">{report.city.description}</p>
                          )}
                          <p className="mt-1 line-clamp-4 text-[11px] leading-relaxed text-[#b7c7dc]">
                            {report.city.blurb}
                          </p>
                          {(report.city.population != null || report.city.river) && (
                            <p className="mt-1 text-[10px] text-[#64788f]">
                              {report.city.population != null
                                ? `Pop. ${report.city.population.toLocaleString()}`
                                : ""}
                              {report.city.river
                                ? `${report.city.population != null ? " · " : ""}River: ${report.city.river}`
                                : ""}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-1.5">
                    {report.metrics.slice(0, 8).map((metric) => (
                      <div key={metric.label} className="rounded bg-white/[0.04] px-2 py-1.5">
                        <div className="text-[9px] tracking-wide text-[#64788f] uppercase">
                          {metric.label}
                        </div>
                        <div className="tabular text-[13px] font-semibold text-white">
                          {metric.value}
                        </div>
                      </div>
                    ))}
                  </div>
                  <span className="text-[10px] text-[#64788f]">
                    {report.generatedBy === "xai"
                      ? `xAI · ${report.model}`
                      : "Local briefing · add XAI_API_KEY for Grok prose"}
                    {" · "}
                    {report.sections.length} sections
                  </span>
                </div>
              )}
            </div>
          )}

          {tab === "imagery" &&
            (timeline ? (
              <div className="space-y-4">
                <WetDryStrip
                  climate={climate}
                  epoch={epoch}
                  onWetDry={onWetDry}
                  wetRain={wetRain?.precipMm}
                  dryRain={dryRain?.precipMm}
                />

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

          {tab === "ground" && (
            <div className="space-y-3">
              <p className="text-[12px] leading-relaxed text-[#93a7c0]">
                Surface water already on the map, plus USDA soil infiltration, FEMA flood zones, and
                a simple flood-pressure outlook. Toggle Topo / Flood in Layers.
              </p>

              {!ground && (
                <div className="flex items-center gap-2 text-[12px] text-[#93a7c0]">
                  <Loader2 className="size-3.5 animate-spin" />
                  Loading soil and flood context…
                </div>
              )}

              {ground && (
                <>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-3">
                    <div className="mb-1.5 flex items-center gap-1.5 text-[10px] tracking-[0.12em] text-[#8fe0f8] uppercase">
                      <Droplets className="size-3" />
                      Surface water
                    </div>
                    <p className="text-[12px] leading-relaxed text-[#b7c7dc]">
                      {ground.surfaceWater.waterbodyCount} waterbodies ·{" "}
                      {ground.surfaceWater.wetlandCount} wetlands
                      {ground.surfaceWater.namedChannels.length > 0
                        ? ` · ${ground.surfaceWater.namedChannels.slice(0, 4).join(", ")}`
                        : ""}
                    </p>
                    <p className="mt-1 text-[11px] text-[#8096b0]">{ground.surfaceWater.note}</p>
                  </div>

                  <div className="rounded border border-white/10 bg-white/[0.03] p-3">
                    <div className="mb-1.5 flex items-center gap-1.5 text-[10px] tracking-[0.12em] text-[#fbbf24] uppercase">
                      <Mountain className="size-3" />
                      Soil / dirt
                    </div>
                    {ground.soil ? (
                      <div className="space-y-1.5">
                        <p className="text-[13px] font-medium text-white">{ground.soil.mapUnit}</p>
                        <p className="text-[12px] text-[#b7c7dc]">
                          {ground.soil.component}
                          {ground.soil.hydrologicGroup
                            ? ` · Hydrologic group ${ground.soil.hydrologicGroup}`
                            : ""}
                          {ground.soil.drainageClass ? ` · ${ground.soil.drainageClass}` : ""}
                        </p>
                        <p className="text-[12px] font-medium text-[#fde68a]">
                          {ground.soil.infiltrationLabel}
                        </p>
                        <p className="text-[11px] leading-relaxed text-[#93a7c0]">
                          {ground.soil.infiltrationNote}
                        </p>
                        <div className="grid grid-cols-2 gap-1.5 pt-1 text-[11px] text-[#b7c7dc]">
                          {ground.soil.ksatUmPerSec != null && (
                            <div>
                              Ksat{" "}
                              <span className="tabular text-white">
                                {ground.soil.ksatUmPerSec} µm/s
                              </span>
                            </div>
                          )}
                          {ground.soil.availableWaterCm != null && (
                            <div>
                              Water storage{" "}
                              <span className="tabular text-white">
                                {ground.soil.availableWaterCm} cm
                              </span>
                            </div>
                          )}
                          {ground.soil.sandPct != null && (
                            <div>
                              Sand{" "}
                              <span className="tabular text-white">{ground.soil.sandPct}%</span>
                            </div>
                          )}
                          {ground.soil.clayPct != null && (
                            <div>
                              Clay{" "}
                              <span className="tabular text-white">{ground.soil.clayPct}%</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-[12px] text-[#93a7c0]">
                        No SSURGO soil map unit at this point (common outside the US).
                      </p>
                    )}
                  </div>

                  <div className="rounded border border-white/10 bg-white/[0.03] p-3">
                    <div className="mb-1.5 flex items-center gap-1.5 text-[10px] tracking-[0.12em] text-[#fca5a5] uppercase">
                      <ShieldAlert className="size-3" />
                      Flood levels
                    </div>
                    {ground.floodZone && (
                      <p className="mb-2 text-[12px] text-[#fecaca]">
                        At pin: {ground.floodZone.label}
                      </p>
                    )}
                    <div className="mb-3 space-y-1.5">
                      {(Object.keys(FLOOD_LEVEL_META) as (keyof typeof FLOOD_LEVEL_META)[]).map(
                        (key) => {
                          const meta = FLOOD_LEVEL_META[key];
                          const active = ground.floodZone?.floodLevel === key;
                          return (
                            <div
                              key={key}
                              className={cn(
                                "flex items-center gap-2 rounded px-1.5 py-1 text-[11px]",
                                active ? "bg-white/10 text-white" : "text-[#93a7c0]",
                              )}
                            >
                              <span
                                className="size-2.5 shrink-0 rounded-sm"
                                style={{ background: meta.color }}
                              />
                              <span className="min-w-0 flex-1">{meta.label}</span>
                              <span className="tabular text-[10px] opacity-80">{meta.short}</span>
                            </div>
                          );
                        },
                      )}
                    </div>
                    <p className="text-[13px] font-semibold text-white">{ground.outlook.headline}</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-[#b7c7dc]">
                      {ground.outlook.body}
                    </p>
                    <ul className="mt-2 space-y-1">
                      {ground.outlook.drivers.map((driver) => (
                        <li key={driver} className="text-[11px] text-[#93a7c0]">
                          · {driver}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[10px] text-[#8096b0]">
                      Flood map uses red / orange hazard colors. Surface water stays blue and is a
                      separate layer.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="subtle"
                        onClick={() => onToggle("flood")}
                      >
                        {toggles.flood ? "Hide flood map" : "Show flood map"}
                      </Button>
                      <Button size="sm" variant="subtle" onClick={() => onToggle("topo")}>
                        {toggles.topo ? "Hide topo" : "Show topo map"}
                      </Button>
                    </div>
                  </div>

                  <p className="text-[10px] text-[#64788f]">
                    Sources: {ground.sources.join(" · ")}. Illustrative - not a regulatory
                    flood determination.
                  </p>
                </>
              )}
            </div>
          )}

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
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </>
  );

  return (
    <>
      {/* Desktop / tablet side rail - starts docked like the Wikipedia tab. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-30 hidden items-center p-3 md:flex md:p-5">
        <AnimatePresence mode="wait" initial={false}>
          {docked ? (
            <motion.button
              key="analysis-tab"
              type="button"
              initial={{ opacity: 0, x: -28 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              onClick={() => {
                setDocked(false);
                setOpen(true);
              }}
              className="glass-dark pointer-events-auto flex items-center gap-2 rounded-md px-2.5 py-3 text-[#b7c7dc] transition-colors hover:text-white"
              aria-label="Expand analysis panel"
              title="Analysis"
            >
              <Sparkles className="size-4 text-[#38bdf8]" />
              <span className="max-w-[7rem] truncate text-[11px] font-medium tracking-wide">
                {place.name}
              </span>
              <ChevronRight className="size-3.5 text-[#38bdf8]" />
            </motion.button>
          ) : (
            <motion.div
              key="analysis-panel"
              initial={{ opacity: 0, x: -40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -28 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="pointer-events-auto flex items-center gap-2"
            >
              <nav
                aria-label="Site information"
                className="glass-dark flex flex-col gap-1 rounded-md p-1.5"
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
                        openTab(key);
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
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setDocked(true);
                  }}
                  title="Dock to edge"
                  aria-label="Dock analysis panel"
                  className="grid size-10 place-items-center rounded text-[#7387a1] transition-colors hover:bg-white/8 hover:text-white"
                >
                  <ChevronLeft className="size-[18px]" />
                </button>
              </nav>

              <AnimatePresence initial={false}>
                {open && (
                  <motion.section
                    key="drawer"
                    initial={{ opacity: 0, x: -24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -24 }}
                    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                    className="glass-dark scroll-slim flex max-h-[calc(100dvh-2.5rem)] w-[min(372px,calc(100vw-6.5rem))] flex-col overflow-hidden rounded-md"
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
                        aria-label="Collapse drawer"
                        title="Collapse"
                      >
                        <Minus className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          setDocked(true);
                        }}
                        className="rounded p-1 text-[#7387a1] transition-colors hover:bg-white/10 hover:text-white"
                        aria-label="Dock panel"
                        title="Dock"
                      >
                        <X className="size-4" />
                      </button>
                    </header>
                    <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-4 py-4">{body}</div>
                  </motion.section>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Mobile bottom sheet */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 md:hidden">
        <motion.div
          layout
          className="mobile-sheet pointer-events-auto rounded-t-2xl px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          <button
            type="button"
            aria-label={mobileExpanded ? "Collapse panel" : "Expand panel"}
            onClick={() => setMobileExpanded((value) => !value)}
            className="mx-auto mb-2 block h-1 w-10 rounded-full bg-white/25"
          />

          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate text-[15px] font-semibold text-white">{place.name}</h2>
              <p className="truncate text-[11px] text-[#93a7c0]">
                {analysis?.headline ?? (place.detail || "Loading site…")}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                disabled={!climate?.wettestYear}
                onClick={() => onWetDry("wettest")}
                className="rounded-full border border-[#38bdf8]/35 bg-[#38bdf8]/12 px-2 py-1 text-[10px] font-medium text-[#8fe0f8] disabled:opacity-35"
              >
                Wet
              </button>
              <button
                type="button"
                disabled={!climate?.driestYear}
                onClick={() => onWetDry("driest")}
                className="rounded-full border border-[#fbd38d]/35 bg-[#fbd38d]/10 px-2 py-1 text-[10px] font-medium text-[#fbd38d] disabled:opacity-35"
              >
                Dry
              </button>
            </div>
          </div>

          <div className="mb-2 flex gap-1 overflow-x-auto pb-1">
            {TABS.map(({ key, label, icon: Icon }) => {
              const active = tab === key && mobileExpanded;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => openTab(key)}
                  className={cn(
                    "flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                    active
                      ? "bg-[#38bdf8] text-[#03151f]"
                      : "bg-white/8 text-[#9db1c8]",
                  )}
                >
                  <Icon className="size-3" />
                  {label}
                </button>
              );
            })}
          </div>

          <AnimatePresence initial={false}>
            {mobileExpanded && (
              <motion.div
                key="mobile-body"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <div className="scroll-slim max-h-[42dvh] overflow-y-auto pb-1">{body}</div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </>
  );
}

function WetDryStrip({
  climate,
  epoch,
  onWetDry,
  wetRain,
  dryRain,
}: {
  climate: ClimateSummary | null;
  epoch: ImageryEpoch | null;
  onWetDry: (kind: "wettest" | "driest") => void;
  wetRain?: number;
  dryRain?: number;
}) {
  if (!climate?.wettestYear && !climate?.driestYear) return null;
  return (
    <div className="mt-3 grid grid-cols-2 gap-1.5">
      <button
        type="button"
        onClick={() => onWetDry("wettest")}
        disabled={!climate.wettestYear}
        className={cn(
          "rounded-lg border px-2.5 py-2 text-left transition-colors",
          epoch?.year === climate.wettestYear
            ? "border-[#38bdf8] bg-[#38bdf8]/15"
            : "border-white/12 bg-white/[0.03] hover:border-[#38bdf8]/50",
        )}
      >
        <div className="flex items-center gap-1 text-[10px] font-medium tracking-wide text-[#8fe0f8] uppercase">
          <CloudRain className="size-3" /> Wettest
        </div>
        <div className="tabular mt-1 text-[15px] font-semibold text-white">
          {climate.wettestYear ?? "-"}
        </div>
        {wetRain != null && (
          <div className="text-[10px] text-[#93a7c0]">{Math.round(wetRain)} mm rain</div>
        )}
      </button>
      <button
        type="button"
        onClick={() => onWetDry("driest")}
        disabled={!climate.driestYear}
        className={cn(
          "rounded-lg border px-2.5 py-2 text-left transition-colors",
          epoch?.year === climate.driestYear
            ? "border-[#fbd38d] bg-[#fbd38d]/12"
            : "border-white/12 bg-white/[0.03] hover:border-[#fbd38d]/50",
        )}
      >
        <div className="flex items-center gap-1 text-[10px] font-medium tracking-wide text-[#fbd38d] uppercase">
          <Sun className="size-3" /> Driest
        </div>
        <div className="tabular mt-1 text-[15px] font-semibold text-white">
          {climate.driestYear ?? "-"}
        </div>
        {dryRain != null && (
          <div className="text-[10px] text-[#93a7c0]">{Math.round(dryRain)} mm rain</div>
        )}
      </button>
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
