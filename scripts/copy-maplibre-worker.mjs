/**
 * maplibre-gl locates its web worker relative to `import.meta.url`, which does not
 * resolve to a servable path under Next's bundler. Copying the worker into `public/`
 * lets the app point `setWorkerUrl` at a stable URL, and keeps it in step with whatever
 * maplibre-gl version is installed.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

// The worker imports a shared chunk with a relative specifier, so both files have to
// sit next to each other under public/.
const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

try {
  const dist = dirname(require.resolve("maplibre-gl/dist/maplibre-gl.mjs"));
  mkdirSync("public", { recursive: true });

  for (const file of FILES) {
    const source = join(dist, file);
    if (!existsSync(source)) {
      console.warn("maplibre-gl asset not found:", source);
      continue;
    }
    copyFileSync(source, join("public", file));
  }
  console.log(`Copied ${FILES.join(", ")} to public/`);
} catch (error) {
  console.warn("Skipped maplibre-gl worker copy:", error.message);
}
