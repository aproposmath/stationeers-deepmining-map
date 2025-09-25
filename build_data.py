from PIL import Image
import numpy as np
import json
import subprocess
from lxml import etree
from osgeo import gdal
from topojson import Topology
import os
import tempfile
from pathlib import Path
import sys

def build_topojson(world_file, mining_regions_file, output_file):
    calling_dir = os.getcwd()
    world_file = Path(calling_dir) / world_file
    mining_regions_file = Path(calling_dir) / mining_regions_file
    output_file = Path(calling_dir) / output_file

    with tempfile.TemporaryDirectory() as tmpdirname:
        os.chdir(tmpdirname)
        tree = etree.parse(world_file)
        root = tree.getroot()

        # search recursively for all nodes with type Region and "DeepMiningRegion" in name
        regions = {}
        for elem in root.xpath("//Region"):
            name = elem.get("Id")
            if name and "DeepMin" in name and "Region" in name:
                name = elem.get("Id")
                if "Profile" in name:
                    continue
                if elem.get("R") is None:
                    continue
                r = int(elem.get("R"))
                g = int(elem.get("G"))
                b = int(elem.get("B"))
                n = name.find("DeepMiningRegion")
                name = name[n + len("DeepMiningRegion") :]
                # split name at uppercase letters
                name = "".join([" " + c if c.isupper() else c for c in name]).strip()
                regions[(r, g, b)] = name

        # Load image and get unique RGB colors
        img = Image.open(mining_regions_file).convert("RGB")
        arr = np.array(img)

        # Flatten to list of RGB tuples
        colors = np.unique(arr.reshape(-1, 3), axis=0)

        # Create a color-to-index mapping
        color_to_index = {
            tuple(color): idx + 1 for idx, color in enumerate(colors)
        }  # 0 = background

        # Create label image
        label_arr = np.zeros((arr.shape[0], arr.shape[1]), dtype=np.uint8)
        for color, idx in color_to_index.items():
            mask = np.all(arr == color, axis=-1)
            label_arr[mask] = idx

        # Save label image as GeoTIFF for GDAL
        driver = gdal.GetDriverByName("GTiff")
        out_ds = driver.Create("labels.tif", arr.shape[1], arr.shape[0], 1, gdal.GDT_Byte)
        out_ds.GetRasterBand(1).WriteArray(label_arr)
        out_ds.FlushCache()
        out_ds = None

        subprocess.check_output(
            ["gdal_polygonize.py", "labels.tif", "-f", "GeoJSON", "deep_raw_large.geojson"]
        )
        subprocess.check_output(
            ["ogr2ogr", "-f", "GeoJSON", "deep_raw.geojson", "deep_raw_large.geojson"]
        )

        with open("deep_raw.geojson") as f:
            data = json.load(f)

        index_to_color = {v: k for k, v in color_to_index.items()}

        # Find bounding box
        all_coords = []
        for feature in data["features"]:
            geom = feature["geometry"]
            coords = geom["coordinates"]
            if "DN" in feature["properties"]:
                idx = feature["properties"]["DN"]
                color = index_to_color.get(idx, (0, 0, 0))
                color = [int(c) for c in color]
                hex_color = "#{:02x}{:02x}{:02x}".format(*color)
                feature["properties"]["rgb"] = color
                feature["properties"]["color_hex"] = hex_color
                name = regions.get(tuple(color), "Unknown")
                feature["properties"]["name"] = name
                if( name == "Unknown"):
                    print("Warning: Unknown region for color", color)
            if geom["type"] == "Polygon":
                all_coords.extend(coords[0])
            elif geom["type"] == "MultiPolygon":
                for poly in coords:
                    all_coords.extend(poly[0])

        xs, ys = zip(*all_coords)
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)

        # Normalize
        def normalize(x, y):
            nx = (x - min_x) / (max_x - min_x)
            ny = (y - min_y) / (max_y - min_y)
            return [nx, 1.0 - ny]

        for feature in data["features"]:
            geom = feature["geometry"]
            if geom["type"] == "Polygon":
                geom["coordinates"] = [
                    [normalize(x, y) for x, y in ring] for ring in geom["coordinates"]
                ]
            elif geom["type"] == "MultiPolygon":
                geom["coordinates"] = [
                    [[normalize(x, y) for x, y in ring] for ring in poly]
                    for poly in geom["coordinates"]
                ]

    os.chdir(calling_dir)
    Topology(data).to_json(output_file)

worlds = {
        "Europa": ("Europa/Europa.xml", "Europa/Textures/europa_deep_mining_regions.png", "europa.topojson"),
        "Vulcan": ("Vulcan/Vulcan.xml", "Vulcan/Textures/vulcan_deep_mining_regions.png", "vulcan.topojson"),
        "Mars": ("Mars2/Mars2.xml", "Mars2/Textures/mars_deep_mining_regions.png", "mars.topojson"),
        "Venus": ("Venus/Venus.xml", "Venus/Textures/venus_deep_mining_regions.png", "venus.topojson"),
        "Mimas": ("Mimas/MimasHerschel.xml", "Mimas/Textures/mimas_herschel_deep_mining_regions.png", "mimas.topojson"),
        "Lunar": ("Lunar/Lunar.xml", "Lunar/Textures/lunar_mare_deep_mining_regions.png", "lunar.topojson"),
        }

if __name__ == "__main__":
    if len(sys.argv)<2:
        base_dir = Path("~/.sa/Stationeers/rocketstation_Data/StreamingAssets/Worlds").expanduser()
    else:
        base_dir = Path(sys.argv[1])

    for world, (world_definition, deep_mining_regions_image, output_topojson) in worlds.items():
        build_topojson(base_dir/world_definition, base_dir/deep_mining_regions_image, output_topojson)


