"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Place } from "@/lib/types";

const MARIMO_ORIGIN =
  process.env.NEXT_PUBLIC_MARIMO_ORIGIN?.replace(/\/$/, "") || "http://127.0.0.1:2718";

type MarimoPanelProps = {
  place: Place;
};

export default function MarimoPanel({ place }: MarimoPanelProps) {
  const [online, setOnline] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [frameKey, setFrameKey] = useState(0);

  const frameSrc = useMemo(() => {
    const params = new URLSearchParams({
      lat: String(place.lat),
      lon: String(place.lon),
      name: place.name,
      detail: place.detail || "",
    });
    return `${MARIMO_ORIGIN}/?${params.toString()}`;
  }, [place.detail, place.lat, place.lon, place.name]);

  const check = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/marimo-status", { cache: "no-store" });
      const json = (await res.json()) as { online?: boolean };
      setOnline(Boolean(json.online));
    } catch {
      setOnline(false);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setChecking(true);
      try {
        const res = await fetch("/api/marimo-status", { cache: "no-store" });
        const json = (await res.json()) as { online?: boolean };
        if (!cancelled) setOnline(Boolean(json.online));
      } catch {
        if (!cancelled) setOnline(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    };
    const kickoff = window.setTimeout(() => {
      void run();
    }, 0);
    const id = window.setInterval(() => void run(), 12_000);
    return () => {
      cancelled = true;
      window.clearTimeout(kickoff);
      window.clearInterval(id);
    };
  }, [place.id]);

  // Remount the iframe when the site changes so Marimo picks up new query params.
  useEffect(() => {
    setFrameKey((value) => value + 1);
  }, [frameSrc]);

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-[#93a7c0]">
        Live Marimo notebook charting rainfall, gauge flow, hydrology, elevation, soil, and
        flood context for <span className="text-[#dbe7f5]">{place.name}</span>.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="subtle"
          onClick={() => {
            void check();
            setFrameKey((value) => value + 1);
          }}
          disabled={checking}
        >
          {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Refresh
        </Button>
        <a
          href={frameSrc}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded border border-white/12 px-2.5 py-1.5 text-[12px] text-[#b7c7dc] transition-colors hover:border-[#38bdf8]/50 hover:text-white"
        >
          Open in new tab
          <ExternalLink className="size-3.5" />
        </a>
      </div>

      {online === false && (
        <div className="rounded border border-[#fbbf24]/35 bg-[#fbbf24]/10 px-3 py-2.5 text-[12px] leading-relaxed text-[#fde68a]">
          <p className="font-medium text-[#fef3c7]">Marimo server is not running</p>
          <p className="mt-1.5 text-[#fcd34d]">
            In a second terminal from the project root:
          </p>
          <pre className="mt-2 overflow-x-auto rounded bg-black/35 px-2.5 py-2 text-[11px] text-[#fef9c3]">
            {`python3 -m pip install -r requirements-marimo.txt
WATERFLOW_ORIGIN=http://127.0.0.1:43173 npm run marimo
# or both apps together:
npm run dev:all`}
          </pre>
          <p className="mt-2 text-[#fcd34d]">
            Marimo serves charts on port 2718 while Waterflow stays on 43173.
          </p>
        </div>
      )}

      {online === null && (
        <div className="flex items-center gap-2 text-[12px] text-[#93a7c0]">
          <Loader2 className="size-3.5 animate-spin text-[#38bdf8]" />
          Checking Marimo…
        </div>
      )}

      {online && (
        <div className="overflow-hidden rounded border border-white/12 bg-[#071018]">
          <iframe
            key={frameKey}
            title={`Marimo charts for ${place.name}`}
            src={frameSrc}
            className="h-[min(70dvh,720px)] w-full bg-white"
            allow="fullscreen"
          />
        </div>
      )}
    </div>
  );
}
