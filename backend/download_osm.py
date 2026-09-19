import osmnx as ox
from shapely.geometry import box

# Same expanded area used for the DEM.
study_area = box(
    -78.114,  # west
    39.261,   # south
    -78.042,  # east
    39.318    # north
)

ox.settings.use_cache = True
ox.settings.requests_timeout = 180


def download_layer(name, tags):
    print(f"Downloading {name}...")

    try:
        data = ox.features_from_polygon(study_area, tags=tags)

        if data.empty:
            print(f"No {name} found.")
            return

        # Convert the OSM element/id index into normal columns.
        data = data.reset_index()

        output = f"{name}.geojson"
        data.to_file(output, driver="GeoJSON")

        print(f"Saved {output}: {len(data)} features")

    except Exception as error:
        print(f"Failed to download {name}: {error}")


download_layer(
    "buildings",
    {"building": True}
)

download_layer(
    "schools",
    {"amenity": ["school", "kindergarten", "college"]}
)

download_layer(
    "roads",
    {"highway": True}
)

download_layer(
    "streams",
    {"waterway": ["stream", "river", "drain", "ditch"]}
)

print("OSM download finished.")
