import json
import geopandas as gpd

METRIC_CRS = "EPSG:26917"

site = gpd.read_file(
    "new-development.geojson"
).to_crs(METRIC_CRS)

buildings = gpd.read_file(
    "buildings.geojson"
).to_crs(METRIC_CRS)

site_geometry = site.geometry.union_all()

# Keep buildings intersecting the selected development site.
site_buildings = buildings[
    buildings.geometry.intersects(site_geometry)
].copy()

# Clip buildings to the development boundary.
site_buildings["geometry"] = (
    site_buildings.geometry.intersection(site_geometry)
)

site_buildings = site_buildings[
    ~site_buildings.geometry.is_empty
].copy()

site_buildings["area_m2"] = site_buildings.geometry.area

# The Amazon warehouse should be the overwhelmingly largest footprint.
largest_building = site_buildings.sort_values(
    "area_m2",
    ascending=False
).iloc[[0]].copy()

roof_area_m2 = float(
    largest_building.iloc[0]["area_m2"]
)

roof_area_acres = roof_area_m2 / 4046.8564224
roof_area_hectares = roof_area_m2 / 10000

largest_building.to_crs("EPSG:4326").to_file(
    "amazon_roof.geojson",
    driver="GeoJSON"
)

metrics = {
    "method": "Largest OpenStreetMap building footprint inside site",
    "roof_area_m2": round(roof_area_m2, 2),
    "roof_area_hectares": round(roof_area_hectares, 2),
    "roof_area_acres": round(roof_area_acres, 2),
    "interpretation": (
        "Conservative lower-bound impervious-area estimate. "
        "Parking lots, loading areas, and roads are excluded."
    )
}

with open(
    "impervious_metrics.json",
    "w",
    encoding="utf-8"
) as file:
    json.dump(metrics, file, indent=2)

print(json.dumps(metrics, indent=2))
