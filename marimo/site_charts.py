"""Water Flow · Marimo site charts

Companion notebook. Reads the current site from Waterflow's /api/site-snapshot
endpoint (Next.js), then charts rainfall, gauge flow, hydrology, elevation,
soil, and flood context.

Run:
  npm run marimo
  # or: bash scripts/start-marimo.sh
"""

import marimo

__generated_with = "0.24.2"
app = marimo.App(width="medium")


@app.cell
def _():
    import marimo as mo
    import pandas as pd
    import altair as alt

    return alt, mo, pd


@app.cell
def _(mo):
    import os

    params = mo.query_params()
    lat = float(params.get("lat") or 39.0438)
    lon = float(params.get("lon") or -77.4874)
    name = str(params.get("name") or "Ashburn")
    detail = str(params.get("detail") or "Virginia, United States")
    origin = os.environ.get("WATERFLOW_ORIGIN", "http://127.0.0.1:43173").rstrip("/")
    return detail, lat, lon, name, origin


@app.cell
def _(detail, lat, lon, name, origin):
    import json
    import urllib.parse
    import urllib.request

    query = urllib.parse.urlencode(
        {"lat": lat, "lon": lon, "name": name, "detail": detail}
    )
    url = f"{origin}/api/site-snapshot?{query}"
    error = None
    payload = None
    try:
        with urllib.request.urlopen(url, timeout=45) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        error = str(exc)
    return error, payload, url


@app.cell
def _(detail, error, lat, lon, mo, name, origin, payload):
    if error:
        banner = mo.md(
            f"""
# Water Flow charts

Could not reach Waterflow at `{origin}`.

Start the Next.js app first:

```bash
npm run dev -- --hostname 127.0.0.1 --port 43173
```

Then reload this Marimo tab.

Details: `{error}`
"""
        )
    else:
        place = (payload or {}).get("place") or {}
        banner = mo.md(
            f"""
# {place.get("name", name)}

{place.get("detail") or detail} · `{float(place.get("lat", lat)):.4f}, {float(place.get("lon", lon)):.4f}`

Charts are driven by live Waterflow APIs (hydrology, Open-Meteo, USGS, SSURGO, FEMA).
"""
        )
    banner
    return


@app.cell
def _(alt, error, mo, payload, pd):
    if error or not payload:
        charts_out = mo.md("_Waiting for Waterflow site data…_")
    else:
        rain = pd.DataFrame(payload.get("rainByYear") or [])
        hydro = payload.get("hydrology") or {}
        soil = payload.get("soil") or {}
        flood = payload.get("flood") or {}
        stream = payload.get("streamflow") or {}
        readings = pd.DataFrame(stream.get("readings") or [])
        charts = []

        # mo.ui.altair_chart enables legend_selection by default. That injects
        # Vega selection params which clear categorical/ordinal bar marks —
        # axes + legend render, but rainfall bars stay empty. Disable both.
        # Fixed width (not "container") so charts do not collapse in the iframe.
        def show_chart(chart):
            return mo.ui.altair_chart(
                chart.properties(width=340),
                chart_selection=False,
                legend_selection=False,
            )

        if not rain.empty:
            wet = payload.get("wettestYear")
            dry = payload.get("driestYear")
            rain = rain.copy()
            rain["year"] = rain["year"].astype(int)
            rain["precipMm"] = pd.to_numeric(rain["precipMm"], errors="coerce")
            rain = rain.dropna(subset=["precipMm"])
            rain["note"] = [
                "wettest" if year == wet else "driest" if year == dry else "capture year"
                for year in rain["year"]
            ]
            # Nominal string years avoid ordinal scale-binding warnings.
            rain["yearLabel"] = rain["year"].astype(str)
            charts.append(
                alt.Chart(rain)
                .mark_bar(cornerRadiusTopLeft=3, cornerRadiusTopRight=3)
                .encode(
                    x=alt.X("yearLabel:N", title="Year", sort=None),
                    y=alt.Y("precipMm:Q", title="Annual precip (mm)"),
                    color=alt.Color(
                        "note:N",
                        scale=alt.Scale(
                            domain=["wettest", "driest", "capture year"],
                            range=["#0284c7", "#d97706", "#94a3b8"],
                        ),
                        # Bottom legend keeps bars readable in the narrow Charts iframe.
                        legend=alt.Legend(title="", orient="bottom", direction="horizontal"),
                    ),
                    tooltip=[
                        alt.Tooltip("year:Q", title="Year", format=".0f"),
                        alt.Tooltip("precipMm:Q", title="Precip (mm)", format=".1f"),
                        alt.Tooltip("note:N", title="Note"),
                    ],
                )
                .properties(title="Rainfall by year (Open-Meteo ERA5)", height=260)
            )

        if not readings.empty:
            readings = readings.copy()
            readings["date"] = pd.to_datetime(readings["date"], errors="coerce")
            readings = readings.dropna(subset=["date"])
            charts.append(
                alt.Chart(readings)
                .mark_line(point=True, color="#38bdf8")
                .encode(
                    x=alt.X("date:T", title="Capture date"),
                    y=alt.Y("discharge:Q", title="Discharge (ft³/s)"),
                    tooltip=["date", "discharge", "ratioToMedian", "percentile"],
                )
                .properties(
                    title=f"Gauge discharge · {stream.get('gauge') or 'USGS'}",
                    height=260,
                )
            )
            charts.append(
                alt.Chart(readings)
                .mark_bar(color="#7dd3fc")
                .encode(
                    x=alt.X("date:T", title="Date"),
                    y=alt.Y("ratioToMedian:Q", title="Ratio to median"),
                    tooltip=["date", "ratioToMedian", "percentile"],
                )
                .properties(title="Discharge vs long-term median", height=220)
            )

        summary_rows = [
            {"metric": "Channels", "value": hydro.get("channelCount")},
            {"metric": "Channel km", "value": hydro.get("channelKm")},
            {"metric": "Waterbodies", "value": hydro.get("waterbodyCount")},
            {"metric": "Wetlands", "value": hydro.get("wetlandCount")},
            {"metric": "Buildings", "value": hydro.get("buildingCount")},
            {"metric": "Roadway km", "value": hydro.get("impervousKm")},
        ]
        elev = hydro.get("elevationRange")
        if elev and len(elev) == 2:
            summary_rows.append({"metric": "Elev min (m)", "value": elev[0]})
            summary_rows.append({"metric": "Elev max (m)", "value": elev[1]})
            summary_rows.append(
                {
                    "metric": "Relief (m)",
                    "value": round(float(elev[1]) - float(elev[0]), 1),
                }
            )

        summary = pd.DataFrame(summary_rows).dropna()
        if not summary.empty:
            charts.append(
                alt.Chart(summary)
                .mark_bar(color="#0ea5e9")
                .encode(
                    x=alt.X("value:Q", title="Value"),
                    y=alt.Y("metric:N", sort="-x", title=""),
                    tooltip=["metric", "value"],
                )
                .properties(title="Hydrology & elevation summary", height=280)
            )

        soil_rows = []
        if soil.get("ksatUmPerSec") is not None:
            soil_rows.append({"metric": "Ksat (µm/s)", "value": soil["ksatUmPerSec"]})
        if soil.get("availableWaterCm") is not None:
            soil_rows.append(
                {"metric": "Available water (cm)", "value": soil["availableWaterCm"]}
            )
        if soil.get("sandPct") is not None:
            soil_rows.append({"metric": "Sand %", "value": soil["sandPct"]})
        if soil.get("clayPct") is not None:
            soil_rows.append({"metric": "Clay %", "value": soil["clayPct"]})
        soil_df = pd.DataFrame(soil_rows)
        if not soil_df.empty:
            charts.append(
                alt.Chart(soil_df)
                .mark_bar(color="#fbbf24")
                .encode(
                    x=alt.X("value:Q", title="Value"),
                    y=alt.Y("metric:N", sort="-x", title=""),
                    tooltip=["metric", "value"],
                )
                .properties(
                    title=(
                        "Soil / infiltration · "
                        f"{soil.get('infiltrationLabel') or soil.get('mapUnit') or 'SSURGO'}"
                    ),
                    height=220,
                )
            )

        flood_md = ""
        if flood:
            drivers = ", ".join(flood.get("drivers") or []) or "none listed"
            flood_md = f"""
### Flood context (FEMA)

- **Zone:** {flood.get("label") or flood.get("zone") or "n/a"}
- **Level:** {flood.get("floodLevel") or "n/a"}
- **SFHA:** {"yes" if flood.get("sfha") else "no"}
- **Outlook:** {flood.get("outlook") or "n/a"}
- **Drivers:** {drivers}
"""

        named = hydro.get("namedChannels") or []
        named_md = (
            "### Named channels\n\n" + ", ".join(f"`{item}`" for item in named)
            if named
            else ""
        )

        blocks = [show_chart(chart) for chart in charts]
        if flood_md:
            blocks.append(mo.md(flood_md))
        if named_md:
            blocks.append(mo.md(named_md))
        if not blocks:
            charts_out = mo.md("_No chartable series returned for this site yet._")
        else:
            charts_out = mo.vstack(blocks)
    charts_out
    return


if __name__ == "__main__":
    app.run()
