import json
from pathlib import Path

import geopandas as gpd

METRIC_CRS = "EPSG:26917"


def load_layer(filename):
    layer = gpd.read_file(filename)

    if layer.crs is None:
        layer = layer.set_crs("EPSG:4326")

    return layer.to_crs(METRIC_CRS)


corridor = load_layer("downstream_corridor.geojson")
paths = load_layer("runoff_paths.geojson")
buildings = load_layer("buildings.geojson")
roads = load_layer("roads.geojson")
wetlands = load_layer("wetlands.geojson")

corridor_geometry = corridor.geometry.union_all()

# Find intersecting buildings.
exposed_buildings = buildings[
    buildings.geometry.intersects(corridor_geometry)
].copy()

# Clip roads to only the portions inside the corridor.
exposed_roads = roads[
    roads.geometry.intersects(corridor_geometry)
].copy()

exposed_roads["geometry"] = exposed_roads.geometry.intersection(
    corridor_geometry
)

# Clip wetlands to only the portions inside the corridor.
exposed_wetlands = wetlands[
    wetlands.geometry.intersects(corridor_geometry)
].copy()

exposed_wetlands["geometry"] = exposed_wetlands.geometry.intersection(
    corridor_geometry
)

# OSM returned no schools, so record zero unless a file exists.
school_count = 0

if Path("schools.geojson").exists():
    schools = load_layer("schools.geojson")
    exposed_schools = schools[
        schools.geometry.intersects(corridor_geometry)
    ].copy()

    school_count = len(exposed_schools)

    if not exposed_schools.empty:
        exposed_schools.to_crs("EPSG:4326").to_file(
            "exposed_schools.geojson",
            driver="GeoJSON"
        )

metrics = {
    "site": "Amazon Distribution Center - Clear Brook",
    "analysis_type": "D8 modeled overland flow",
    "corridor_buffer_m": 40,
    "corridor_area_hectares": round(
        corridor_geometry.area / 10000,
        2
    ),
    "modeled_flow_path_length_km": round(
        paths.geometry.length.sum() / 1000,
        2
    ),
    "buildings_intersecting_corridor": int(
        len(exposed_buildings)
    ),
    "schools_intersecting_corridor": int(
        school_count
    ),
    "road_segments_intersecting_corridor": int(
        len(exposed_roads)
    ),
    "road_length_inside_corridor_km": round(
        exposed_roads.geometry.length.sum() / 1000,
        2
    ),
    "wetland_features_intersecting_corridor": int(
        len(exposed_wetlands)
    ),
    "wetland_area_inside_corridor_hectares": round(
        exposed_wetlands.geometry.area.sum() / 10000,
        2
    ),
    "limitations": [
        "Models terrain-based overland flow only.",
        "Does not model storm drains or underground pipes.",
        "Road culverts may alter real-world flow routes.",
        "Building and road coverage comes from OpenStreetMap.",
        "School count is limited by available OpenStreetMap data."
    ]
}

with open("exposure_metrics.json", "w", encoding="utf-8") as file:
    json.dump(metrics, file, indent=2)

if not exposed_buildings.empty:
    exposed_buildings.to_crs("EPSG:4326").to_file(
        "exposed_buildings.geojson",
        driver="GeoJSON"
    )

if not exposed_roads.empty:
    exposed_roads.to_crs("EPSG:4326").to_file(
        "exposed_roads.geojson",
        driver="GeoJSON"
    )

if not exposed_wetlands.empty:
    exposed_wetlands.to_crs("EPSG:4326").to_file(
        "exposed_wetlands.geojson",
        driver="GeoJSON"
    )

print(json.dumps(metrics, indent=2))
print("Exposure analysis complete.")
