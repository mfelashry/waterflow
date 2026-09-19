import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const files = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];
for (const file of files) {
  const target = join("public", "maplibre", file);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join("node_modules", "maplibre-gl", "dist", file), target);
}
