// Cytoscape map: renders vertices/roads and highlights engine-returned arcs.
// Equirectangular projection with latitude correction; bezier separation for
// parallel edges. No routing math here — highlight classes come from props.
import { useEffect, useRef } from 'react';
import cytoscape, { type Core } from 'cytoscape';
import { DATASET, type Dataset } from '../data/dataset';

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

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const lats = net.vertices.map((v) => v.lat);
    const lons = net.vertices.map((v) => v.lon);
    const minLat = Math.min(...lats);
    const minLon = Math.min(...lons);
    const lat0 = lats.reduce((a, b) => a + b, 0) / lats.length;
    const nodes = net.vertices.map((v) => {
      const p = project(v.lat, v.lon, minLon, minLat, lat0);
      return { data: { id: v.id, label: v.name ?? v.id }, position: p };
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
      minZoom: 0.2,
      maxZoom: 4,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'var(--pf-map-node)',
            label: 'data(label)',
            color: 'var(--pf-ink)',
            'font-size': 11,
            width: 14,
            height: 14,
          },
        },
        {
          selector: 'edge',
          style: {
            'line-color': 'var(--pf-map-edge)',
            'target-arrow-color': 'var(--pf-map-edge)',
            'target-arrow-shape': 'triangle',
            width: 2,
            'curve-style': 'bezier',
            'control-point-step-size': 24,
          },
        },
        {
          selector: 'edge.route',
          style: {
            'line-color': 'var(--pf-route)',
            'target-arrow-color': 'var(--pf-route)',
            width: 5,
          },
        },
        {
          selector: 'node.visited',
          style: {
            'background-color': 'var(--pf-accent)',
          },
        },
        {
          selector: 'node.current',
          style: {
            'background-color': 'var(--pf-route)',
            width: 22,
            height: 22,
          },
        },
      ],
    });
    cyRef.current = cy;
    if (cyOut) cyOut.current = cy;
    window.__PF_DEBUG__ = { cy };
    return () => {
      window.__PF_DEBUG__ = { cy: null };
      if (cyOut) cyOut.current = null;
      cy.destroy();
      cyRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net]);

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
