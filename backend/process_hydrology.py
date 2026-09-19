import os
from whitebox import WhiteboxTools

project_directory = os.path.abspath(".")

wbt = WhiteboxTools()
wbt.set_working_dir(project_directory)
wbt.set_verbose_mode(True)

print("Step 1/4: Filling depressions...")
wbt.fill_depressions(
    "dem.tif",
    "dem_filled.tif",
    fix_flats=True
)

print("Step 2/4: Calculating slope...")
wbt.slope(
    "dem_filled.tif",
    "slope.tif",
    units="degrees"
)

print("Step 3/4: Calculating D8 flow direction...")
wbt.d8_pointer(
    "dem_filled.tif",
    "flow_direction.tif",
    esri_pntr=False
)

print("Step 4/4: Calculating flow accumulation...")
wbt.d8_flow_accumulation(
    "dem_filled.tif",
    "flow_accumulation.tif",
    out_type="cells",
    log=False,
    clip=False,
    pntr=False
)

print("Hydrology processing complete.")
print("Created:")
print("  dem_filled.tif")
print("  slope.tif")
print("  flow_direction.tif")
print("  flow_accumulation.tif")
