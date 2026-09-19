import numpy as np
import rasterio

FILES = [
    "before_summer_2016.tif",
    "after_summer_2020.tif",
    "before_2016.tif",
    "after_2018.tif"
]

for filename in FILES:
    print("\n" + "=" * 70)
    print(filename)

    with rasterio.open(filename) as source:
        print("Band count:", source.count)
        print("Descriptions:", source.descriptions)
        print("Color interpretation:", source.colorinterp)
        print("Dataset tags:", source.tags())

        for band_number in range(1, source.count + 1):
            band = source.read(
                band_number,
                masked=True
            ).astype("float32")

            values = band.compressed()

            print(
                f"Band {band_number}: "
                f"min={np.min(values):.2f}, "
                f"median={np.median(values):.2f}, "
                f"mean={np.mean(values):.2f}, "
                f"max={np.max(values):.2f}"
            )
