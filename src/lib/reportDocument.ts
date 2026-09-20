/** Build a print-ready HTML briefing from a CityReport payload. */

export type ReportDocumentInput = {
  title: string;
  subtitle: string;
  generatedAt: string;
  coordinates: { lat: number; lon: number };
  placeName: string;
  placeDetail: string;
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
  riskLevel: "low" | "moderate" | "elevated" | "high";
  sections: { heading: string; body: string }[];
  metrics: { label: string; value: string }[];
  rainTable: { year: number; precipMm: number; note: string }[];
  namedChannels: string[];
  dataSources: string[];
  model: string;
  generatedBy: "xai" | "local";
  selectedYear?: number | null;
  gaugeLabel?: string | null;
  flood?: {
    zoneLabel: string | null;
    floodLevel: string | null;
    sfha: boolean;
    outlookHeadline: string | null;
    outlookBody: string | null;
    drivers: string[];
  } | null;
  soil?: {
    mapUnit: string;
    component: string;
    hydrologicGroup: string | null;
    drainageClass: string | null;
    infiltrationLabel: string;
    infiltrationNote: string;
    details: string;
  } | null;
};

const RISK_THEME: Record<
  ReportDocumentInput["riskLevel"],
  { bg: string; fg: string; label: string }
> = {
  low: { bg: "#d1fae5", fg: "#065f46", label: "Low runoff pressure" },
  moderate: { bg: "#e0f2fe", fg: "#075985", label: "Moderate runoff pressure" },
  elevated: { bg: "#fef3c7", fg: "#92400e", label: "Elevated runoff pressure" },
  high: { bg: "#fee2e2", fg: "#991b1b", label: "High runoff pressure" },
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function paragraphs(text: string) {
  return text
    .split(/\n\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p>${escapeHtml(part)}</p>`)
    .join("");
}

function rainBars(rows: ReportDocumentInput["rainTable"]) {
  if (!rows.length) return "";
  const max = Math.max(...rows.map((row) => row.precipMm), 1);
  const sorted = [...rows].sort((a, b) => a.year - b.year);
  const bars = sorted
    .map((row) => {
      const width = Math.max(4, Math.round((row.precipMm / max) * 100));
      const isWet = /wettest/i.test(row.note);
      const isDry = /driest/i.test(row.note);
      const tone = isWet ? "#0284c7" : isDry ? "#d97706" : "#94a3b8";
      const rowClass = isWet ? "bar-row highlight wet" : isDry ? "bar-row highlight dry" : "bar-row";
      return `<div class="${rowClass}">
        <div class="bar-year">${row.year}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${width}%;background:${tone}"></div></div>
        <div class="bar-val">${Math.round(row.precipMm)} mm</div>
        <div class="bar-note">${escapeHtml(row.note || "-")}</div>
      </div>`;
    })
    .join("");
  return `<section class="card">
    <h3>Climate years · annual precipitation</h3>
    <p class="lede">Open-Meteo ERA5 totals for imagery years that changed at this site. Blue marks the wettest year; amber marks the driest.</p>
    <div class="bars">${bars}</div>
  </section>`;
}

export function buildReportDocument(report: ReportDocumentInput) {
  const risk = RISK_THEME[report.riskLevel];
  const when = new Date(report.generatedAt);
  const whenLabel = when.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const wiki = report.city
    ? `<section class="wiki card">
        <div class="wiki-banner">
          ${
            report.city.thumbnailUrl
              ? `<img src="${escapeHtml(report.city.thumbnailUrl)}" alt="" class="wiki-hero"/>`
              : `<div class="wiki-hero placeholder"></div>`
          }
          <div class="wiki-overlay">
            <div class="eyebrow">Wikipedia</div>
            <h2>${escapeHtml(report.city.name)}</h2>
            ${report.city.description ? `<p class="desc">${escapeHtml(report.city.description)}</p>` : ""}
          </div>
        </div>
        <div class="wiki-body">
          <div class="fact-row">
            ${report.city.population != null ? `<div class="fact"><span>Population</span><strong>${escapeHtml(report.city.population.toLocaleString())}</strong></div>` : ""}
            ${report.city.areaKm2 != null ? `<div class="fact"><span>Area</span><strong>${escapeHtml(String(report.city.areaKm2))} km²</strong></div>` : ""}
            ${report.city.country ? `<div class="fact"><span>Country</span><strong>${escapeHtml(report.city.country)}</strong></div>` : ""}
            ${report.city.river ? `<div class="fact"><span>River</span><strong>${escapeHtml(report.city.river)}</strong></div>` : ""}
          </div>
          ${paragraphs(report.city.blurb)}
          ${
            report.city.sourceUrl
              ? `<p class="source">Source: <a href="${escapeHtml(report.city.sourceUrl)}">${escapeHtml(report.city.sourceUrl)}</a></p>`
              : ""
          }
        </div>
      </section>`
    : `<section class="card"><h3>Wikipedia</h3><p>No encyclopedia article matched this search. Coordinates and measured layers below still apply.</p></section>`;

  const metrics = report.metrics
    .map(
      (metric) =>
        `<div class="metric">
           <div class="metric-label">${escapeHtml(metric.label)}</div>
           <div class="metric-value">${escapeHtml(metric.value)}</div>
         </div>`,
    )
    .join("");

  const channels =
    report.namedChannels.length > 0
      ? `<section class="card">
           <h3>Named channels in the study area</h3>
           <div class="chips">${report.namedChannels
             .map((name) => `<span class="chip">${escapeHtml(name)}</span>`)
             .join("")}</div>
         </section>`
      : "";

  const floodCard = report.flood
    ? `<section class="card flood-card">
        <h3>Flood levels · FEMA NFHL</h3>
        <p class="lede">Public flood-hazard context at the pin. Not a flood insurance determination.</p>
        <div class="fact-row">
          <div class="fact"><span>Zone</span><strong>${escapeHtml(report.flood.zoneLabel ?? "Unmapped")}</strong></div>
          <div class="fact"><span>Level</span><strong>${escapeHtml(report.flood.floodLevel ?? "-")}</strong></div>
          <div class="fact"><span>SFHA</span><strong>${report.flood.sfha ? "Yes" : "No"}</strong></div>
          <div class="fact"><span>Outlook</span><strong>${escapeHtml(report.flood.outlookHeadline ?? "-")}</strong></div>
        </div>
        ${report.flood.outlookBody ? paragraphs(report.flood.outlookBody) : ""}
        ${
          report.flood.drivers.length
            ? `<ul class="drivers">${report.flood.drivers
                .map((driver) => `<li>${escapeHtml(driver)}</li>`)
                .join("")}</ul>`
            : ""
        }
      </section>`
    : "";

  const soilCard = report.soil
    ? `<section class="card">
        <h3>Soil & infiltration · USDA SSURGO</h3>
        <p class="lede">${escapeHtml(report.soil.mapUnit)}</p>
        <div class="fact-row">
          <div class="fact"><span>Component</span><strong>${escapeHtml(report.soil.component)}</strong></div>
          <div class="fact"><span>Hydrologic group</span><strong>${escapeHtml(report.soil.hydrologicGroup ?? "-")}</strong></div>
          <div class="fact"><span>Drainage</span><strong>${escapeHtml(report.soil.drainageClass ?? "-")}</strong></div>
          <div class="fact"><span>Infiltration</span><strong>${escapeHtml(report.soil.infiltrationLabel)}</strong></div>
        </div>
        ${paragraphs(report.soil.infiltrationNote)}
        ${report.soil.details ? `<p class="source">${escapeHtml(report.soil.details)}</p>` : ""}
      </section>`
    : "";

  const sections = report.sections
    .filter((section) => !/wikipedia/i.test(section.heading))
    .map(
      (section, index) =>
        `<section class="card block">
           <div class="section-index">${String(index + 1).padStart(2, "0")}</div>
           <h3>${escapeHtml(section.heading)}</h3>
           ${paragraphs(section.body)}
         </section>`,
    )
    .join("");

  const metaBits = [
    report.placeDetail || null,
    `${report.coordinates.lat.toFixed(5)}°, ${report.coordinates.lon.toFixed(5)}°`,
    report.selectedYear != null ? `Imagery focus ${report.selectedYear}` : null,
    report.gaugeLabel ? `Gauge ${report.gaugeLabel}` : null,
  ].filter(Boolean);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(report.title)}</title>
  <style>
    :root {
      --ink: #0f172a;
      --muted: #64748b;
      --line: #e2e8f0;
      --panel: #f8fafc;
      --brand: #0284c7;
      --brand-soft: #e0f2fe;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      background: #eef2f7;
      font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
      line-height: 1.55;
    }
    .sheet {
      max-width: 880px;
      margin: 28px auto 64px;
      background: #fff;
      border: 1px solid var(--line);
      box-shadow: 0 24px 60px -36px rgba(15, 23, 42, 0.45);
      overflow: hidden;
    }
    .toolbar {
      display: flex;
      gap: 8px;
      padding: 14px 18px;
      background: #fff;
      border-bottom: 1px solid var(--line);
      font-family: ui-sans-serif, system-ui, sans-serif;
    }
    .toolbar button {
      border: 0;
      border-radius: 8px;
      padding: 9px 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .toolbar .primary { background: #0ea5e9; color: #fff; }
    .toolbar .ghost { background: #fff; color: #334155; border: 1px solid #cbd5e1; }
    .masthead {
      padding: 28px 36px 22px;
      background: #fff;
      color: var(--ink);
      border-bottom: 1px solid var(--line);
    }
    .brand {
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 11px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--brand);
      margin-bottom: 14px;
    }
    .masthead h1 {
      margin: 0 0 8px;
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 30px;
      line-height: 1.15;
      color: var(--ink);
      font-weight: 700;
    }
    .masthead .sub {
      margin: 0 0 14px;
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 13px;
      color: var(--muted);
    }
    .meta-line {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 12px;
      color: #475569;
    }
    .pill {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 4px 10px;
      background: var(--panel);
    }
    .content { padding: 28px 36px 40px; }
    .risk {
      display: inline-block;
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 5px 10px;
      border-radius: 999px;
      margin-bottom: 12px;
      background: ${risk.bg};
      color: ${risk.fg};
    }
    .headline {
      margin: 0 0 8px;
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 20px;
      font-weight: 700;
      line-height: 1.25;
    }
    .summary {
      margin: 0 0 22px;
      font-size: 15px;
      color: #334155;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin: 0 0 24px;
    }
    .metric {
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 12px 14px;
      background: var(--panel);
    }
    .metric-label {
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .metric-value {
      margin-top: 6px;
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 17px;
      font-weight: 700;
    }
    .card {
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 18px 18px 8px;
      margin: 0 0 16px;
      background: #fff;
      break-inside: avoid;
    }
    .card h3 {
      margin: 0 0 10px;
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--brand);
    }
    .lede {
      margin: -2px 0 14px;
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 12px;
      color: var(--muted);
    }
    .block { position: relative; padding-left: 52px; }
    .section-index {
      position: absolute;
      left: 16px;
      top: 18px;
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 18px;
      font-weight: 700;
      color: #cbd5e1;
    }
    .card p { margin: 0 0 12px; font-size: 14.5px; color: #1e293b; }
    .wiki { padding: 0; overflow: hidden; }
    .wiki-banner { position: relative; min-height: 180px; background: #0f172a; }
    .wiki-hero { width: 100%; height: 220px; object-fit: cover; display: block; }
    .wiki-hero.placeholder { height: 140px; background: linear-gradient(135deg, #0ea5e9, #0f172a); }
    .wiki-overlay {
      position: absolute; inset: auto 0 0 0;
      padding: 18px 20px;
      background: linear-gradient(180deg, transparent, rgba(2,6,23,0.92));
      color: #fff;
    }
    .eyebrow {
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 10px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #7dd3fc;
      margin-bottom: 4px;
    }
    .wiki-overlay h2 {
      margin: 0;
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 26px;
      line-height: 1.15;
    }
    .desc { margin: 4px 0 0; color: #cbd5e1; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px; }
    .wiki-body { padding: 16px 18px 8px; }
    .fact-row {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 14px;
    }
    .fact {
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 8px 10px;
      background: var(--panel);
      font-family: ui-sans-serif, system-ui, sans-serif;
    }
    .fact span { display: block; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
    .fact strong { display: block; margin-top: 3px; font-size: 13px; }
    .source { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 11px !important; color: var(--muted) !important; }
    .source a { color: var(--brand); }
    .drivers { margin: 0 0 12px; padding-left: 18px; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px; color: #334155; }
    .drivers li { margin-bottom: 4px; }
    .flood-card { border-color: #fecaca; background: #fffafa; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
    .chip {
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 12px;
      padding: 6px 10px;
      border-radius: 999px;
      background: var(--brand-soft);
      color: #075985;
      border: 1px solid #bae6fd;
    }
    .bars { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
    .bar-row {
      display: grid;
      grid-template-columns: 48px 1fr 64px 1.1fr;
      gap: 8px;
      align-items: center;
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 12px;
    }
    .bar-year { font-weight: 700; }
    .bar-track { height: 10px; background: #e2e8f0; border-radius: 999px; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 999px; }
    .bar-val { text-align: right; color: #334155; font-variant-numeric: tabular-nums; }
    .bar-note { color: var(--muted); }
    .footer {
      margin-top: 8px;
      padding-top: 16px;
      border-top: 1px solid var(--line);
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 11px;
      color: var(--muted);
    }
    .disclaimer {
      margin-top: 10px;
      padding: 12px 14px;
      border-radius: 10px;
      background: #fff7ed;
      border: 1px solid #fed7aa;
      color: #9a3412;
      font-size: 12px;
    }
    .bar-row.highlight {
      padding: 6px 8px;
      margin: 0 -8px;
      border-radius: 8px;
    }
    .bar-row.wet { background: #f0f9ff; }
    .bar-row.dry { background: #fffbeb; }
    @page {
      margin: 14mm 12mm 16mm;
    }
    @media print {
      body { background: #fff; }
      .toolbar { display: none !important; }
      .sheet { margin: 0; border: 0; box-shadow: none; max-width: none; }
      .content, .masthead { padding-left: 0; padding-right: 0; }
      a { color: inherit; text-decoration: none; }
      .card, .metric, .wiki, .bar-row { break-inside: avoid; }
      .risk, .chip, .bar-fill, .bar-row.highlight { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
    @media (max-width: 720px) {
      .grid, .fact-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .bar-row { grid-template-columns: 40px 1fr 56px; }
      .bar-note { display: none; }
      .content, .masthead { padding-left: 18px; padding-right: 18px; }
      .block { padding-left: 18px; }
      .section-index { display: none; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="toolbar noprint">
      <button class="primary" onclick="window.print()">Print / Save PDF</button>
      <button class="ghost" onclick="window.close()">Close</button>
    </div>

    <header class="masthead">
      <div class="brand">Water Flow · site briefing</div>
      <h1>${escapeHtml(report.placeName)}</h1>
      <p class="sub">${escapeHtml(report.subtitle)} · Generated ${escapeHtml(whenLabel)}</p>
      <div class="meta-line">
        ${metaBits.map((bit) => `<span class="pill">${escapeHtml(bit as string)}</span>`).join("")}
      </div>
    </header>

    <main class="content">
      <div class="risk">${escapeHtml(risk.label)}</div>
      <p class="headline">${escapeHtml(report.headline)}</p>
      <p class="summary">${escapeHtml(report.summary)}</p>

      <div class="grid">${metrics}</div>

      ${wiki}
      ${floodCard}
      ${soilCard}
      ${channels}
      ${rainBars(report.rainTable)}
      ${sections}

      <div class="footer">
        <div><strong>Data sources:</strong> ${escapeHtml(report.dataSources.join(" · "))}</div>
        <div style="margin-top:6px">
          Written by ${escapeHtml(report.generatedBy === "xai" ? `xAI ${report.model}` : "Water Flow local model")}
          · Study radius 3 km · Not a regulatory flood determination
        </div>
        <div class="disclaimer">
          This briefing visualizes public hydrology, climate, and encyclopedia data for exploration and education.
          Channel widths and wet/dry year jumps are illustrative. It is not a substitute for engineered flood studies,
          surveying, or official FEMA / agency maps.
        </div>
      </div>
    </main>
  </div>
</body>
</html>`;
}
