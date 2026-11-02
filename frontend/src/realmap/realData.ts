// Real Delhi data access (R2): pipeline outputs as typed structures +
// GeoJSON builders for MapLibre. Geometry is keyed by engine road id so
// routes render along true OSM polylines.
import networkData from '../data/real-delhi-network.json';
import geometryData from '../data/real-delhi-geometry.json';
import placesData from '../data/real-delhi-places.json';
import type { FeatureSet, LineFeature, MapLabel } from '../realmap/RealMap';

export interface RealVertex {
  id: string;
  lat: number;
  lon: number;
}
export interface RealRoad {
  id: string;
  from: string;
  to: string;
  oneWay: boolean;
  distanceM: number;
  baselineTimeS: number;
  refSpeedKph: number;
  tollInr: number;
  roadType: string;
  name: string;
  available: boolean;
}
export interface RealPlace {
  id: string;
  name: string;
  lat: number;
  lon: number;
  kind: string;
}
export interface RealGeometry {
  coords: [number, number][];
  osmWay: number;
  roadClass: string;
  oneWay: boolean;
}

export const REAL_VERTICES = (networkData as { vertices: RealVertex[] }).vertices;
export const REAL_ROADS = (networkData as { roads: RealRoad[] }).roads;
export const REAL_GEOMETRY = geometryData as unknown as Record<string, RealGeometry>;
export const REAL_PLACES = (placesData as RealPlace[]).slice().sort((a, b) => a.name.localeCompare(b.name));

export const REAL_BOUNDS: [[number, number], [number, number]] = [
  [77.2, 28.6],
  [77.25, 28.65],
];
export const REAL_CENTER: [number, number] = [77.225, 28.625];

export function realNetworkPayload(): { vertices: RealVertex[]; roads: RealRoad[] } {
  return { vertices: REAL_VERTICES, roads: REAL_ROADS };
}

let roadsCache: FeatureSet | null = null;
export function realRoadsGeo(): FeatureSet {
  if (!roadsCache) {
    const features: LineFeature[] = REAL_ROADS.map((r) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: REAL_GEOMETRY[r.id]?.coords ?? [] },
      properties: { class: r.roadType, name: r.name },
    }));
    roadsCache = { type: 'FeatureCollection', features };
  }
  return roadsCache;
}

const MAJOR_CLASSES = new Set([
  'motorway', 'trunk', 'primary', 'secondary',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link',
]);

let labelsCache: MapLabel[] | null = null;
export function realLabels(): MapLabel[] {
  if (!labelsCache) {
    const out: MapLabel[] = REAL_PLACES
      .filter((p) => p.kind !== 'road')
      .map((p) => ({ lng: p.lon, lat: p.lat, text: p.name, kind: 'place' as const }));
    // Longest 60 named major roads (dedup by name) for zoomed-in labels.
    const seen = new Set<string>();
    const majors = REAL_ROADS
      .filter((r) => r.name && MAJOR_CLASSES.has(r.roadType))
      .sort((a, b) => b.distanceM - a.distanceM);
    for (const r of majors) {
      if (seen.has(r.name) || out.length >= 85) continue;
      seen.add(r.name);
      const g = REAL_GEOMETRY[r.id]?.coords ?? [];
      const mid = g[Math.floor(g.length / 2)];
      if (mid) out.push({ lng: mid[0] ?? 0, lat: mid[1] ?? 0, text: r.name, kind: 'road' });
    }
    labelsCache = out;
  }
  return labelsCache;
}

export function nearestVertex(lat: number, lon: number, maxMeters = 500): RealVertex | null {
  let best: RealVertex | null = null;
  let bestD = maxMeters;
  for (const v of REAL_VERTICES) {
    const dLat = (v.lat - lat) * 111320;
    const dLon = (v.lon - lon) * 111320 * Math.cos((lat * Math.PI) / 180);
    const d = Math.hypot(dLat, dLon);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}
