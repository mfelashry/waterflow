import marimo

__generated_with = "0.24.2"
app = marimo.App(width="medium")


@app.cell
def _():
    import base64
    import json

    import altair as alt
    import marimo as mo
    import pandas as pd

    return alt, base64, json, mo, pd


@app.cell
def _(base64, json, mo):
    # The host app embeds this notebook in an iframe and passes the current site's
    # measurements through the URL as base64-encoded JSON in the `data` query param.
    _raw = mo.query_params().get("data")

    def _decode(raw):
        if not raw:
            return None
        try:
            return json.loads(base64.urlsafe_b64decode(raw.encode()).decode())
        except Exception:
            try:
                return json.loads(raw)
            except Exception:
                return None

    payload = _decode(_raw)
    return (payload,)


@app.cell
def _(payload):
    stats = (payload or {}).get("stats") or {}
    streamflow = (payload or {}).get("streamflow")
    return stats, streamflow


@app.cell
def _(alt):
    # Shared dark styling so the charts sit cleanly inside the glass panel.
    INK = "#b7c7dc"
    MUTED = "#64788f"
    ACCENT = "#38bdf8"

    def style(chart):
        return (
            chart.configure(background="transparent")
            .configure_view(strokeOpacity=0)
            .configure_axis(
                labelColor=INK,
                titleColor=MUTED,
                gridColor="#1c2836",
                domainColor="#2a3a4d",
                tickColor="#2a3a4d",
                labelFontSize=11,
                titleFontSize=11,
            )
            .configure_legend(labelColor=INK, titleColor=MUTED)
            .configure_title(color="#e9eff8", fontSize=13)
        )

    return ACCENT, MUTED, style


@app.cell
def _(ACCENT, MUTED, alt, mo, pd, streamflow, style):
    if streamflow and streamflow.get("readings"):
        _readings = streamflow["readings"]
        _median = streamflow.get("median")
        _gauge = (streamflow.get("gauge") or {}).get("name", "USGS gauge")
        _dist = (streamflow.get("gauge") or {}).get("distanceKm")

        _df = pd.DataFrame(_readings)
        _df["date"] = pd.to_datetime(_df["date"])

        _line = (
            alt.Chart(_df)
            .mark_line(point=alt.OverlayMarkDef(color=ACCENT, size=55), color=ACCENT, strokeWidth=2)
            .encode(
                x=alt.X("date:T", title="Capture date"),
                y=alt.Y("discharge:Q", title="Discharge (ft³/s)"),
                tooltip=[
                    alt.Tooltip("date:T", title="Date"),
                    alt.Tooltip("discharge:Q", title="ft³/s", format=","),
                    alt.Tooltip("ratioToMedian:Q", title="× median", format=".2f"),
                    alt.Tooltip("percentile:Q", title="percentile", format=".0%"),
                ],
            )
        )

        _layers = [_line]
        if _median:
            _rule = (
                alt.Chart(pd.DataFrame({"y": [_median]}))
                .mark_rule(color=MUTED, strokeDash=[4, 4])
                .encode(y="y:Q")
            )
            _layers.append(_rule)

        _chart = style(
            alt.layer(*_layers)
            .properties(height=220, width="container", title="Streamflow on each capture")
            .resolve_scale(y="shared")
        )
        _note = f"{_gauge}" + (f" · {_dist} km away" if _dist else "") + (
            f" · median {_median:,.0f} ft³/s" if _median else ""
        )
        streamflow_view = mo.vstack([mo.ui.altair_chart(_chart, chart_selection=False), mo.md(f"<small>{_note}</small>")])
    else:
        streamflow_view = mo.callout(
            mo.md("No USGS stream gauge with a record sits near this site, so there is no discharge series to plot."),
            kind="info",
        )
    streamflow_view
    return


@app.cell
def _(ACCENT, alt, mo, pd, stats, style):
    _rows = [
        {"metric": "Channels", "value": stats.get("channelCount", 0)},
        {"metric": "Roofs", "value": stats.get("buildingCount", 0)},
        {"metric": "Water", "value": stats.get("waterbodyCount", 0)},
        {"metric": "Wetland", "value": stats.get("wetlandCount", 0)},
    ]
    if any(r["value"] for r in _rows):
        _df = pd.DataFrame(_rows)
        _bars = (
            alt.Chart(_df)
            .mark_bar(color=ACCENT)
            .encode(
                x=alt.X("value:Q", title="Feature count"),
                y=alt.Y("metric:N", title=None, sort="-x"),
                tooltip=[alt.Tooltip("metric:N"), alt.Tooltip("value:Q", format=",")],
            )
            .properties(height=170, width="container", title="Mapped features within 3 km")
        )
        measurements_view = mo.ui.altair_chart(style(_bars), chart_selection=False)
    else:
        measurements_view = mo.callout(mo.md("No mapped features were returned for this site."), kind="info")
    measurements_view
    return


@app.cell
def _(mo, stats):
    _km = stats.get("channelKm")
    _imp = stats.get("impervousKm")
    _elev = stats.get("elevationRange")
    _named = stats.get("namedChannels") or []
    _bits = []
    if _km:
        _bits.append(f"**{_km:.1f} km** of channel")
    if _imp:
        _bits.append(f"**{_imp:.0f} km** of road")
    if _elev and len(_elev) == 2:
        _bits.append(f"**{_elev[1] - _elev[0]:.0f} m** relief ({_elev[0]}–{_elev[1]} m)")
    _foot = " · ".join(_bits) if _bits else ""
    _channels = ("Named channels: " + " · ".join(_named)) if _named else ""
    mo.md("\n\n".join(x for x in [_foot, _channels] if x)) if (_foot or _channels) else None
    return


if __name__ == "__main__":
    app.run()
