# Water Flow

HopHacks project. Full product brief: **[PROJECT_PROMPT.md](./PROJECT_PROMPT.md)**.

Search any place on Earth, fly down to it from orbit, and trace where its water goes
across real terrain, live satellite imagery and a decade of archived captures.

## Highlights in this build

- **Ask Grok + research** - measurements, external case studies / reports, and interpretation with source links
- **Marimo charts tab** - Python companion notebook for rainfall, gauge flow, hydrology, soil, and flood
- **Smooth local sites** - capped, simplified channels so dense places stay fluid
- **Hydrology cache** - server + browser session cache so revisits paint instantly
- **Ground tab** - surface water inventory, USDA SSURGO soil / infiltration, FEMA flood zones + outlook
- **Topo + flood layers** - USGS topographic basemap and FEMA NFHL polygons
- **City report** - Wikipedia/Wikidata + flood/soil + measurements; Print / PDF from the Report tab
- **Mobile panel** - bottom sheet with Wet/Dry shortcuts

## Run

```bash
npm install
npm run dev -- --hostname 127.0.0.1 --port 43173
```

Open http://127.0.0.1:43173.

### Marimo charts (Python companion)

The Analysis panel **Charts** tab embeds a live Marimo notebook (`marimo/site_charts.py`)
via iframe. The notebook reads lat/lon from the URL and fetches `/api/site-snapshot`
from the Next app (`WATERFLOW_ORIGIN`).

```bash
python3 -m pip install -r requirements-marimo.txt
WATERFLOW_ORIGIN=http://127.0.0.1:43173 npm run marimo
```

Or start both together:

```bash
npm run dev:all
```

Waterflow stays on `43173`; Marimo on `2718`. If Charts shows “Marimo server is not
running”, start the companion with the commands above (status is probed via
`/api/marimo-status`).

Optional Grok (Ask tab + richer reports):

```bash
cp .env.example .env.local
# set XAI_API_KEY
```

## Push to GitHub (easy)

Repo: [mfelashry/waterflow](https://github.com/mfelashry/waterflow)

### Cloud Agent → GitHub (one command)

1. Cursor → this agent → **Forwarded Ports** → forward `43173`
2. On your Mac Terminal:

```bash
curl -fsSL http://127.0.0.1:43173/push-to-github.sh | bash
```

That pulls the latest cloud build into `~/Documents/waterflow` and force-pushes `main` to GitHub.

### Edited on your Mac only

```bash
cd ~/Documents/waterflow
./scripts/push.sh "your message"
```

## New APIs (beyond the original stack)

| API | Role |
| --- | --- |
| Open-Meteo Archive | Annual rain → wettest / driest |
| Wikipedia REST | City blurb for the report |
| Wikidata SPARQL | Population / river facts |
| USDA SSURGO (Soil Data Access) | Soil type, hydrologic group, infiltration |
| FEMA NFHL | Flood hazard zones + site outlook |
| USGS Topo basemap | Topographic map layer |

Already used: Nominatim, Photon, Overpass, USGS NHD/NWIS/EPQS, Esri imagery + Wayback, NASA GIBS, AWS terrain, xAI.
