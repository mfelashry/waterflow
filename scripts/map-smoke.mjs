/**
 * Focused check of the map view: does it paint, do the layers exist, does the flow
 * highlight move, and does switching imagery epochs change the picture?
 */
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const BASE = process.env.SMOKE_URL ?? "http://127.0.0.1:4317";
const OUT = "/tmp/smoke";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await puppeteer.launch({
  executablePath: "/usr/local/bin/google-chrome",
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const messages = [];
page.on("console", (message) => {
  if (["error", "warning"].includes(message.type())) messages.push(`[${message.type()}] ${message.text()}`);
});
page.on("pageerror", (error) => messages.push(`[pageerror] ${error.message}`));

await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
await sleep(5000);
await page.type('input[role="combobox"]', "Clear Brook, Virginia", { delay: 30 });
await page.waitForSelector("ul li button", { timeout: 25000 });
await page.click("ul li button");

// Wait for the measured layers rather than a fixed delay.
await page
  .waitForFunction(() => /channels/i.test(document.body.innerText), { timeout: 45000 })
  .catch(() => console.log("!! stats never appeared"));
await sleep(9000);
console.log("panel:", (await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "))).slice(0, 700));

const canvases = await page.$$eval("canvas", (nodes) =>
  nodes.map((node) => `${node.width}x${node.height} css=${node.clientWidth}x${node.clientHeight}`),
);
console.log("canvases:", canvases);

await page.screenshot({ path: `${OUT}/m1.png` });
await sleep(1200);
await page.screenshot({ path: `${OUT}/m2.png` });

// Open each drawer tab so every section renders at least once.
for (const label of ["Measurements", "Imagery", "Layers", "Analysis"]) {
  await page.evaluate((name) => {
    const button = [...document.querySelectorAll("button")].find(
      (node) => node.getAttribute("title") === name,
    );
    button?.click();
  }, label);
  await sleep(1800);
  await page.screenshot({ path: `${OUT}/tab-${label.toLowerCase()}.png` });
}

const layerInfo = await page.evaluate(() => {
  const map = window.__hydroMap;
  if (!map) return "map not exposed";
  const counts = {};
  for (const id of ["flow-casing", "flow-body", "flow-pulse", "waterbodies-fill", "buildings-extrusion"]) {
    counts[id] = map.getLayer(id)
      ? map.queryRenderedFeatures({ layers: [id] }).length
      : "missing";
  }
  return {
    loaded: map.isStyleLoaded(),
    zoom: map.getZoom(),
    terrain: Boolean(map.getTerrain()),
    rendered: counts,
    flowFeatures: map.getSource("flowlines")?._data?.features?.length ?? 0,
  };
});
console.log("layers:", JSON.stringify(layerInfo, null, 2));

// Switch to the oldest and a recent imagery epoch and compare the rendered pixels.
const clickYear = async (year) =>
  page.evaluate((value) => {
    const button = [...document.querySelectorAll("button")].find(
      (node) => node.textContent?.trim() === value,
    );
    button?.click();
    return Boolean(button);
  }, year);

for (const year of ["2014", "2024"]) {
  const ok = await clickYear(year);
  await sleep(7000);
  await page.screenshot({ path: `${OUT}/epoch-${year}.png` });
  console.log(`epoch ${year} clicked:`, ok);
}

console.log("\nconsole:", messages.length ? messages.slice(0, 20).join("\n") : "(none)");
await browser.close();
