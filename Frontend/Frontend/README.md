# Runoff Debt

Runoff Debt is a judge-ready MVP for screening how new impervious development may connect to downstream buildings, roads, streams, and wetlands.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The dev command starts both the Python data API on port 8000 and Next.js on port 3000. Python 3.9+ is required; the API itself has no third-party dependencies.

To run the processes separately:

```bash
cd ../../backend
python server.py
```

```bash
npm run dev:frontend
```

Set `NEXT_PUBLIC_RUNOFF_API_URL` if the backend is not at `http://127.0.0.1:8000`.

## Backend contract

The frontend loads the verified Clear Brook manifest from `GET /api/site`, then fetches the WGS84 GeoJSON URLs supplied in its `layers` object. `POST /api/analyze` returns resident and professional explanations generated from the precomputed backend outputs.

The backend reads `runoff_debt.json`, `exposure_metrics.json`, and `change_metrics.json` at request time, so rerunning the geospatial pipeline updates the MVP without copying data into the frontend.

## Online map sources

The live map uses Esri World Imagery and public Terrarium elevation tiles. MapLibre renders a globe projection, pitched terrain, backend GeoJSON layers, and extruded affected buildings in the browser.

## Product language

This is a screening tool. It never labels a building as flooded, unsafe, contaminated, or noncompliant. It identifies places that may warrant closer stormwater review.
