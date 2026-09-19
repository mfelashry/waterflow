"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Loader2, MapPin, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Place } from "@/lib/types";

type SearchBarProps = {
  onSelect: (place: Place) => void;
  placeholder?: string;
  compact?: boolean;
  autoFocus?: boolean;
};

const SUGGESTIONS = [
  "Clear Brook, Virginia",
  "Jones Falls, Baltimore",
  "Kissimmee River, Florida",
  "Rhine Delta, Netherlands",
];

export default function SearchBar({
  onSelect,
  placeholder = "Search any place on Earth",
  compact = false,
  autoFocus = false,
}: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = query.trim();
  const active = trimmed.length >= 2;

  useEffect(() => {
    if (!active) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        const json = (await res.json()) as { results: Place[]; error?: string };
        setResults(json.results);
        setError(json.results.length === 0 ? (json.error ?? "No matching places") : null);
        setHighlight(0);
        setOpen(true);
      } catch (fetchError) {
        if ((fetchError as Error).name !== "AbortError") setError("Search is unavailable");
      } finally {
        setLoading(false);
      }
    }, 320);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [trimmed, active]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const choose = (place: Place) => {
    setQuery(place.name);
    setOpen(false);
    setResults([]);
    inputRef.current?.blur();
    onSelect(place);
  };

  const visibleResults = active ? results : [];
  const showPanel = open && active && (visibleResults.length > 0 || Boolean(error) || loading);

  const listId = useMemo(() => `search-results-${compact ? "compact" : "hero"}`, [compact]);

  return (
    <div ref={containerRef} className="relative w-full">
      <div
        className={cn(
          "glass-dark flex items-center gap-3 rounded-md transition-colors",
          compact ? "h-11 px-3" : "h-14 px-4",
          showPanel && "rounded-b-none",
        )}
      >
        {loading ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-[#38bdf8]" />
        ) : (
          <Search className="size-4 shrink-0 text-[#7387a1]" />
        )}
        <input
          ref={inputRef}
          value={query}
          autoFocus={autoFocus}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => visibleResults.length > 0 && setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setHighlight((index) => Math.min(index + 1, visibleResults.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setHighlight((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter" && visibleResults[highlight]) {
              event.preventDefault();
              choose(visibleResults[highlight]);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={placeholder}
          role="combobox"
          aria-label="Search for a place"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={showPanel}
          className={cn(
            "w-full bg-transparent text-[#eef4fb] placeholder:text-[#7387a1] outline-none",
            compact ? "text-sm" : "text-base",
          )}
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setResults([]);
              inputRef.current?.focus();
            }}
            className="shrink-0 rounded p-1 text-[#7387a1] transition-colors hover:text-white"
            aria-label="Clear search"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <AnimatePresence>
        {showPanel && (
          <motion.ul
            id={listId}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="glass-dark scroll-slim absolute z-30 max-h-80 w-full overflow-y-auto rounded-b-md border-t-0 py-1"
          >
            {visibleResults.map((place, index) => (
              <li key={place.id}>
                <button
                  type="button"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    choose(place);
                  }}
                  onMouseEnter={() => setHighlight(index)}
                  className={cn(
                    "flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors",
                    index === highlight ? "bg-[rgba(56,189,248,0.16)]" : "hover:bg-white/[0.05]",
                  )}
                >
                  <MapPin className="mt-0.5 size-3.5 shrink-0 text-[#38bdf8]" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-[#eef4fb]">{place.name}</span>
                    <span className="block truncate text-xs text-[#93a7c0]">
                      {place.detail || place.category}
                    </span>
                  </span>
                  <span className="tabular ml-auto shrink-0 pt-0.5 text-[10px] text-[#8296ad]">
                    {place.lat.toFixed(2)}, {place.lon.toFixed(2)}
                  </span>
                </button>
              </li>
            ))}
            {!visibleResults.length && !loading && (
              <li className="px-4 py-6 text-center">
                <p className="text-sm text-[#b7c7dc]">{error}</p>
                <p className="mt-3 text-xs text-[#7387a1]">Try one of these</p>
                <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onPointerDown={(event) => {
                        event.preventDefault();
                        setQuery(suggestion);
                      }}
                      className="rounded border border-white/15 px-2 py-1 text-[11px] text-[#b7c7dc] transition-colors hover:border-[#38bdf8] hover:text-white"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </li>
            )}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
