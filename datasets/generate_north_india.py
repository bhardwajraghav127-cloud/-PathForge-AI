#!/usr/bin/env python3
"""Generate datasets/sample-networks/north-india-sim-v1.json.

SIMULATED DATA — approximate coordinates, haversine x detour distances,
synthetic speeds/tolls. Not real road geometry. See docs/data-provenance.md.
Deterministic: fixed constants, no randomness.
"""
import json
import math
import os

OUT = os.path.join(os.path.dirname(__file__), "sample-networks", "north-india-sim-v1.json")

VERTICES = [
    ("chandigarh", "Chandigarh", 30.73, 76.78),
    ("zirakpur", "Zirakpur", 30.65, 76.82),
    ("panchkula", "Panchkula", 30.69, 76.95),
    ("ambala", "Ambala", 30.38, 76.78),
    ("rajpura", "Rajpura", 30.48, 76.60),
    ("patiala", "Patiala", 30.34, 76.38),
    ("shahabad", "Shahabad", 30.17, 76.87),
    ("kurukshetra", "Kurukshetra", 29.97, 76.93),
    ("karnal", "Karnal", 29.69, 76.98),
    ("gharonda", "Gharonda", 29.55, 77.02),
    ("assandh", "Assandh", 29.51, 76.72),
    ("jind", "Jind", 29.32, 76.32),
    ("panipat", "Panipat", 29.39, 76.97),
    ("samalkha", "Samalkha", 29.23, 77.01),
    ("sonipat", "Sonipat", 28.99, 77.01),
    ("rohtak", "Rohtak", 28.90, 76.61),
    ("bahadurgarh", "Bahadurgarh", 28.68, 76.92),
    ("gurugram", "Gurugram", 28.46, 77.03),
    ("delhi", "Delhi", 28.61, 77.21),
    ("meerut", "Meerut", 28.98, 77.71),
]

# (id, from, to, oneWay, detour, speedKph, tollInr, name)
ROADS = [
    # C1 Eastern express (tolled, fastest)
    ("ex01", "chandigarh", "zirakpur", False, 1.25, 70, 0, "Simulated feeder"),
    ("ex02", "zirakpur", "rajpura", False, 1.30, 95, 60, "Simulated express"),
    ("ex03", "rajpura", "karnal", False, 1.30, 95, 220, "Simulated express"),
    ("ex04", "karnal", "panipat", False, 1.35, 95, 150, "Simulated express"),
    ("ex05", "panipat", "samalkha", False, 1.25, 90, 40, "Simulated express"),
    ("ex06", "samalkha", "sonipat", True, 1.25, 90, 40, "Simulated express carriageway"),
    ("ex06r", "sonipat", "samalkha", True, 1.25, 90, 40, "Simulated express carriageway"),
    ("ex07", "sonipat", "delhi", False, 1.30, 90, 80, "Simulated express"),
    # C2 Grand trunk (free, shorter, slower)
    ("gt01", "chandigarh", "ambala", False, 1.15, 60, 0, "Simulated trunk road"),
    ("gt02", "ambala", "shahabad", False, 1.15, 60, 0, "Simulated trunk road"),
    ("gt03", "shahabad", "kurukshetra", False, 1.15, 60, 0, "Simulated trunk road"),
    ("gt04", "kurukshetra", "karnal", False, 1.15, 55, 0, "Simulated trunk road"),
    ("gt05", "karnal", "gharonda", False, 1.15, 55, 0, "Simulated trunk road"),
    ("gt06", "gharonda", "panipat", False, 1.15, 55, 0, "Simulated trunk road"),
    ("gt07", "panipat", "delhi", False, 1.20, 55, 0, "Simulated trunk road"),
    ("gt09", "sonipat", "delhi", False, 1.20, 55, 0, "Simulated trunk road"),
    ("gt10", "panipat", "samalkha", False, 1.20, 55, 0, "Simulated trunk road"),
    # C3 Western (mixed)
    ("wr01", "chandigarh", "panchkula", False, 1.25, 65, 0, "Simulated highway"),
    ("wr02", "panchkula", "ambala", False, 1.30, 65, 0, "Simulated highway"),
    ("wr03", "zirakpur", "patiala", False, 1.30, 70, 0, "Simulated highway"),
    ("wr04", "patiala", "assandh", False, 1.30, 70, 90, "Simulated highway"),
    ("wr05", "assandh", "rohtak", False, 1.30, 70, 0, "Simulated highway"),
    ("wr06", "rohtak", "bahadurgarh", True, 1.25, 75, 60, "Simulated carriageway"),
    ("wr06r", "bahadurgarh", "rohtak", True, 1.25, 75, 60, "Simulated carriageway"),
    ("wr07", "bahadurgarh", "delhi", False, 1.30, 70, 0, "Simulated highway"),
    ("wr08", "bahadurgarh", "gurugram", False, 1.30, 75, 0, "Simulated highway"),
    ("wr09", "gurugram", "delhi", False, 1.30, 80, 70, "Simulated express"),
    ("wr11", "gurugram", "delhi", False, 1.35, 60, 0, "Simulated highway"),
    ("wr10", "assandh", "jind", False, 1.20, 55, 0, "Simulated rural road"),
    # East + cross links
    ("er01", "delhi", "meerut", False, 1.25, 70, 0, "Simulated highway"),
    ("er02", "delhi", "meerut", False, 1.35, 95, 120, "Simulated express"),
    ("lk01", "ambala", "rajpura", False, 1.20, 60, 0, "Simulated link road"),
    ("lk02", "karnal", "assandh", False, 1.25, 60, 0, "Simulated link road"),
    ("lk03", "panipat", "rohtak", False, 1.30, 60, 0, "Simulated link road"),
    ("lk04", "sonipat", "bahadurgarh", False, 1.25, 60, 0, "Simulated link road"),
    ("lk05", "kurukshetra", "patiala", False, 1.30, 55, 0, "Simulated link road"),
    ("lk06", "shahabad", "patiala", False, 1.30, 55, 0, "Simulated link road"),
    ("lk07", "rohtak", "sonipat", False, 1.25, 60, 0, "Simulated link road"),
    ("lk08", "ambala", "patiala", False, 1.20, 60, 0, "Simulated link road"),
    ("lk09", "patiala", "rajpura", False, 1.20, 60, 0, "Simulated link road"),
    ("lk10", "zirakpur", "ambala", False, 1.25, 65, 0, "Simulated link road"),
    ("lk11", "gharonda", "samalkha", False, 1.20, 55, 0, "Simulated link road"),
]

EARTH_M = 6371000.0


def hav(a, b):
    lat1, lon1 = math.radians(a[2]), math.radians(a[3])
    lat2, lon2 = math.radians(b[2]), math.radians(b[3])
    s = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(
        (lon2 - lon1) / 2
    ) ** 2
    return 2 * EARTH_M * math.asin(min(1.0, math.sqrt(s)))


def main():
    vmap = {v[0]: v for v in VERTICES}
    vertices = [
        {"id": v[0], "name": v[1], "lat": v[2], "lon": v[3]} for v in VERTICES
    ]
    roads = []
    for rid, fr, to, one, detour, speed, toll, name in ROADS:
        h = hav(vmap[fr], vmap[to])
        dist = math.ceil(h * detour)
        secs = math.ceil(dist / (speed * 1000.0 / 3600.0))
        roads.append(
            {
                "id": rid,
                "from": fr,
                "to": to,
                "oneWay": one,
                "distanceM": dist,
                "baselineTimeS": secs,
                "refSpeedKph": speed,
                "tollInr": toll,
                "roadType": "highway" if speed >= 80 else ("arterial" if speed >= 60 else "rural"),
                "name": name,
                "available": True,
            }
        )
    doc = {"schemaVersion": 1, "vertices": vertices, "roads": roads}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(doc, f, indent=1)
        f.write("\n")
    print(f"wrote {OUT}: {len(vertices)} vertices, {len(roads)} roads")


if __name__ == "__main__":
    main()
