"use client";

import { motion } from "motion/react";
import type { DemoSite, Place } from "@/lib/types";

export const DEMO_SITES: DemoSite[] = [
  {
    id: "baltimore",
    label: "Baltimore",
    blurb: "Maryland · full city channel network",
    place: {
      id: "demo-baltimore",
      name: "Baltimore",
      detail: "Maryland, United States",
      lat: 39.2908816,
      lon: -76.610759,
      category: "administrative",
      importance: 0.95,
      bbox: [-76.7112977, 39.1972328, -76.5296757, 39.3719992],
    },
  },
  {
    id: "jones-falls",
    label: "Jones Falls",
    blurb: "Baltimore · urban flashiness at home",
    place: {
      id: "demo-jones-falls",
      name: "Jones Falls",
      detail: "Baltimore, Maryland, United States",
      lat: 39.3175,
      lon: -76.6208,
      category: "waterway",
      importance: 0.9,
    },
  },
  {
    id: "clear-brook",
    label: "Clear Brook",
    blurb: "Virginia · headwater channels",
    place: {
      id: "demo-clear-brook",
      name: "Clear Brook",
      detail: "Virginia, United States",
      lat: 39.2351,
      lon: -78.0933,
      category: "place",
      importance: 0.7,
    },
  },
  {
    id: "kissimmee",
    label: "Kissimmee River",
    blurb: "Florida · restored floodplain",
    place: {
      id: "demo-kissimmee",
      name: "Kissimmee River",
      detail: "Florida, United States",
      lat: 27.561,
      lon: -81.093,
      category: "waterway",
      importance: 0.85,
    },
  },
  {
    id: "rhine-delta",
    label: "Rhine Delta",
    blurb: "Netherlands · managed lowlands",
    place: {
      id: "demo-rhine",
      name: "Rhine Delta",
      detail: "South Holland, Netherlands",
      lat: 51.9,
      lon: 4.48,
      category: "place",
      importance: 0.88,
    },
  },
];

type DemoPathProps = {
  onSelect: (place: Place) => void;
};

export default function DemoPath({ onSelect }: DemoPathProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.65, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="pointer-events-auto w-full max-w-xl"
    >
      <div className="flex flex-col gap-0.5 sm:flex-row sm:flex-wrap sm:gap-x-5 sm:gap-y-0">
        {DEMO_SITES.map((site, index) => (
          <motion.button
            key={site.id}
            type="button"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.45,
              delay: 0.28 + index * 0.07,
              ease: [0.22, 1, 0.36, 1],
            }}
            whileHover={{ x: 3 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onSelect(site.place)}
            className="demo-link group relative bg-transparent px-0 py-1.5 text-left"
          >
            <span className="block text-[13px] font-medium tracking-tight text-white/90 transition-colors group-hover:text-[#8fe0f8]">
              {site.label}
            </span>
            <span className="demo-underline pointer-events-none absolute bottom-0.5 left-0 h-px w-0 bg-[#8fe0f8]/70 transition-[width] duration-300 group-hover:w-full" />
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}
