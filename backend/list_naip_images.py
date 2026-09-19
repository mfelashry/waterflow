from pystac_client import Client

catalog = Client.open(
    "https://planetarycomputer.microsoft.com/api/stac/v1"
)

aoi = {
    "type": "Polygon",
    "coordinates": [[
        [-78.083712, 39.286176],
        [-78.071799, 39.286176],
        [-78.071799, 39.292356],
        [-78.083712, 39.292356],
        [-78.083712, 39.286176]
    ]]
}

search = catalog.search(
    collections=["naip"],
    intersects=aoi,
    datetime="2016-01-01/2023-12-31"
)

items = sorted(
    list(search.items()),
    key=lambda item: item.datetime
)

for item in items:
    print("=" * 70)
    print("ID:", item.id)
    print("Date:", item.datetime)
    print("Assets:", list(item.assets.keys()))
