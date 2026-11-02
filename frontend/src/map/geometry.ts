// Map geometry (U2): deterministic layouts for both map views.
// Geographic-schematic preserves bearings/distances (equirectangular +
// latitude correction, normalized to a 1000-unit box). Network-exploration
// is a deterministic spread layout (BFS-depth concentric circles + fixed
// relaxation) — non-geographic, always labeled SCHEMATIC in the UI.
import type { Dataset } from '../data/dataset';

export interface Pt { x: number; y: number }

export function projectGeo(lat: number, lon: number, minLon: number, minLat: number, lat0: number): Pt {
  const kx = Math.cos((lat0 * Math.PI) / 180);
  return { x: (lon - minLon) * kx * 10000, y: (lat - minLat) * -10000 };
}

export function normalize(pts: Pt[]): Pt[] {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1e-9);
  const k = 1000 / span;
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return pts.map((p) => ({ x: (p.x - minX) * k, y: (p.y - minY) * k }));
}

/** Deterministic spread: BFS rings from the highest-degree vertex. */
export function layoutExplore(net: Dataset): Pt[] {
  const n = net.vertices.length;
  const idx = new Map(net.vertices.map((v, i) => [v.id, i]));
  const adj: number[][] = net.vertices.map(() => []);
  for (const r of net.roads) {
    const a = idx.get(r.from);
    const b = idx.get(r.to);
    if (a === undefined || b === undefined) continue;
    adj[a]?.push(b);
    adj[b]?.push(a);
  }
  let root = 0;
  for (let i = 1; i < n; i++) {
    if ((adj[i]?.length ?? 0) > (adj[root]?.length ?? 0)) root = i;
  }
  const depth = new Array<number>(n).fill(-1);
  depth[root] = 0;
  const queue = [root];
  while (queue.length > 0) {
    const u = queue.shift() as number;
    for (const v of adj[u] ?? []) {
      if (depth[v] === -1) {
        depth[v] = (depth[u] as number) + 1;
        queue.push(v);
      }
    }
  }
  const rings = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const d = depth[i] as number;
    const ring = rings.get(d) ?? [];
    ring.push(i);
    rings.set(d, ring);
  }
  for (const ring of rings.values()) ring.sort((a, b) => a - b);
  const maxD = Math.max(...rings.keys());
  const pts: Pt[] = new Array(n);
  const R = n <= 1 ? 0 : 500;
  for (const [d, ring] of rings) {
    const radius = maxD === 0 ? 0 : (R * d) / maxD;
    for (let k = 0; k < ring.length; k++) {
      const i = ring[k] as number;
      if (radius === 0) {
        pts[i] = { x: 500, y: 500 };
      } else {
        const ang = (2 * Math.PI * k) / ring.length - Math.PI / 2 + d * 0.35;
        pts[i] = { x: 500 + radius * Math.cos(ang), y: 500 + radius * Math.sin(ang) };
      }
    }
  }
  // Deterministic overlap relaxation: fixed order, fixed iterations.
  for (let iter = 0; iter < 60; iter++) {
    for (let i = 0; i < n; i++) {
      let fx = 0;
      let fy = 0;
      const pi = pts[i] as Pt;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const pj = pts[j] as Pt;
        const dx = pi.x - pj.x;
        const dy = pi.y - pj.y;
        const dist = Math.hypot(dx, dy) || 1e-6;
        const want = 130;
        if (dist < want) {
          const f = ((want - dist) / want) * 12;
          fx += (dx / dist) * f;
          fy += (dy / dist) * f;
        }
      }
      pi.x += fx;
      pi.y += fy;
    }
  }
  return normalize(pts);
}

/** Rotate positions around the centroid by quarter turns (0-3). */
export function rotatePositions(pts: Pt[], quarterTurns: number): Pt[] {
  const q = ((quarterTurns % 4) + 4) % 4;
  if (q === 0) return pts;
  const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  return pts.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    if (q === 1) return { x: cx - dy, y: cy + dx };
    if (q === 2) return { x: cx - dx, y: cy - dy };
    return { x: cx + dy, y: cy - dx };
  });
}

export function layoutNetwork(net: Dataset, view: 'geo' | 'explore', rotation: number): Pt[] {
  let pts: Pt[];
  if (view === 'geo') {
    const lats = net.vertices.map((v) => v.lat);
    const lons = net.vertices.map((v) => v.lon);
    const minLat = Math.min(...lats);
    const minLon = Math.min(...lons);
    const lat0 = lats.reduce((a, b) => a + b, 0) / lats.length;
    pts = normalize(net.vertices.map((v) => projectGeo(v.lat, v.lon, minLon, minLat, lat0)));
  } else {
    pts = layoutExplore(net);
  }
  return rotatePositions(pts, rotation);
}
