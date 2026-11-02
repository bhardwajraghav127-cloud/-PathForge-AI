// Cytoscape map: renders vertices/roads and highlights engine-returned arcs.
// Equirectangular projection with latitude correction; bezier separation for
// parallel edges. No routing math here — highlight classes come from props.
import { useEffect, useRef } from 'react';
import cytoscape, { type Core } from 'cytoscape';
import { DATASET, type Dataset } from '../data/dataset';
import { useSettings } from '../store';

declare global {
  interface Window {
    __PF_DEBUG__?: { cy: Core | null };
  }
}

function project(lat: number, lon: number, minLon: number, minLat: number, lat0: number) {
  // Equirectangular with latitude correction; y grows downward on screen.
  const kx = Math.cos((lat0 * Math.PI) / 180);
  return { x: (lon - minLon) * kx * 10000, y: (lat - minLat) * -10000 };
}

export default function MapView({
  routeArcIds, visitedIds, currentId, cyOut, network,
}: {
  routeArcIds: string[];
  visitedIds?: string[];
  currentId?: string | null;
  cyOut?: React.MutableRefObject<Core | null>;
  network?: Dataset;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const net = network ?? DATASET;
  const theme = useSettings((s) => s.theme);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Canvas fills cannot resolve CSS var(); read the resolved tokens once.
    const cs = getComputedStyle(el);
    const col = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
    const nodeCol = col('--pf-map-node', '#33413b');
    const edgeCol = col('--pf-map-edge', '#9aa5a0');
    const routeCol = col('--pf-route', '#0b5fff');
    const inkCol = col('--pf-ink', '#1c2420');
    const accentCol = col('--pf-accent', '#0f6b4a');
    const lats = net.vertices.map((v) => v.lat);
    const lons = net.vertices.map((v) => v.lon);
    const minLat = Math.min(...lats);
    const minLon = Math.min(...lons);
    const lat0 = lats.reduce((a, b) => a + b, 0) / lats.length;
    const raw = net.vertices.map((v) => project(v.lat, v.lon, minLon, minLat, lat0));
    const xs = raw.map((p) => p.x);
    const ys = raw.map((p) => p.y);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1e-9);
    const k = 1000 / span;
    const nodes = net.vertices.map((v, i) => {
      const p = raw[i] as { x: number; y: number };
      return { data: { id: v.id, label: v.name ?? v.id }, position: { x: p.x * k, y: p.y * k } };
    });
    const edges = net.roads.flatMap((r) => {
      const out = [{ data: { id: `${r.id}:f`, source: r.from, target: r.to, roadId: r.id } }];
      if (!r.oneWay) out.push({ data: { id: `${r.id}:r`, source: r.to, target: r.from, roadId: r.id } });
      return out;
    });
    const cy = cytoscape({
      container: el,
      elements: [...nodes, ...edges],
      layout: { name: 'preset' },
      minZoom: 0.01,
      maxZoom: 6,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': nodeCol,
            label: 'data(label)',
            color: inkCol,
            'font-size': 11,
            width: 14,
            height: 14,
          },
        },
        {
          selector: 'edge',
          style: {
            'line-color': edgeCol,
            'target-arrow-color': edgeCol,
            'target-arrow-shape': 'triangle',
            width: 2,
            'curve-style': 'bezier',
            'control-point-step-size': 24,
          },
        },
        {
          selector: 'edge.route',
          style: {
            'line-color': routeCol,
            'target-arrow-color': routeCol,
            width: 5,
          },
        },
        {
          selector: 'node.visited',
          style: {
            'background-color': accentCol,
          },
        },
        {
          selector: 'node.current',
          style: {
            'background-color': routeCol,
            width: 22,
            height: 22,
          },
        },
      ],
    });
    cyRef.current = cy;
    if (cyOut) cyOut.current = cy;
    window.__PF_DEBUG__ = { cy };
    cy.fit(undefined, 30);
    return () => {
      window.__PF_DEBUG__ = { cy: null };
      if (cyOut) cyOut.current = null;
      cy.destroy();
      cyRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net, theme]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.edges().removeClass('route');
    for (const id of routeArcIds) cy.getElementById(id).addClass('route');
    cy.nodes().removeClass('visited current');
    for (const id of visitedIds ?? []) cy.getElementById(id).addClass('visited');
    if (currentId) cy.getElementById(currentId).addClass('current');
  }, [routeArcIds, visitedIds, currentId]);

  return <div ref={ref} className="pf-map" data-testid="map" role="application" aria-label="Road network map" />;
}
