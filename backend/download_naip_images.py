from pystac_client import Client
import planetary_computer as pc
import rasterio
from rasterio.mask import mask
from rasterio.warp import transform_geom

ITEMS = {
    "before_2016.tif": "wv_m_3907848_sw_17_1_20160905",
    "after_2018.tif": "va_m_3907848_sw_17_060_20181108_20190224",
    "current_2023.tif": "va_m_3907848_sw_17_060_20231023_20240103",
    "before_summer_2016.tif": "va_m_3907848_sw_17_1_20160720_20160928",
    "after_summer_2020.tif": "wv_m_3907848_sw_17_060_20200703"
}

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

catalog = Client.open(
    "https://planetarycomputer.microsoft.com/api/stac/v1"
)

search = catalog.search(
    collections=["naip"],
    ids=list(ITEMS.values())
)

found_items = {
    item.id: item
    for item in search.items()
}

for output_name, item_id in ITEMS.items():
    print(f"Processing {item_id}...")

    if item_id not in found_items:
        raise RuntimeError(f"Could not find STAC item: {item_id}")

    item = pc.sign(found_items[item_id])
    image_url = item.assets["image"].href

    with rasterio.open(image_url) as source:
        # The AOI begins as longitude/latitude and must be transformed
        # into the imagery's native coordinate system before cropping.
        projected_aoi = transform_geom(
            "EPSG:4326",
            source.crs,
            aoi
        )

        cropped_data, cropped_transform = mask(
            source,
            [projected_aoi],
            crop=True
        )

        profile = source.profile.copy()
        profile.update(
            driver="GTiff",
            height=cropped_data.shape[1],
            width=cropped_data.shape[2],
            transform=cropped_transform,
            compress="deflate",
            tiled=True,
            BIGTIFF="IF_SAFER"
        )

        with rasterio.open(output_name, "w", **profile) as destination:
            destination.write(cropped_data)

        print(f"Saved {output_name}")
        print(f"  CRS: {source.crs}")
        print(f"  Bands: {source.count}")
        print(f"  Resolution: {source.res}")
        print(
            f"  Cropped size: "
            f"{cropped_data.shape[2]} × {cropped_data.shape[1]}"
        )

print("All NAIP images downloaded.")
