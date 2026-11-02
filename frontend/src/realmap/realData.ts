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

export function arcCoords(arcId: string): [number, number][] {
  const [road, dir] = arcId.split(':');
  const g = REAL_GEOMETRY[road ?? '']?.coords ?? [];
  return dir === 'r' ? [...g].reverse() : g;
}

export function joinArcs(arcs: string[]): [number, number][] {
  const out: [number, number][] = [];
  for (const a of arcs) {
    const c = arcCoords(a);
    for (let i = 0; i < c.length; i++) {
      if (out.length > 0 && i === 0) continue;
      const p = c[i];
      if (p) out.push(p);
    }
  }
  return out;
}

const cumCache = new Map<string, { cum: number[]; total: number }>();
function cumLengths(arcId: string): { cum: number[]; total: number } {
  const hit = cumCache.get(arcId);
  if (hit) return hit;
  const c = arcCoords(arcId);
  const cum = [0];
  let total = 0;
  for (let i = 1; i < c.length; i++) {
    const a = c[i - 1]!;
    const b = c[i]!;
    const dLat = (b[1] - a[1]) * 111320;
    const dLon = (b[0] - a[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180);
    total += Math.hypot(dLat, dLon);
    cum.push(total);
  }
  const v = { cum, total };
  cumCache.set(arcId, v);
  return v;
}

// True position along edge geometry at permille fraction (not endpoint lerp).
export function pointAt(arcId: string, fracPermille: number): [number, number] | null {
  const c = arcCoords(arcId);
  if (c.length === 0) return null;
  if (c.length === 1) return c[0]!;
  const { cum, total } = cumLengths(arcId);
  if (total <= 0) return c[0]!;
  const target = (Math.min(1000, Math.max(0, fracPermille)) / 1000) * total;
  let i = 1;
  while (i < cum.length - 1 && (cum[i] ?? 0) < target) i++;
  const c0 = cum[i - 1] ?? 0;
  const c1 = cum[i] ?? 0;
  const f = c1 > c0 ? (target - c0) / (c1 - c0) : 0;
  const a = c[i - 1]!;
  const b = c[i]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

let roadBoxes: { id: string; minLon: number; minLat: number; maxLon: number; maxLat: number }[] | null = null;
function boxes() {
  if (!roadBoxes) {
    roadBoxes = REAL_ROADS.map((r) => {
      const c = REAL_GEOMETRY[r.id]?.coords ?? [];
      let minLon = 1e9;
      let minLat = 1e9;
      let maxLon = -1e9;
      let maxLat = -1e9;
      for (const p of c) {
        if (p[0] < minLon) minLon = p[0];
        if (p[0] > maxLon) maxLon = p[0];
        if (p[1] < minLat) minLat = p[1];
        if (p[1] > maxLat) maxLat = p[1];
      }
      return { id: r.id, minLon, minLat, maxLon, maxLat };
    });
  }
  return roadBoxes;
}

// Nearest road to a click (bbox prefilter + point-segment, metres).
export function nearestRoad(lng: number, lat: number, maxMeters = 100): { roadId: string; distM: number } | null {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 111320;
  const padLon = maxMeters / kx;
  const padLat = maxMeters / ky;
  let best: { roadId: string; distM: number } | null = null;
  for (const b of boxes()) {
    if (lng < b.minLon - padLon || lng > b.maxLon + padLon || lat < b.minLat - padLat || lat > b.maxLat + padLat) continue;
    const c = REAL_GEOMETRY[b.id]?.coords ?? [];
    for (let i = 1; i < c.length; i++) {
      const a = c[i - 1]!;
      const d = c[i]!;
      const ax = (a[0] - lng) * kx;
      const ay = (a[1] - lat) * ky;
      const bx = (d[0] - lng) * kx;
      const by = (d[1] - lat) * ky;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      const dist = Math.hypot(ax + t * dx, ay + t * dy);
      if (dist <= maxMeters && (!best || dist < best.distM)) {
        best = { roadId: b.id, distM: Math.round(dist) };
      }
    }
  }
  return best;
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
