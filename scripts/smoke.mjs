/**
 * Headless smoke test: loads the app, drives a search + descent, and reports console
 * errors plus what actually rendered on the map.
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
    "--window-size=1440,900",
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

const messages = [];
page.on("console", (message) => {
  if (["error", "warning"].includes(message.type())) {
    messages.push(`[${message.type()}] ${message.text()}`);
  }
});
page.on("pageerror", (error) => messages.push(`[pageerror] ${error.message}`));
page.on("requestfailed", (request) =>
  messages.push(`[requestfailed] ${request.url()} ${request.failure()?.errorText}`),
);

const textureRequests = [];
page.on("response", (response) => {
  const url = response.url();
  if (url.includes("earth-texture") || url.includes("wayback") || url.includes("arcgisonline")) {
    textureRequests.push(`${response.status()} ${url.slice(0, 110)}`);
  }
});

console.log("> loading", BASE);
await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
await sleep(6000);

const canvasCount = await page.$$eval("canvas", (nodes) => nodes.length);
const headline = await page.$eval("h1", (node) => node.textContent).catch(() => null);
console.log("canvases:", canvasCount, "| headline:", headline);
await page.screenshot({ path: `${OUT}/01-globe.png` });

const webgl = await page.evaluate(() => {
  const canvas = document.querySelector("canvas");
  if (!canvas) return "no canvas";
  const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  return context ? `${canvas.width}x${canvas.height}` : "no webgl context";
});
console.log("globe canvas:", webgl);

console.log("> searching");
await page.type('input[role="combobox"]', "Clear Brook, Virginia", { delay: 40 });
await page.waitForSelector("ul li button", { timeout: 25000 });
const options = await page.$$eval("ul li button", (nodes) =>
  nodes.slice(0, 4).map((node) => node.textContent?.replace(/\s+/g, " ").trim()),
);
console.log("results:", options);
await page.screenshot({ path: `${OUT}/02-results.png` });

await page.click("ul li button");
await sleep(1600);
await page.screenshot({ path: `${OUT}/03-descent.png` });
await sleep(3200);
await page.screenshot({ path: `${OUT}/04-arrival.png` });
await sleep(6000);
await page.screenshot({ path: `${OUT}/05-map.png` });

const mapState = await page.evaluate(() => {
  const canvases = [...document.querySelectorAll("canvas")].map((c) => `${c.width}x${c.height}`);
  const text = document.body.innerText.replace(/\s+/g, " ").slice(0, 900);
  return { canvases, text };
});
console.log("canvases after arrival:", mapState.canvases);
console.log("panel text:", mapState.text);

// Expand the analysis section.
const expanded = await page.evaluate(() => {
  const button = [...document.querySelectorAll("button")].find((node) =>
    node.textContent?.includes("Site analysis"),
  );
  button?.click();
  return Boolean(button);
});
console.log("analysis toggle found:", expanded);
await sleep(7000);
await page.screenshot({ path: `${OUT}/06-analysis.png` });

const analysisText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
console.log("analysis snippet:", analysisText.slice(0, 1400));

console.log("\n=== imagery/tile responses (first 12) ===");
console.log(textureRequests.slice(0, 12).join("\n"));
console.log("total imagery/tile responses:", textureRequests.length);

console.log("\n=== console errors/warnings ===");
console.log(messages.length ? messages.slice(0, 40).join("\n") : "(none)");

await browser.close();
