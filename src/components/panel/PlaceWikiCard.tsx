"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BookOpen, ChevronLeft, ChevronRight, ExternalLink, Loader2, Minus, X } from "lucide-react";
import type { CityContext } from "@/lib/city";

type PlaceWikiCardProps = {
  placeName: string;
  city: CityContext | null;
  loading: boolean;
  visible: boolean;
  onClose: () => void;
};

export default function PlaceWikiCard({
  placeName,
  city,
  loading,
  visible,
  onClose,
}: PlaceWikiCardProps) {
  const [minimized, setMinimized] = useState(true);

  if (!visible) return null;

  return (
    <div className="pointer-events-none absolute inset-y-0 right-0 z-30 flex items-center justify-end p-3 md:p-5">
      <AnimatePresence mode="wait" initial={false}>
        {minimized ? (
          <motion.button
            key="wiki-tab"
            type="button"
            initial={{ opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            onClick={() => setMinimized(false)}
            className="glass-dark pointer-events-auto flex items-center gap-2 rounded-l-md rounded-r-md px-2.5 py-3 text-[#b7c7dc] transition-colors hover:text-white"
            aria-label="Expand Wikipedia card"
            title="Wikipedia"
          >
            <ChevronLeft className="size-3.5 text-[#38bdf8]" />
            <BookOpen className="size-4" />
            <span className="max-w-[7rem] truncate text-[11px] font-medium tracking-wide">
              {city?.title ?? placeName}
            </span>
          </motion.button>
        ) : (
          <motion.aside
            key="wiki-panel"
            initial={{ opacity: 0, x: 64 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 48 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="glass-dark pointer-events-auto flex max-h-[calc(100dvh-6.5rem)] w-[min(320px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-md md:max-h-[calc(100dvh-5rem)]"
          >
            <header className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
              <BookOpen className="size-3.5 shrink-0 text-[#38bdf8]" />
              <p className="min-w-0 flex-1 truncate text-[11px] tracking-[0.12em] text-[#8fe0f8] uppercase">
                Wikipedia
              </p>
              <button
                type="button"
                onClick={() => setMinimized(true)}
                className="rounded p-1 text-[#7387a1] transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Minimize Wikipedia card"
                title="Minimize"
              >
                <Minus className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded p-1 text-[#7387a1] transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Hide Wikipedia card"
                title="Hide"
              >
                <X className="size-3.5" />
              </button>
            </header>

            <div className="scroll-slim min-h-0 flex-1 overflow-y-auto">
              {loading && !city && (
                <div className="flex items-center gap-2 px-4 py-5 text-[13px] text-[#93a7c0]">
                  <Loader2 className="size-3.5 animate-spin text-[#38bdf8]" />
                  Looking up {placeName}
                </div>
              )}

              {!loading && !city && (
                <div className="px-4 py-4">
                  <h2 className="text-[16px] font-semibold text-white">{placeName}</h2>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-[#93a7c0]">
                    No Wikipedia page matched this search.
                  </p>
                </div>
              )}

              {city && (
                <>
                  {city.thumbnailUrl && (
                    <div className="relative h-36 w-full overflow-hidden bg-[#0a1220] md:h-40">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={city.thumbnailUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[rgba(4,8,14,0.88)] via-transparent to-transparent" />
                    </div>
                  )}

                  <div className="space-y-2.5 px-4 py-3.5">
                    <div>
                      <h2 className="text-[17px] leading-tight font-semibold text-white">
                        {city.title}
                      </h2>
                      {city.description && (
                        <p className="mt-1 text-[12px] text-[#93a7c0]">{city.description}</p>
                      )}
                    </div>

                    {(city.population != null || city.country || city.river) && (
                      <p className="text-[11px] text-[#8ea3c0]">
                        {[
                          city.population != null
                            ? `Pop. ${city.population.toLocaleString()}`
                            : null,
                          city.country,
                          city.river ? `River: ${city.river}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}

                    <p className="text-[13px] leading-relaxed text-[#b7c7dc]">
                      {city.extract.length > 560
                        ? `${city.extract.slice(0, 560).trim()}…`
                        : city.extract}
                    </p>

                    {city.url && (
                      <a
                        href={city.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#38bdf8] transition-opacity hover:opacity-80"
                      >
                        Read on Wikipedia
                        <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center justify-end border-t border-white/10 px-2 py-1.5">
              <button
                type="button"
                onClick={() => setMinimized(true)}
                className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-[#7387a1] transition-colors hover:bg-white/8 hover:text-white"
              >
                Dock to edge
                <ChevronRight className="size-3.5" />
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
