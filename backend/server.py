"""HTTP API for the precomputed Runoff Debt MVP analysis."""

from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

BASE_DIR = Path(__file__).resolve().parent

LAYER_FILES = {
    "development": "amazon_roof.geojson",
    "runoff-paths": "runoff_paths.geojson",
    "affected-buildings": "exposed_buildings.geojson",
    "roads": "exposed_roads.geojson",
    "wetlands": "exposed_wetlands.geojson",
}


def read_json(filename: str) -> dict[str, Any]:
    with (BASE_DIR / filename).open(encoding="utf-8") as file:
        return json.load(file)


def build_site(base_url: str) -> dict[str, Any]:
    runoff = read_json("runoff_debt.json")
    exposure = read_json("exposure_metrics.json")
    change = read_json("change_metrics.json")

    one_inch = runoff["storm_scenarios"]["1_inch_storm"]
    return {
        "id": "amazon-clear-brook",
        "name": runoff["site"],
        "location": "Clear Brook, Virginia",
        "center": [-78.0781, 39.2891],
        "years": {
            "before": int(change["before_date"][:4]),
            "after": int(change["after_date"][:4]),
        },
        "status": "verified",
        "analysisType": exposure["analysis_type"],
        "dataSources": [
            "USDA NAIP aerial imagery",
            "OpenStreetMap buildings and roads",
            "USFWS National Wetlands Inventory",
            "USGS elevation data",
        ],
        "analysisUrl": f"{base_url}/api/analyze",
        "layers": {
            "development": f"{base_url}/api/layers/development",
            "runoffPaths": f"{base_url}/api/layers/runoff-paths",
            "affectedBuildings": f"{base_url}/api/layers/affected-buildings",
            "roads": f"{base_url}/api/layers/roads",
            "wetlands": f"{base_url}/api/layers/wetlands",
        },
        "metrics": {
            "roof_area_m2": runoff["roof_area_m2"],
            "roof_area_acres": runoff["roof_area_acres"],
            "vegetation_loss_m2": change["vegetation_loss_m2"],
            "downstream_buildings": exposure["buildings_intersecting_corridor"],
            "schools_downstream": exposure["schools_intersecting_corridor"],
            "road_segments": exposure["road_segments_intersecting_corridor"],
            "road_length_km": exposure["road_length_inside_corridor_km"],
            "wetland_features": exposure["wetland_features_intersecting_corridor"],
            "wetland_area_hectares": exposure[
                "wetland_area_inside_corridor_hectares"
            ],
            "flow_path_length_km": exposure["modeled_flow_path_length_km"],
            "corridor_area_hectares": exposure["corridor_area_hectares"],
            "additional_runoff_gallons_1in": one_inch[
                "additional_runoff_gallons"
            ],
            "pre_development_runoff_coefficient": runoff[
                "pre_development_runoff_coefficient"
            ],
            "roof_runoff_coefficient": runoff["roof_runoff_coefficient"],
        },
        "limitations": list(
            dict.fromkeys(runoff["limitations"] + exposure["limitations"])
        ),
    }


def build_explanation() -> dict[str, str]:
    runoff = read_json("runoff_debt.json")
    exposure = read_json("exposure_metrics.json")
    one_inch = runoff["storm_scenarios"]["1_inch_storm"]

    resident = (
        f"The mapped warehouse roof covers {runoff['roof_area_acres']} acres. "
        f"For a 1 inch storm, the screening calculation estimates about "
        f"{one_inch['additional_runoff_gallons']:,} additional gallons of "
        f"runoff compared with the assumed previous land cover. Modeled "
        f"overland flow paths intersect a corridor containing "
        f"{exposure['buildings_intersecting_corridor']} buildings, "
        f"{exposure['road_segments_intersecting_corridor']} road segments, "
        f"and {exposure['wetland_features_intersecting_corridor']} wetland "
        f"features. Intersection does not mean flooding or damage occurred."
    )
    professional = (
        f"D8 terrain analysis produced "
        f"{exposure['modeled_flow_path_length_km']} km of modeled overland "
        f"flow paths within a {exposure['corridor_buffer_m']} m buffered "
        f"screening corridor ({exposure['corridor_area_hectares']} ha). "
        f"The runoff estimate applies coefficients "
        f"{runoff['pre_development_runoff_coefficient']:.2f} and "
        f"{runoff['roof_runoff_coefficient']:.2f} to the "
        f"{runoff['roof_area_m2']:,.0f} m² roof footprint. Storm drains, "
        f"culverts, detention facilities, and underground infrastructure are "
        f"not modeled; this is not an engineering flood study."
    )
    return {"resident": resident, "professional": professional, "source": "backend"}


class ApiHandler(BaseHTTPRequestHandler):
    server_version = "RunoffDebtAPI/1.0"

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def send_json(
        self, payload: Any, status: int = 200, cache: str = "no-store"
    ) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path.rstrip("/") or "/"
        if path == "/api/health":
            self.send_json({"status": "ok", "site": "amazon-clear-brook"})
            return

        if path == "/api/site":
            host = self.headers.get("Host", "127.0.0.1:8000")
            self.send_json(build_site(f"http://{host}"))
            return

        prefix = "/api/layers/"
        if path.startswith(prefix):
            layer = path.removeprefix(prefix)
            filename = LAYER_FILES.get(layer)
            if not filename:
                self.send_json({"error": "Unknown layer."}, status=404)
                return
            try:
                self.send_json(read_json(filename), cache="public, max-age=300")
            except FileNotFoundError:
                self.send_json(
                    {"error": f"Layer output {filename} is missing."}, status=404
                )
            return

        self.send_json({"error": "Not found."}, status=404)

    def do_POST(self) -> None:
        path = urlparse(self.path).path.rstrip("/")
        if path != "/api/analyze":
            self.send_json({"error": "Not found."}, status=404)
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length:
            self.rfile.read(content_length)
        self.send_json(build_explanation())

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[api] {self.address_string()} {format % args}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve Runoff Debt MVP data")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8000, type=int)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), ApiHandler)
    print(f"Runoff Debt API listening on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
