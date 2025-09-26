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
import threading

def build_terrain(normals_file, output_file):
    img = Image.open(normals_file).convert("RGB")
    arr = np.array(img).astype(np.float32)
    gray = 0.21 * arr[:, :, 0] + 0.72 * arr[:, :, 1] + 0.07 * arr[:, :, 2]
    gray = (gray - gray.min()) / (gray.max() - gray.min()) * 255.0
    gray = gray.astype(np.uint8)
    gray_img = Image.fromarray(gray)
    new_size = (gray_img.width // 4, gray_img.height // 4)
    gray_img = gray_img.resize(new_size, Image.LANCZOS)
    gray_img.save(output_file)

def normalize_names(names):
    names = list(names)
    common_prefix = names[0]
    for name in names:
        # find common prefix between common_prefix and name
        i = 0
        while i < len(common_prefix) and i < len(name) and common_prefix[i] == name[i]:
            i += 1
        common_prefix = common_prefix[:i]

    names = [name[len(common_prefix):].strip() for name in names]
    for i in range(len(names)):
        name = names[i]
        name = "".join([" " + c if c.isupper() else c for c in name]).strip()
        names[i] = name

    return names

def find_start_locations(root):
    start_names = []
    positions = []
    for spawn in root.xpath("//StartLocation"):
        pos = spawn.find(".//Position")
        if pos is not None:
            x = float(pos.get("x"))
            y = float(pos.get("y"))
            positions.append((x, y))
            start_names.append(spawn.get("Id"))
    names = normalize_names(start_names)
    return  {name: pos for name, pos in zip(names, positions)}

def extract_regions(parent_path, node, keep_uncolored_features=False):
    calling_dir = os.getcwd()
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)
        region_colors = []
        region_names = []
        for region in node.xpath(".//Region"):
            name = region.get("Id")
            r = int(region.get("R"))
            g = int(region.get("G"))
            b = int(region.get("B"))
            region_colors.append((r, g, b))
            region_names.append(name)

        region_names = normalize_names(region_names)
        regions = {color: name for color, name in zip(region_colors, region_names)}

        image_file = parent_path / node.find(".//Texture").get("Path")

        # Load image and get unique RGB colors
        img = Image.open(image_file).convert("RGB")
        arr = np.array(img)

        # Flatten to list of RGB tuples
        colors = np.unique(arr.reshape(-1, 3), axis=0)

        # Create a color-to-index mapping
        color_to_index = {
            tuple(color): idx + 1 for idx, color in enumerate(colors)
        }  # 0 = background

        # Create label image
        label_arr = np.zeros((arr.shape[0], arr.shape[1]), dtype=np.uint16)
        for color, idx in color_to_index.items():
            mask = np.all(arr == color, axis=-1)
            label_arr[mask] = idx

        # Save label image as GeoTIFF for GDAL
        driver = gdal.GetDriverByName("GTiff")
        label_file = str(tmpdir / "labels.tif")
        out_ds = driver.Create(
            label_file, arr.shape[1], arr.shape[0], 1, gdal.GDT_UInt16
        )
        out_ds.GetRasterBand(1).WriteArray(label_arr)
        out_ds.FlushCache()
        out_ds = None

        geojson_file_large = str(tmpdir / "deep_raw_large.geojson")
        geojson_file = str(tmpdir / "deep_raw.geojson")
        subprocess.check_output(
            [
                "gdal_polygonize.py",
                label_file,
                "-f",
                "GeoJSON",
                geojson_file_large,
            ]
        )
        subprocess.check_output(
            ["ogr2ogr", "-f", "GeoJSON", geojson_file, geojson_file_large]
        )

        with open(geojson_file) as f:
            data = json.load(f)

        index_to_color = {v: k for k, v in color_to_index.items()}

        new_features = []
        for feature in data["features"]:
            if not "DN" in feature["properties"]:
                if keep_uncolored_features:
                    new_features.append(feature)
                continue
            idx = feature["properties"]["DN"]
            color = index_to_color.get(idx, (0, 0, 0))
            color = [int(c) for c in color]
            hex_color = "#{:02x}{:02x}{:02x}".format(*color)
            feature["properties"]["rgb"] = color
            feature["properties"]["color_hex"] = hex_color
            color = tuple(color)
            if color in regions:
                feature["properties"]["name"] = regions[color]
                new_features.append(feature)

        data["features"] = new_features
        return data


def build_data(name, world_file):
    output_prefix = Path(os.getcwd()) / "data" /name
    os.makedirs(output_prefix.parent, exist_ok=True)

    root = etree.parse(world_file).getroot()

    mining_node = None
    poi_node = None
    names_node = None

    for region in root.xpath("//RegionSet"):
        texture = region.find(".//Texture")
        if texture is None:
            continue

        reg_name = region.get("Id").lower()
        if "mining" in reg_name:
            mining_node = region
        elif "poi" in reg_name:
            poi_node = region
        elif "named" in reg_name:
            names_node = region

    # find Macro node inside MaterialSettings node
    normals_file = root.find(".//MaterialSettings").find(".//Macro").find(".//Normal").get("Path")
    if name == "venus":
        normals_file = normals_file.replace("Mars", "Venus")

    normals_file = (Path(world_file).parent.parent.parent/ normals_file).resolve()
    parent_path = Path(world_file).parent.parent.parent
    build_terrain(normals_file, str(output_prefix) + "_terrain.webp")

    mining_data = extract_regions(parent_path, mining_node, True)
    poi_data = extract_regions(parent_path, poi_node)
    names_data = extract_regions(parent_path, names_node)

    # Find bounding box
    all_coords = []
    for data in [mining_data, poi_data, names_data]:
        for feature in data["features"]:
            geom = feature["geometry"]
            coords = geom["coordinates"]
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

    for data in [mining_data, poi_data, names_data]:
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

    alldata = {}
    alldata["start_locations"] = find_start_locations(root)
    for name, data in [("mining", mining_data), ("poi", poi_data), ("names", names_data)]:
        alldata[name] = Topology(data).to_dict() #str(output_prefix) + f"_{name}.topojson")
    json.dump(alldata, open(str(output_prefix) + f".json", "w"))


worlds = {
    "Europa": {
        "dir": "Europa",
        "xml": "Europa.xml",
    },
    "Vulcan": {
        "dir": "Vulcan",
        "xml": "Vulcan.xml",
    },
    "Mars": {
        "dir": "Mars2",
        "xml": "Mars2.xml",
    },
    "Venus": {
        "dir": "Venus",
        "xml": "Venus.xml",
    },
    "Mimas": {
        "dir": "Mimas",
        "xml": "MimasHerschel.xml",
    },
    "Lunar": {
        "dir": "Lunar",
        "xml": "Lunar.xml",
    },
}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        base_dir = Path(
            "~/.sa/Stationeers/rocketstation_Data/StreamingAssets/Worlds"
        ).expanduser()
    else:
        base_dir = Path(sys.argv[1])

    threads = []
    for w in worlds:
        world = worlds[w]
        world_xml = (base_dir / world["dir"]).resolve().absolute() / world['xml']
        t = threading.Thread(target=build_data, args=(w.lower(), world_xml))
        t.start()
        threads.append(t)
        # build_data(
        #     w.lower(),
        #     world_xml,
        # )
    for t in threads:
        t.join()
