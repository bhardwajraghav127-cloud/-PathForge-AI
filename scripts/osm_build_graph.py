#!/usr/bin/env python3
"""Build PathForge real-road graph from a BBBike OSM extract (R2).

Usage:
    python3 scripts/osm_build_graph.py /tmp/NewDelhi.osm.gz \
        --bbox 28.58,77.18,28.68,77.28 --out frontend/src/data/real-delhi

Stdlib only. Deterministic: sorted inputs, stable IDs, no timestamps in
outputs (provenance lives in docs/REAL_DELHI_PROVENANCE.md).

Outputs (prefix + suffix):
    -network.json    engine-format directed graph
    -geometry.json   roadId -> polyline + OSM metadata (render sidecar)
    -places.json     local gazetteer (place nodes + major road names)
    -report.json     validation report (counts, connectivity, dropped)

Graph model: vertices = intersections (nodes shared by 2+ kept ways, or way
endpoints); edges = chain-merged runs between vertices. distanceM = summed
haversine along geometry (>= straight-line by construction, keeping A*
admissible). baselineTimeS = distance / class assumed speed (documented
assumptions, NOT measured traffic).

Limits (disclosed): OSM relations (turn restrictions) ignored; oneway from
tags + motorway/roundabout implications; maxspeed tags ignored in favor of
class assumptions; bbox clips ways at the boundary (dangling ends kept only
if they connect inside).
"""
import argparse
import gzip
import json
import math
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict

DRIVABLE = {
    "motorway": 80, "trunk": 70, "primary": 60, "secondary": 50,
    "tertiary": 40, "residential": 30, "unclassified": 30, "service": 20,
    "living_street": 15, "motorway_link": 60, "trunk_link": 50,
    "primary_link": 40, "secondary_link": 35, "tertiary_link": 30,
    "road": 25,
}
# Non-drivable for cars but kept OUT entirely (footway/path/cycleway/steps...).
EARTH_R = 6371000.0


def haversine(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(a))


def parse_args(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("input", help=".osm.gz extract path")
    ap.add_argument("--bbox", required=True, help="latMin,lonMin,latMax,lonMax")
    ap.add_argument("--out", required=True, help="output prefix")
    return ap.parse_args(argv)


def main(argv):
    args = parse_args(argv)
    lat_min, lon_min, lat_max, lon_max = (float(x) for x in args.bbox.split(","))
    inside = lambda lat, lon: lat_min <= lat <= lat_max and lon_min <= lon <= lon_max  # noqa: E731

    nodes = {}   # id -> (lat, lon, tags)
    ways = []    # (id, [nd refs], tags)
    with gzip.open(args.input, "rb") as f:
        ctx = ET.iterparse(f, events=("end",))
        for _, el in ctx:
            if el.tag == "node":
                nid = int(el.get("id"))
                lat, lon = float(el.get("lat")), float(el.get("lon"))
                tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
                if inside(lat, lon):
                    nodes[nid] = (lat, lon, tags)
                el.clear()
            elif el.tag == "way":
                wid = int(el.get("id"))
                nds = [int(n.get("ref")) for n in el.findall("nd")]
                tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
                hw = tags.get("highway")
                if hw in DRIVABLE:
                    ways.append((wid, nds, tags))
                el.clear()
            elif el.tag == "relation":
                el.clear()

    # Keep ways with >= 2 nodes inside bbox; clip node runs to inside nodes
    # (segments touching outside are dropped; boundary stubs stay only when
    # they connect two inside intersections).
    kept = []
    for wid, nds, tags in ways:
        seq = [n for n in nds if n in nodes]
        if len(seq) >= 2:
            kept.append((wid, seq, tags))

    # Intersection vertices: nodes referenced by 2+ kept ways, or way endpoints.
    use_count = defaultdict(int)
    endpoints = set()
    for _, seq, _ in kept:
        for n in seq:
            use_count[n] += 1
        endpoints.add(seq[0])
        endpoints.add(seq[-1])
    is_vertex = {n for n, c in use_count.items() if c >= 2} | endpoints

    # Chain-merge runs between vertices into edges with geometry.
    edges = []  # (from, to, [(lat,lon)...], tags, wid)
    for wid, seq, tags in kept:
        cuts = [0]
        for i in range(1, len(seq) - 1):
            if seq[i] in is_vertex:
                cuts.append(i)
        cuts.append(len(seq) - 1)
        for a, b in zip(cuts, cuts[1:]):
            if b <= a:
                continue
            run = seq[a:b + 1]
            geom = [(nodes[n][0], nodes[n][1]) for n in run]
            edges.append((run[0], run[-1], geom, tags, wid))

    def oneway_of(tags):
        ow = (tags.get("oneway") or "").lower()
        if ow in ("yes", "true", "1"):
            return 1
        if ow == "-1":
            return -1
        if tags.get("junction") == "roundabout":
            return 1
        if tags.get("highway") == "motorway" and ow != "no":
            return 1
        return 0

    # Weak connectivity over vertices; keep largest component.
    adj = defaultdict(set)
    for u, v, _, _, _ in edges:
        adj[u].add(v)
        adj[v].add(u)
    seen = set()
    best = set()
    for start in sorted(adj):
        if start in seen:
            continue
        comp, stack = set(), [start]
        while stack:
            n = stack.pop()
            if n in comp:
                continue
            comp.add(n)
            stack.extend(adj[n] - comp)
        seen |= comp
        if len(comp) > len(best):
            best = comp
    edges = [e for e in edges if e[0] in best and e[1] in best]
    verts = sorted(best)

    # Stable IDs + engine payload.
    vid = {n: f"n{n}" for n in verts}
    net_vertices = [
        {"id": vid[n], "lat": nodes[n][0], "lon": nodes[n][1]} for n in verts
    ]
    net_roads, geometry = [], {}
    # Drop roundabout stubs that start and end at the same vertex: a v→v
    # loop can never improve a route and only confuses snapping/rendering.
    edges = [e for e in edges if e[0] != e[1]]
    order = sorted(range(len(edges)), key=lambda i: (edges[i][0], edges[i][1], edges[i][4]))
    for k, i in enumerate(order):
        u, v, geom, tags, wid = edges[i]
        dist = sum(haversine(*geom[j], *geom[j + 1]) for j in range(len(geom) - 1))
        dist_m = max(1, int(round(dist)))
        hw = tags.get("highway", "road")
        speed = DRIVABLE.get(hw, 25)
        base_s = max(1, int(round(dist_m / (speed * 1000.0 / 3600.0))))
        ow = oneway_of(tags)
        rid = f"r{k:05d}"
        if ow == -1:
            frm, to, g = vid[v], vid[u], list(reversed(geom))
            one_way = True
        else:
            frm, to, g = vid[u], vid[v], geom
            one_way = ow == 1
        net_roads.append({
            "id": rid, "from": frm, "to": to, "oneWay": one_way,
            "distanceM": dist_m, "baselineTimeS": base_s,
            "refSpeedKph": speed, "tollInr": 0, "roadType": hw,
            "name": tags.get("name", ""), "available": True,
        })
        geometry[rid] = {
            "coords": [[round(lon, 6), round(lat, 6)] for lat, lon in g],
            "osmWay": wid, "roadClass": hw, "oneWay": one_way,
        }

    # Gazetteer: place nodes + named-road representative points (dedup by name).
    places = []
    for nid in sorted(nodes):
        lat, lon, tags = nodes[nid]
        if "place" in tags and "name" in tags:
            places.append({"id": f"p{nid}", "name": tags["name"],
                           "lat": lat, "lon": lon, "kind": tags["place"]})
    seen_names = set()
    for r in net_roads:
        name = r["name"]
        if name and name not in seen_names:
            seen_names.add(name)
            g = geometry[r["id"]]["coords"]
            mid = g[len(g) // 2]
            places.append({"id": f"pr-{r['id']}", "name": name,
                           "lat": mid[1], "lon": mid[0], "kind": "road"})

    network = {"vertices": net_vertices, "roads": net_roads}
    with open(args.out + "-network.json", "w") as f:
        json.dump(network, f, separators=(",", ":"))
    with open(args.out + "-geometry.json", "w") as f:
        json.dump(geometry, f, separators=(",", ":"))
    with open(args.out + "-places.json", "w") as f:
        json.dump(sorted(places, key=lambda p: p["name"]), f, separators=(",", ":"))

    one_way_n = sum(1 for r in net_roads if r["oneWay"])
    report = {
        "bbox": [lat_min, lon_min, lat_max, lon_max],
        "nodesInBbox": len(nodes),
        "waysKept": len(kept),
        "vertices": len(net_vertices),
        "roads": len(net_roads),
        "oneWayRoads": one_way_n,
        "places": len(places),
        "totalKm": round(sum(r["distanceM"] for r in net_roads) / 1000.0, 1),
    }
    with open(args.out + "-report.json", "w") as f:
        json.dump(report, f, indent=2)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main(sys.argv[1:])
