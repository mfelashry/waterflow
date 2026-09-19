import os
import geopandas as gpd
from shapely.geometry import Point
from whitebox import WhiteboxTools

PROJECT_DIR = os.path.abspath(".")
SITE_FILE = "new-development.geojson"
SPACING_METERS = 75
CORRIDOR_BUFFER_METERS = 40

# Load the development and project it into metric UTM coordinates.
site = gpd.read_file(SITE_FILE).to_crs("EPSG:26917")
site_geometry = site.geometry.union_all()

# Generate regularly spaced runoff seed points.
min_x, min_y, max_x, max_y = site_geometry.bounds
seed_points = []

x = min_x
while x <= max_x:
    y = min_y

    while y <= max_y:
        point = Point(x, y)

        if site_geometry.covers(point):
            seed_points.append(point)

        y += SPACING_METERS

    x += SPACING_METERS

if not seed_points:
    raise RuntimeError("No runoff seed points were created.")

seeds = gpd.GeoDataFrame(
    {"seed_id": range(1, len(seed_points) + 1)},
    geometry=seed_points,
    crs="EPSG:26917"
)

# Shapefile is the safest vector input format for WhiteboxTools.
seeds.to_file("runoff_seeds.shp")

print(f"Created {len(seeds)} runoff seed points.")

wbt = WhiteboxTools()
wbt.set_working_dir(PROJECT_DIR)
wbt.set_verbose_mode(True)

print("Tracing downslope flow paths...")

wbt.trace_downslope_flowpaths(
    "runoff_seeds.shp",
    "flow_direction.tif",
    "runoff_paths.tif",
    esri_pntr=False,
    zero_background=True
)

print("Converting runoff paths to vector lines...")

wbt.raster_to_vector_lines(
    "runoff_paths.tif",
    "runoff_paths.shp"
)

paths = gpd.read_file("runoff_paths.shp")

if paths.empty:
    raise RuntimeError("No runoff paths were generated.")

# Merge all paths and create a 40-meter modeled exposure corridor.
merged_paths = paths.geometry.union_all()
corridor_geometry = merged_paths.buffer(CORRIDOR_BUFFER_METERS)

corridor = gpd.GeoDataFrame(
    {
        "name": ["Modeled downstream runoff corridor"],
        "model": ["D8 modeled overland flow"],
        "buffer_m": [CORRIDOR_BUFFER_METERS]
    },
    geometry=[corridor_geometry],
    crs=paths.crs
)

# GeoJSON should use WGS84 longitude and latitude.
corridor.to_crs("EPSG:4326").to_file(
    "downstream_corridor.geojson",
    driver="GeoJSON"
)

paths.to_crs("EPSG:4326").to_file(
    "runoff_paths.geojson",
    driver="GeoJSON"
)

print("Runoff tracing complete.")
print("Created:")
print("  runoff_seeds.shp")
print("  runoff_paths.tif")
print("  runoff_paths.geojson")
print("  downstream_corridor.geojson")
