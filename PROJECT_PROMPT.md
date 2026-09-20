# Water Flow (Hydroscope) - Full Project Prompt

**Package name:** `hydroscope`  
**Product name:** Water Flow - “Trace where the water goes”  
**Hackathon:** HopHacks (this tree is the uploaded `HopHacksHackathon-main` zip)  
**Local copy:** `~/Documents/hophackshackathon`

Use this file as the source of truth when continuing the project. It describes **what the product is**, **why it exists**, **how the experience works**, **where each layer of data comes from**, and **how to run and extend it**.

---

## 1. Purpose

Water Flow lets anyone **search a place on Earth, fly there from orbit, and see where the water goes** - channels on real terrain, live satellite imagery, and a decade of archived captures that actually differ from each other.

It is a **site-scale hydrology explorer**, not a weather app and not a generic GIS. The claim is:

1. Show the **real channel network** around a point (USGS NHD inside the United States, OpenStreetMap elsewhere), including intermittent headwaters NHD has and OSM often lacks.
2. Animate flow **downstream** (NHD is digitized downstream; OSM is treated as a network).
3. Drive channel **width, speed, and water opacity** from nearby **USGS streamflow** (discharge vs. median).
4. Offer **historical Esri World Imagery Wayback** years that **genuinely changed** at that tile - not a row of identical “releases.”
5. Write a **site analysis** (drainage density, built-surface pressure, wetlands, imagery span). If `XAI_API_KEY` is set, Grok writes it; otherwise a **deterministic local model** uses the same measurements.

Everything public and keyless except the optional xAI key.

---

## 2. The experience (user journey)

Phases in `src/components/Experience.tsx`:

| Phase | What the user sees |
| --- | --- |
| `orbit` | Photoreal three.js globe (NASA Blue Marble + VIIRS lights, atmosphere, terminator). Search is the only control. |
| `descending` / `returning` | Camera flies a great-circle (or site-to-site) dive. Map fades in only on the last part of the dive (`FADE_START` 0.72 → `FADE_END` 0.96). Reveal is capped at `REVEAL_CAP_MS` (2400 ms) so tiles cannot stall the handoff. |
| `site` | MapLibre 3D terrain map: flowlines, waterbodies, wetlands, buildings, optional roads, Esri imagery, Wayback blend slider, analysis panel, streamflow-driven animation. Back returns toward orbit. |

Selecting a new place while already on a site **does not** reset to idle orbit: `fromPlace` is the current site so the camera flies straight across.

Default layer toggles: flow, waterbodies, wetlands, buildings **on**; roads **off**.

---

## 3. Stack

- **Next.js 16** App Router, **React 19**, **TypeScript**, **Tailwind 4**
- **three.js** + **@react-three/fiber** + **drei** - globe and custom shaders (`src/components/globe/`)
- **maplibre-gl** - terrain map, GeoJSON layers, flow animation (`src/components/map/`)
- **motion** - UI transitions
- **Radix** primitives (dialog, slider, tabs, slot) + lucide icons
- **Optional xAI** - `POST https://api.x.ai/v1/chat/completions` (`XAI_MODEL` default `grok-4-latest`)
- **Marimo** notebook (`marimo/dashboard.py`) - iframe charts of stats + streamflow, payload in `?data=` as URL-safe base64 JSON; static export under `public/marimo/`

There is **no database and no auth**. Route handlers proxy and reshape public APIs.

---

## 4. API routes (`src/app/api/`)

| Route | Role |
| --- | --- |
| `/api/geocode` | Nominatim worldwide search; Photon fallback when Nominatim rate-limits |
| `/api/hydrology` | NHD (US) + Overpass (channels, water, wetlands, buildings, roads); stats + named channels |
| `/api/imagery/timeline` | Esri Wayback releases; **fingerprint one tile per year** at the point; keep only years whose imagery actually changed |
| `/api/earth-texture` | NASA GIBS Blue Marble / city lights for the globe |
| `/api/streamflow` | Nearby USGS gauges and discharge vs. median (`src/lib/streamflow.ts`) |
| `/api/analysis` | Grok write-up or local deterministic `localAnalysis()` |
| `/api/ask` | Follow-up Q&A against the same site context |

Hydrology response shape (`src/lib/types.ts`): GeoJSON flowlines, waterbodies, wetlands, buildings, roads, `HydrologyStats`, optional `asOf` for historical water reconstruction.

Flowline animation uses `src/lib/flowEpoch.ts` (`flowlinesForReading`) so the drawn network can match a discharge epoch.

---

## 5. Data sources (all public)

| Layer | Source |
| --- | --- |
| Place search | OSM Nominatim, Photon |
| Channels (US) | USGS National Hydrography Dataset |
| Channels + water + buildings + roads (elsewhere / extras) | OpenStreetMap via Overpass |
| Elevation | USGS Elevation Point Query; Mapzen/AWS terrain tiles on the map |
| Live imagery | Esri World Imagery |
| Archive imagery | Esri World Imagery Wayback |
| Globe | NASA GIBS Blue Marble + VIIRS City Lights |
| Live flow | USGS NWIS gauges |

---

## 6. Critical implementation rules

**MapLibre worker (do not skip).**  
`import.meta.url` for the maplibre worker does not survive the Next bundler. `postinstall` runs `scripts/copy-maplibre-worker.mjs` into `public/`. Without those files, **GeoJSON and the DEM stay blank**.

Do **not** commit copied workers (`/public/maplibre-gl-worker.mjs`, `/public/maplibre-gl-shared.mjs` are gitignored). They are generated on `npm install`.

**Wayback.** Never list every Esri release as a year button. Deduplicate by **tile fingerprint** at the target (`src/lib/wayback.ts` + `/api/imagery/timeline`).

**NHD direction.** NHD geometry is downstream. Animation must follow that orientation.

**Analysis without a key.** Must still render from measurements. Do not block the panel on xAI.

**Globe → map handoff.** Fade only at the end of the dive; cap wait on tiles.

**Prefetch.** `src/lib/prefetch.ts` warms tiles so the map is not empty when it appears.

---

## 7. Layout

```
src/app/                 page (Experience), layout, API routes
src/components/
  Experience.tsx         phase machine, data fetch, handoff
  SearchBar.tsx
  globe/                 Globe, shaders
  map/                   SiteMap, mapStyle, layer toggles
  panel/                 AnalysisPanel, MeasurementsDashboard
  ui/                    button and other primitives
src/lib/                 geo, hydrology, wayback, streamflow, flowEpoch, prefetch
scripts/                 copy-maplibre-worker, smoke.mjs, map-smoke.mjs, epoch-test.mjs
marimo/dashboard.py      measurement charts
public/marimo/           exported notebook assets
```

---

## 8. How to run

```bash
npm install
npm run dev -- --hostname 127.0.0.1 --port 43173
```

Open http://127.0.0.1:43173.

Optional:

```bash
cp .env.example .env.local
# XAI_API_KEY=...
# XAI_MODEL=grok-4-latest
```

Checks:

```bash
npx eslint src
node scripts/smoke.mjs       # needs a running dev server + Chrome
node scripts/map-smoke.mjs
node scripts/epoch-test.mjs
```

---

## 9. Prompt for another agent

> You are extending Water Flow (hydroscope), a HopHacks Next.js 16 app. Search any place, fly a photoreal three.js globe to it, then show MapLibre terrain with USGS/OSM channels animated downstream, USGS-streamflow-scaled stroke, Esri imagery, and Wayback years that actually changed (tile-fingerprint, not raw release list). Site analysis uses xAI if `XAI_API_KEY` is set, else the local model in `/api/analysis`. No auth, no database. After `npm install`, maplibre workers must exist in `public/` or layers stay blank. Keep NHD downstream orientation. Do not list identical Wayback releases. Match existing TypeScript, Tailwind 4, and the orbit → descending → site phase machine in `Experience.tsx`. Read `PROJECT_PROMPT.md` and `README.md` before editing.

---

## 10. What “done” looks like for a session

- Search a city or landmark → globe dive → map with flowing channels.
- Years on the imagery control look different from each other at that place.
- Analysis panel fills with or without an xAI key.
- Streamflow (when a gauge exists) changes how fast/thick channels draw.
- `npm install` + `npm run dev` is enough to demo; no Mongo, no Flask.
