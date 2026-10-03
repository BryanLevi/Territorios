"""Prepare public OSM sources. Reuses complete XML snapshots and relation/full.
Usage: python fetch-offline-map-source.py bounds.json raw-directory checkpoint.json [xml-directory]
https://wiki.openstreetmap.org/wiki/API_v0.6#Retrieving_map_data_by_bounding_box
"""
import json, sys, time, urllib.error, urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

bounds_file, raw_directory, checkpoint_file = map(Path, sys.argv[1:4])
xml_directory = Path(sys.argv[4]) if len(sys.argv)>4 else raw_directory
territories = json.loads(bounds_file.read_text(encoding="utf-8"))["territories"]
raw_directory.mkdir(parents=True, exist_ok=True)
relation_directory = raw_directory/"relations"
relation_directory.mkdir(exist_ok=True)
road_kinds = set("motorway trunk primary secondary tertiary unclassified residential living_street service pedestrian road track path footway steps cycleway motorway_link trunk_link primary_link secondary_link tertiary_link".split())
water_kinds = set("river stream canal ditch drain".split())
reference_keys = set("amenity shop tourism leisure historic healthcare".split())
place_kinds = set("city town village hamlet suburb neighbourhood quarter locality isolated_dwelling".split())
landuse_kinds = set("forest grass meadow village_green recreation_ground allotments cemetery farmland orchard vineyard farmyard residential industrial commercial retail construction railway reservoir basin".split())
natural_kinds = set("water wood grassland scrub heath wetland".split())
leisure_kinds = set("park garden pitch playground sports_centre".split())

def tags(element):
    return {tag.attrib["k"]:tag.attrib["v"] for tag in element.findall("tag")}

def detail_shape(values):
    return values.get("area")!="no" and (values.get("building") not in (None,"no") or values.get("landuse") in landuse_kinds or values.get("natural") in natural_kinds or values.get("leisure") in leisure_kinds or values.get("waterway")=="riverbank")

def read_document(file):
    document=ET.parse(file).getroot()
    if document.tag!="osm" or document.find("error") is not None:
        raise ValueError("Incomplete OSM map response: "+str(file))
    return document

def fetch_document(url,file):
    if file.exists():
        return read_document(file)
    for attempt in range(3):
        request=urllib.request.Request(url,headers={"User-Agent":"Territorios map-pack preparation (https://github.com/BryanLevi/Territorios)"})
        try:
            with urllib.request.urlopen(request,timeout=45) as response:
                payload=response.read()
            document=ET.fromstring(payload)
            if document.tag!="osm" or document.find("error") is not None:
                raise ValueError("Incomplete OSM response.")
            file.parent.mkdir(parents=True,exist_ok=True)
            file.write_bytes(payload)
            return document
        except (urllib.error.URLError,TimeoutError) as error:
            if attempt==2:
                raise
            pause=3*(attempt+1)
            if isinstance(error,urllib.error.HTTPError) and error.headers.get("Retry-After","").isdigit():
                pause=min(45,int(error.headers["Retry-After"]))
            time.sleep(pause)

def center(geometry):
    return {"lat":(min(p["lat"] for p in geometry)+max(p["lat"] for p in geometry))/2,"lon":(min(p["lon"] for p in geometry)+max(p["lon"] for p in geometry))/2}

for territory in territories:
    output=raw_directory/(territory["key"]+".json")
    if output.exists():
        previous=json.loads(output.read_text(encoding="utf-8"))
        if previous.get("sourceVersion")==2 and previous.get("bounds")==territory["bounds"] and "detailElements" in previous:
            continue
    box=territory["bounds"]
    if (box["north"]-box["south"])*(box["east"]-box["west"])>.01:
        raise ValueError("Use smaller map-pack bounds.")
    bbox=",".join(str(box[name]) for name in ("west","south","east","north"))
    began=time.monotonic()
    document=fetch_document("https://api.openstreetmap.org/api/0.6/map?bbox="+bbox,xml_directory/(territory["key"]+".osm"))
    nodes={node.attrib["id"]:{"lat":float(node.attrib["lat"]),"lon":float(node.attrib["lon"])} for node in document.findall("node")}
    ways={way.attrib["id"]:way for way in document.findall("way")}
    selected_relations=[]
    for relation in document.findall("relation"):
        values=tags(relation)
        if values.get("type")!="multipolygon" or not detail_shape(values):
            continue
        members=[m for m in relation.findall("member") if m.attrib["type"]=="way" and m.attrib.get("role","") in ("","outer","inner")]
        incomplete=any(m.attrib["ref"] not in ways or any(nd.attrib["ref"] not in nodes for nd in ways[m.attrib["ref"]].findall("nd")) for m in members)
        if incomplete:
            relation_id=relation.attrib["id"]
            full=fetch_document("https://api.openstreetmap.org/api/0.6/relation/"+relation_id+"/full",relation_directory/(relation_id+".osm"))
            nodes.update({n.attrib["id"]:{"lat":float(n.attrib["lat"]),"lon":float(n.attrib["lon"])} for n in full.findall("node")})
            ways.update({w.attrib["id"]:w for w in full.findall("way")})
            relation=next((r for r in full.findall("relation") if r.attrib["id"]==relation_id),relation)
        selected_relations.append(relation)

    def geometry(way):
        ids=[nd.attrib["ref"] for nd in way.findall("nd")]
        if len(ids)<2 or any(node not in nodes for node in ids):
            raise ValueError("Incomplete way geometry: "+way.attrib["id"])
        return [nodes[node] for node in ids]

    roads,references,details=[],[],[]
    for node in document.findall("node"):
        values=tags(node)
        point=nodes[node.attrib["id"]]
        if not (box["south"]<=point["lat"]<=box["north"] and box["west"]<=point["lon"]<=box["east"]):
            continue
        element={"type":"node","id":int(node.attrib["id"]),**point,"tags":values}
        if reference_keys.intersection(values):
            references.append(element)
        if values.get("place") in place_kinds:
            details.append(element)
    # relation/full extra ways belong to their relation, not standalone features.
    for way in document.findall("way"):
        values=tags(way)
        road=values.get("highway") in road_kinds or values.get("waterway") in water_kinds
        reference=bool(reference_keys.intersection(values))
        detail=detail_shape(values) or values.get("place") in place_kinds
        if not (road or reference or detail):
            continue
        shape=geometry(way)
        element={"type":"way","id":int(way.attrib["id"]),"tags":values}
        if road:
            roads.append({**element,"geometry":shape})
        if reference:
            references.append({**element,"center":center(shape)})
        if detail:
            details.append({**element,"geometry":shape,"center":center(shape)})
    for relation in selected_relations:
        members=[]
        for member in relation.findall("member"):
            item={"type":member.attrib["type"],"ref":int(member.attrib["ref"]),"role":member.attrib.get("role","")}
            if item["type"]=="way" and item["role"] in ("","outer","inner"):
                if member.attrib["ref"] not in ways:
                    raise ValueError("Missing multipolygon member: "+relation.attrib["id"])
                item["geometry"]=geometry(ways[member.attrib["ref"]])
            members.append(item)
        details.append({"type":"relation","id":int(relation.attrib["id"]),"tags":tags(relation),"members":members})
    record={"sourceVersion":2,"bounds":box,"roadElements":roads,"referenceElements":references,"detailElements":details}
    output.write_text(json.dumps(record,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    print(json.dumps({"key":territory["key"],"name":territory["name"],"roads":len(roads),"references":len(references),"detailElements":len(details),"seconds":round(time.monotonic()-began,2)},ensure_ascii=False),flush=True)
