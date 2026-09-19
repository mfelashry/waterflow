import json
import requests

url = (
    "https://fwspublicservices.wim.usgs.gov/"
    "wetlandsmapservice/rest/services/Wetlands/MapServer/0/query"
)

params = {
    "geometry": "-78.114,39.261,-78.042,39.318",
    "geometryType": "esriGeometryEnvelope",
    "inSR": "4326",
    "outSR": "4326",
    "spatialRel": "esriSpatialRelIntersects",
    "outFields": "*",
    "returnGeometry": "true",
    "f": "geojson"
}

print("Downloading National Wetlands Inventory data...")

response = requests.get(url, params=params, timeout=180)
response.raise_for_status()

data = response.json()

if "error" in data:
    raise RuntimeError(json.dumps(data["error"], indent=2))

features = data.get("features", [])

with open("wetlands.geojson", "w", encoding="utf-8") as file:
    json.dump(data, file)

print(f"Saved wetlands.geojson: {len(features)} features")
