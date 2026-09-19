import py3dep

# Expanded roughly 2–3 km around the Amazon development.
# Order: west, south, east, north
bbox = (-78.114, 39.261, -78.042, 39.318)

print("Checking available 3DEP resolutions...")
availability = py3dep.check_3dep_availability(bbox)
print(availability)

try:
    print("Downloading 1-meter DEM...")
    dem = py3dep.get_dem(
        bbox,
        resolution=1,
        crs="EPSG:4326"
    )
except Exception as error:
    print(f"1-meter DEM unavailable or failed: {error}")
    print("Falling back to 10-meter DEM...")

    dem = py3dep.get_dem(
        bbox,
        resolution=10,
        crs="EPSG:4326"
    )

# Clear Brook, Virginia is in UTM Zone 17N.
dem = dem.rio.reproject("EPSG:26917")

dem.rio.to_raster("dem.tif")

print("Saved dem.tif")
print(f"CRS: {dem.rio.crs}")
print(f"Width: {dem.rio.width}")
print(f"Height: {dem.rio.height}")
print(f"Bounds: {dem.rio.bounds()}")
