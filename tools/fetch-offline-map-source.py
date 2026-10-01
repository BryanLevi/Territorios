"""One-time map-pack preparation; this API is not used by visitors of the app.
Uses the small-bounding-box map endpoint described at
https://wiki.openstreetmap.org/wiki/API_v0.6#Retrieving_map_data_by_bounding_box
Usage: python tools/fetch-offline-map-source.py bounds.json raw-directory checkpoint.json
"""
import json
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

bounds_file, raw_directory, checkpoint_file = map(Path, sys.argv[1:4])
territories = json.loads(bounds_file.read_text(encoding="utf-8"))["territories"]
raw_directory.mkdir(parents=True, exist_ok=True)
done = json.loads(checkpoint_file.read_text(encoding="utf-8")) if checkpoint_file.exists() else []
road_kinds = set("motorway trunk primary secondary tertiary unclassified residential living_street service pedestrian road track path footway steps cycleway motorway_link trunk_link primary_link secondary_link tertiary_link".split())
water_kinds = set("river stream canal ditch drain".split())
reference_keys = set("amenity shop tourism leisure historic healthcare".split())

def tags(element):
    return {tag.attrib["k"]: tag.attrib["v"] for tag in element.findall("tag")}

for territory in territories:
    output = raw_directory / (territory["key"] + ".json")
    if output.exists() or any(item["key"] == territory["key"] and item["bounds"] == territory["bounds"] for item in done):
        continue
    box = territory["bounds"]
    if (box["north"] - box["south"]) * (box["east"] - box["west"]) > .01:
        raise ValueError("Use smaller map-pack bounds.")
    bbox = ",".join(str(box[name]) for name in ("west", "south", "east", "north"))
    request = urllib.request.Request("https://api.openstreetmap.org/api/0.6/map?bbox=" + bbox,
        headers={"User-Agent": "Territorios map-pack preparation (https://github.com/BryanLevi/Territorios)"})
    began = time.monotonic()
    with urllib.request.urlopen(request, timeout=30) as response:
        document = ET.fromstring(response.read())
    if document.tag != "osm" or document.find("error") is not None:
        raise ValueError("Incomplete OSM map response.")
    nodes = {node.attrib["id"]: {"lat": float(node.attrib["lat"]), "lon": float(node.attrib["lon"])} for node in document.findall("node")}
    roads, references = [], []
    for node in document.findall("node"):
        node_tags = tags(node)
        point = nodes[node.attrib["id"]]
        if reference_keys.intersection(node_tags) and box["south"] <= point["lat"] <= box["north"] and box["west"] <= point["lon"] <= box["east"]:
            references.append({"type": "node", "id": int(node.attrib["id"]), **point, "tags": node_tags})
    for way in document.findall("way"):
        way_tags = tags(way)
        relevant_road = way_tags.get("highway") in road_kinds or way_tags.get("waterway") in water_kinds
        relevant_place = bool(reference_keys.intersection(way_tags))
        if not (relevant_road or relevant_place):
            continue
        # The map API includes all nodes of each returned way. Never publish a
        # shortened road when a response is missing one of those nodes.
        geometry = [nodes[nd.attrib["ref"]] for nd in way.findall("nd")]
        if len(geometry) < 2:
            raise ValueError("Incomplete way geometry.")
        element = {"type": "way", "id": int(way.attrib["id"]), "tags": way_tags}
        if relevant_road:
            roads.append({**element, "geometry": geometry})
        if relevant_place:
            references.append({**element, "center": {
                "lat": (min(p["lat"] for p in geometry) + max(p["lat"] for p in geometry)) / 2,
                "lon": (min(p["lon"] for p in geometry) + max(p["lon"] for p in geometry)) / 2}})
    output.write_text(json.dumps({"roadElements": roads, "referenceElements": references}, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"key": territory["key"], "name": territory["name"], "roads": len(roads), "references": len(references), "seconds": round(time.monotonic() - began, 2)}, ensure_ascii=False), flush=True)
    time.sleep(1)
