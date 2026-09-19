import json
import numpy as np
import rasterio
from rasterio.warp import reproject, Resampling


def calculate_ndvi(filename):
    with rasterio.open(filename) as source:
        red = source.read(1).astype("float32")
        nir = source.read(4).astype("float32")
        valid = source.read_masks(1) > 0

        denominator = nir + red

        ndvi = np.full(red.shape, np.nan, dtype="float32")

        np.divide(
            nir - red,
            denominator,
            out=ndvi,
            where=(denominator != 0) & valid
        )

        return ndvi, valid, source.profile.copy(), source.transform, source.crs


print("Calculating 2016 NDVI...")
before_ndvi, before_valid, profile, before_transform, before_crs = (
    calculate_ndvi("before_summer_2016.tif")
)

print("Calculating 2020 NDVI...")
after_native, after_valid_native, after_profile, after_transform, after_crs = (
    calculate_ndvi("after_summer_2020.tif")
)

# Resample the 2018 NDVI onto the exact 2016 pixel grid.
after_ndvi = np.full(
    before_ndvi.shape,
    np.nan,
    dtype="float32"
)

reproject(
    source=after_native,
    destination=after_ndvi,
    src_transform=after_transform,
    src_crs=after_crs,
    dst_transform=before_transform,
    dst_crs=before_crs,
    src_nodata=np.nan,
    dst_nodata=np.nan,
    resampling=Resampling.bilinear
)

# Resample the validity mask using nearest-neighbor.
after_valid = np.zeros(
    before_valid.shape,
    dtype="uint8"
)

reproject(
    source=after_valid_native.astype("uint8"),
    destination=after_valid,
    src_transform=after_transform,
    src_crs=after_crs,
    dst_transform=before_transform,
    dst_crs=before_crs,
    src_nodata=0,
    dst_nodata=0,
    resampling=Resampling.nearest
)

valid = (
    before_valid
    & (after_valid > 0)
    & np.isfinite(before_ndvi)
    & np.isfinite(after_ndvi)
)

ndvi_change = np.full(
    before_ndvi.shape,
    np.nan,
    dtype="float32"
)

ndvi_change[valid] = (
    after_ndvi[valid] - before_ndvi[valid]
)

# Project definition:
# A decrease greater than 0.30 indicates major vegetation loss.
vegetation_loss = (
    valid
    & (ndvi_change <= -0.30)
)

# A stricter proxy for land converted from vegetation to a low-NDVI
# developed or cleared surface. This is not a perfect impervious map.
conversion_proxy = (
    vegetation_loss
    & (before_ndvi >= 0.20)
    & (after_ndvi <= 0.10)
)

pixel_area_m2 = abs(
    before_transform.a * before_transform.e
)

vegetation_loss_m2 = float(
    vegetation_loss.sum() * pixel_area_m2
)

conversion_proxy_m2 = float(
    conversion_proxy.sum() * pixel_area_m2
)

metrics = {
    "before_date": "2016-07-20",
    "after_date": "2020-07-03",
    "comparison_resolution_m": round(
        abs(before_transform.a),
        3
    ),
    "valid_comparison_area_m2": round(
        valid.sum() * pixel_area_m2,
        2
    ),
    "mean_ndvi_before": round(
        float(np.nanmean(before_ndvi[valid])),
        4
    ),
    "mean_ndvi_after": round(
        float(np.nanmean(after_ndvi[valid])),
        4
    ),
    "mean_ndvi_change": round(
        float(np.nanmean(ndvi_change[valid])),
        4
    ),
    "vegetation_loss_m2": round(
        vegetation_loss_m2,
        2
    ),
    "vegetation_loss_hectares": round(
        vegetation_loss_m2 / 10000,
        2
    ),
    "vegetation_to_low_ndvi_proxy_m2": round(
        conversion_proxy_m2,
        2
    ),
    "vegetation_to_low_ndvi_proxy_hectares": round(
        conversion_proxy_m2 / 10000,
        2
    ),
    "warning": (
        "The low-NDVI conversion result is a spectral proxy, "
        "not a surveyed impervious-surface measurement."
    )
}

output_profile = profile.copy()
output_profile.update(
    driver="GTiff",
    count=1,
    dtype="float32",
    nodata=-9999.0,
    compress="deflate"
)


def save_float_raster(filename, array):
    output = np.where(
        np.isfinite(array),
        array,
        -9999.0
    ).astype("float32")

    with rasterio.open(filename, "w", **output_profile) as destination:
        destination.write(output, 1)


save_float_raster("ndvi_2016.tif", before_ndvi)
save_float_raster("ndvi_2018.tif", after_ndvi)
save_float_raster("ndvi_change.tif", ndvi_change)

mask_profile = profile.copy()
mask_profile.update(
    driver="GTiff",
    count=1,
    dtype="uint8",
    nodata=0,
    compress="deflate"
)

with rasterio.open(
    "vegetation_loss.tif",
    "w",
    **mask_profile
) as destination:
    destination.write(
        vegetation_loss.astype("uint8"),
        1
    )

with rasterio.open(
    "conversion_proxy.tif",
    "w",
    **mask_profile
) as destination:
    destination.write(
        conversion_proxy.astype("uint8"),
        1
    )

with open(
    "change_metrics.json",
    "w",
    encoding="utf-8"
) as file:
    json.dump(metrics, file, indent=2)

print(json.dumps(metrics, indent=2))
print("Change detection complete.")
