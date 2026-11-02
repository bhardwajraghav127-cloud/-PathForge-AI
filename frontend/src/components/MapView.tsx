// Cytoscape map (U2): two deterministic views, map controls, search,
// city/road inspectors, traffic edge states, collision-aware labels.
// The cy instance is reused across data updates and recreated only on
// network/view/theme/rotation change. No routing math here — classes and
// inspector facts come from props and the traffic store.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import cytoscape, { type Core } from 'cytoscape';
import { DATASET, type Dataset, formatMetres, formatSeconds, formatInr } from '../data/dataset';
import { useSettings } from '../store';
import { useTraffic } from '../traffic';
import { layoutNetwork } from '../map/geometry';

declare global {
  interface Window {
    __PF_DEBUG__?: { cy: Core | null };
  }
}

export type MapViewMode = 'geo' | 'explore';

export interface MapViewProps {
  routeArcIds: string[];
  altArcIds?: string[];
  visitedIds?: string[];
  frontierIds?: string[];
  currentId?: string | null;
  originId?: string | null;
  destId?: string | null;
  stopIds?: string[];
  stopOrder?: string[];
  cyOut?: React.MutableRefObject<Core | null>;
  network?: Dataset;
  onSetOrigin?: (id: string) => void;
  onSetDestination?: (id: string) => void;
  statsExtra?: string;
  defaultView?: MapViewMode;
}

function roadEnds(net: Dataset, vertexId: string) {
  return net.roads.filter((r) => r.from === vertexId || r.to === vertexId);
}

export default function MapView(props: MapViewProps) {
  const {
    routeArcIds, altArcIds, visitedIds, frontierIds, currentId, originId, destId, stopIds, stopOrder,
    cyOut, network, onSetOrigin, onSetDestination, statsExtra, defaultView,
  } = props;
  const ref = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const net = network ?? DATASET;
  const theme = useSettings((s) => s.theme);
  const closures = useTraffic((s) => s.closures);
  const incidents = useTraffic((s) => s.incidents);
  const factors = useTraffic((s) => s.factors);
  const [view, setView] = useState<MapViewMode>(defaultView ?? 'geo');
  const [rotation, setRotation] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [inspectNode, setInspectNode] = useState<string | null>(null);
  const [inspectEdge, setInspectEdge] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showKeys, setShowKeys] = useState(false);
  const [chips, setChips] = useState<{ id: string; n: number; x: number; y: number }[]>([]);

  const applyClasses = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.edges().removeClass('route alt closed congested search-hit');
      for (const id of routeArcIds) cy.getElementById(id).addClass('route');
      const routeSet = new Set(routeArcIds);
      for (const id of altArcIds ?? []) {
        if (!routeSet.has(id)) cy.getElementById(id).addClass('alt');
      }
      cy.nodes().removeClass('visited frontier current origin dest stop');
      for (const id of visitedIds ?? []) cy.getElementById(id).addClass('visited');
      for (const id of frontierIds ?? []) cy.getElementById(id).addClass('frontier');
      if (currentId) cy.getElementById(currentId).addClass('current');
      if (originId) cy.getElementById(originId).addClass('origin');
      if (destId) cy.getElementById(destId).addClass('dest');
      for (const id of stopIds ?? []) cy.getElementById(id).addClass('stop');
    });
  }, [routeArcIds, altArcIds, visitedIds, frontierIds, currentId, originId, destId, stopIds]);

  const applyTraffic = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const closedRoads = new Set(closures);
    for (const r of net.roads) if (r.available === false) closedRoads.add(r.id);
    const congestedRoads = new Set<string>();
    for (const [road, permille] of Object.entries(factors)) {
      if (permille < 1000 && !closedRoads.has(road)) congestedRoads.add(road);
    }
    for (const i of incidents) {
      if (!closedRoads.has(i.road)) congestedRoads.add(i.road);
    }
    cy.batch(() => {
      for (const r of net.roads) {
        const sel = cy.filter(`edge[roadId = "${r.id}"]`);
        if (closedRoads.has(r.id)) sel.addClass('closed');
        else if (congestedRoads.has(r.id)) sel.addClass('congested');
      }
    });
  }, [closures, incidents, factors, net]);

  // Greedy label collision: keep priority nodes (route/visited/current),
  // then by degree; hide the rest until zoom changes.
  const declutter = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const zoom = cy.zoom();
    const priority = new Set<string>();
    cy.$('.route').connectedNodes().forEach((n) => { priority.add(n.id()); });
    cy.$('.visited,.current,.origin,.dest,.stop').forEach((n) => { priority.add(n.id()); });
    const nodes = cy.nodes().sort((a, b) => {
      const pa = priority.has(a.id()) ? 0 : 1;
      const pb = priority.has(b.id()) ? 0 : 1;
      return pa - pb || b.degree(false) - a.degree(false);
    });
    const kept: { x0: number; x1: number; y0: number; y1: number }[] = [];
    cy.batch(() => {
      nodes.forEach((n) => {
        const label = String(n.data('label') ?? '');
        const p = n.renderedPosition();
        const w = (label.length * 7 + 24) * Math.min(zoom, 1.4);
        const h = 26 * Math.min(zoom, 1.4);
        const box = { x0: p.x - w / 2, x1: p.x + w / 2, y0: p.y - h / 2 - 10, y1: p.y + h / 2 - 10 };
        const clash = kept.some(
          (k) => box.x0 < k.x1 && box.x1 > k.x0 && box.y0 < k.y1 && box.y1 > k.y0,
        );
        if (clash && !priority.has(n.id()) && zoom < 1.2) {
          n.style('label', '');
        } else {
          n.style('label', label);
          kept.push(box);
        }
      });
    });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const col = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
    const nodeCol = col('--pf-map-node', '#33413b');
    const edgeCol = col('--pf-map-edge', '#8d9792');
    const routeCol = col('--pf-route', '#0b5fff');
    const inkCol = col('--pf-map-label', '#1a2320');
    const accentCol = col('--pf-accent', '#0f6b4a');
    const altCol = col('--pf-alt', '#b3540a');
    const closedCol = col('--pf-closed', '#7a1f1a');
    const jamCol = col('--pf-warn-ink', '#5c4a00');
    const paper = col('--pf-paper', '#ffffff');
    const positions = layoutNetwork(net, view, rotation);
    const nodes = net.vertices.map((v, i) => {
      const p = positions[i] ?? { x: 0, y: 0 };
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
      minZoom: 0.01,
      maxZoom: 6,
      wheelSensitivity: 0.35,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': nodeCol,
            label: 'data(label)',
            color: inkCol,
            'font-size': 15,
            'text-outline-color': paper,
            'text-outline-width': 4,
            'text-valign': 'bottom',
            'text-margin-y': 5,
            width: 20,
            height: 20,
          },
        },
        {
          selector: 'edge',
          style: {
            'line-color': edgeCol,
            'target-arrow-color': edgeCol,
            'target-arrow-shape': 'triangle',
            'arrow-scale': 1.4,
            width: 3,
            'curve-style': 'bezier',
            'control-point-step-size': 28,
          },
        },
        {
          selector: 'edge.alt',
          style: { 'line-color': altCol, 'target-arrow-color': altCol, width: 5, 'line-style': 'dashed' },
        },
        { selector: 'edge.route', style: { 'line-color': routeCol, 'target-arrow-color': routeCol, width: 7 } },
        {
          selector: 'edge.closed',
          style: { 'line-color': closedCol, 'target-arrow-color': closedCol, width: 7, 'line-style': 'dashed' },
        },
        {
          selector: 'edge.congested',
          style: { 'line-color': jamCol, 'target-arrow-color': jamCol, width: 5, 'line-style': 'dotted' },
        },
        { selector: 'node.visited', style: { 'background-color': accentCol } },
        {
          selector: 'node.frontier',
          style: { 'border-width': 4, 'border-color': altCol, width: 24, height: 24 },
        },
        { selector: 'node.current', style: { 'background-color': routeCol, width: 28, height: 28 } },
        { selector: 'node.origin', style: { 'border-width': 5, 'border-color': accentCol, width: 26, height: 26 } },
        { selector: 'node.dest', style: { 'border-width': 5, 'border-color': routeCol, width: 26, height: 26 } },
        { selector: 'node.stop', style: { 'border-width': 4, 'border-color': altCol, width: 24, height: 24 } },
        { selector: '.search-hit', style: { 'border-width': 6, 'border-color': routeCol } },
        { selector: 'edge.search-hit', style: { width: 8 } },
      ],
    });
    cyRef.current = cy;
    if (cyOut) cyOut.current = cy;
    window.__PF_DEBUG__ = { cy };
    cy.fit(undefined, 60);
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => declutterRef.current(), 160);
    };
    cy.on('zoom pan', schedule);
    cy.on('pan zoom', () => chipsRef.current());
    cy.on('tap', (e) => {
      const t = e.target;
      if (t === cy) {
        setInspectNode(null);
        setInspectEdge(null);
      } else if (t.isNode()) {
        setInspectNode(t.id());
        setInspectEdge(null);
      } else if (t.isEdge()) {
        setInspectEdge(String(t.data('roadId') ?? ''));
        setInspectNode(null);
      }
    });
    declutterRef.current();
    const ro = new ResizeObserver(() => {
      cy.resize();
      schedule();
    });
    ro.observe(el);
    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
      window.__PF_DEBUG__ = { cy: null };
      if (cyOut) cyOut.current = null;
      cy.destroy();
      cyRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net, theme, view, rotation]);

  const declutterRef = useRef(declutter);
  declutterRef.current = declutter;

  const updateChips = useCallback(() => {
    const cy = cyRef.current;
    const order = stopOrder ?? [];
    if (!cy || order.length === 0) {
      setChips([]);
      return;
    }
    const next: { id: string; n: number; x: number; y: number }[] = [];
    order.forEach((id, n) => {
      const node = cy.getElementById(id);
      if (node.length === 0) return;
      const p = node.renderedPosition();
      next.push({ id, n: n + 1, x: p.x, y: p.y - 24 });
    });
    setChips(next);
  }, [stopOrder]);
  const chipsRef = useRef(updateChips);
  chipsRef.current = updateChips;

  useEffect(() => {
    updateChips();
  }, [updateChips, routeArcIds]);

  useEffect(() => {
    applyClasses();
    applyTraffic();
    declutterRef.current();
  }, [applyClasses, applyTraffic]);

  useEffect(() => {
    if (!expanded) return;
    const frame = requestAnimationFrame(() => {
      cyRef.current?.resize();
    });
    return () => cancelAnimationFrame(frame);
  }, [expanded ]);

  const zoomBy = (factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    const el = ref.current;
    const cx = (el?.clientWidth ?? 600) / 2;
    const h = (el?.clientHeight ?? 600) / 2;
    cy.zoom({ level: cy.zoom() * factor, renderedPosition: { x: cx, y: h } });
  };
  const fitAll = () => cyRef.current?.fit(undefined, 60);
  const centerRoute = () => {
    const cy = cyRef.current;
    if (!cy) return;
    const sel = cy.$('.route');
    if (sel.length > 0) cy.fit(sel.union(sel.connectedNodes()), 60);
    else cy.fit(undefined, 30);
  };

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    const cities = net.vertices
      .filter((v) => v.id.toLowerCase().includes(q) || (v.name ?? '').toLowerCase().includes(q))
      .map((v) => ({ kind: 'city' as const, id: v.id, label: `${v.name ?? v.id} (${v.id})` }));
    const roads = net.roads
      .filter((r) => r.id.toLowerCase().includes(q) || (r.name ?? '').toLowerCase().includes(q))
      .map((r) => ({ kind: 'road' as const, id: r.id, label: `${r.id} — ${r.from}→${r.to}` }));
    return [...cities, ...roads].slice(0, 8);
  }, [search, net]);

  function jumpTo(kind: 'city' | 'road', id: string) {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass('search-hit');
    if (kind === 'city') {
      const n = cy.getElementById(id);
      if (n.length > 0) {
        cy.center(n);
        n.addClass('search-hit');
        setInspectNode(id);
        setInspectEdge(null);
      }
    } else {
      const e = cy.filter(`edge[roadId = "${id}"]`);
      if (e.length > 0) {
        cy.center(e);
        e.addClass('search-hit');
        setInspectEdge(id);
        setInspectNode(null);
      }
    }
    setSearch('');
  }

  function onKey(e: React.KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;
    if (e.key === '+' || e.key === '=') zoomBy(1.25);
    else if (e.key === '-') zoomBy(0.8);
    else if (e.key === '0' || e.key === 'f') fitAll();
    else if (e.key === 'c') centerRoute();
    else if (e.key === 'r') setRotation((r) => (r + 1) % 4);
    else if (e.key === '?') setShowKeys((v) => !v);
    else if (e.key === 'Escape') {
      setShowKeys(false);
      setInspectNode(null);
      setInspectEdge(null);
    } else return;
    e.preventDefault();
  }

  const nodeData = inspectNode ? net.vertices.find((v) => v.id === inspectNode) : undefined;
  const edgeData = inspectEdge ? net.roads.find((r) => r.id === inspectEdge) : undefined;
  const edgeIncidents = edgeData ? incidents.filter((i) => i.road === edgeData.id) : [];
  const edgeFactor = edgeData ? factors[edgeData.id] : undefined;
  const edgeClosed = edgeData
    ? closures.includes(edgeData.id) || edgeData.available === false
    : false;
  const edgeOnRoute = edgeData
    ? routeArcIds.some((a) => a === `${edgeData.id}:f` || a === `${edgeData.id}:r`)
    : false;

  return (
    <div ref={wrapRef} className={`pf-map-wrap${expanded ? ' expanded' : ''}`}>
      <div ref={ref} className="pf-map" data-testid="map" role="application"
        aria-label="Road network map" tabIndex={0} onKeyDown={onKey} />
      <div className="pf-mapbar" role="toolbar" aria-label="Map controls">
        <button className="pf-btn small" onClick={() => zoomBy(1.25)} aria-label="Zoom in" data-testid="map-zoom-in">+</button>
        <button className="pf-btn small" onClick={() => zoomBy(0.8)} aria-label="Zoom out" data-testid="map-zoom-out">−</button>
        <button className="pf-btn small" onClick={fitAll} aria-label="Fit to content" data-testid="map-fit">Fit</button>
        <button className="pf-btn small" onClick={centerRoute} aria-label="Center on route" data-testid="map-center">Route</button>
        <button className="pf-btn small" onClick={() => setRotation((r) => (r + 1) % 4)} aria-label="Rotate view" data-testid="map-rotate">⟳</button>
        <button className="pf-btn small" onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'Collapse map' : 'Expand map'} aria-pressed={expanded} data-testid="map-expand">
          {expanded ? 'Collapse' : 'Expand'}
        </button>
        <button className="pf-btn small" onClick={() => setShowKeys((v) => !v)} aria-label="Keyboard shortcuts" data-testid="map-keys">?</button>
      </div>
      <div className="pf-mapviews" role="group" aria-label="Map view">
        <button className="pf-btn small" onClick={() => setView('geo')} aria-pressed={view === 'geo'} data-testid="map-view-geo">Geographic</button>
        <button className="pf-btn small" onClick={() => setView('explore')} aria-pressed={view === 'explore'} data-testid="map-view-explore">Network</button>
      </div>
      <div className="pf-drawer" data-testid="map-search-box" style={{ top: 56, left: 10, right: 'auto', width: 250 }}>
        <label className="pf-meta" htmlFor="map-search">Search cities and roads</label>
        <input id="map-search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Type at least 2 letters" data-testid="map-search" style={{ width: '100%' }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && searchResults.length > 0) {
              const first = searchResults[0];
              if (first) jumpTo(first.kind, first.id);
            }
          }} />
        {searchResults.length > 0 && (
          <ul className="pf-suggest">
            {searchResults.map((r) => (
              <li key={`${r.kind}-${r.id}`} data-testid={`map-search-option-${r.id}`}
                onMouseDown={(e) => { e.preventDefault(); jumpTo(r.kind, r.id); }}>
                {r.label}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="pf-legend" data-testid="map-legend" aria-label="Map legend">
        <span><span className="k route" />Selected route</span>
        <span><span className="k alt" />Alternative (dashed)</span>
        <span><span className="k closed" />Closed road (dashed, thick)</span>
        <span><span className="k jam" />Congested (dotted)</span>
      </div>
      {view === 'explore' && <div className="pf-schematic-tag" data-testid="map-schematic-tag">SCHEMATIC — NOT GEOGRAPHIC</div>}
      {chips.length > 0 && (
        <div data-testid="stop-markers" role="list" aria-label="Stop order markers"
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 4 }}>
          {chips.map((c) => (
            <div key={c.id} data-testid={`stop-marker-${c.n}`} role="listitem"
              aria-label={`Stop ${c.n} at ${c.id}`}
              style={{
                position: 'absolute', top: 0, left: 0,
                transform: `translate(${c.x}px, ${c.y}px) translate(-50%,-50%)`,
                minWidth: 24, height: 24, borderRadius: 12,
                background: '#8a3f06', color: '#fff',
                fontSize: 13, fontWeight: 700, textAlign: 'center', lineHeight: '24px',
                padding: '0 6px',
              }}>
              {c.n}
            </div>
          ))}
        </div>
      )}
      <div className="pf-schematic-tag" style={{ right: view === 'explore' ? 10 : 10, bottom: view === 'explore' ? 34 : 10 }} data-testid="map-stats">
        {net.vertices.length} nodes · {net.roads.length} roads · {view}{statsExtra ? ` · ${statsExtra}` : ''}
      </div>
      {nodeData && (
        <div className="pf-drawer" role="dialog" aria-label={`City ${nodeData.id}`} data-testid="inspector-drawer">
          <h3>{nodeData.name ?? nodeData.id}</h3>
          <p className="pf-meta">{nodeData.id} · {nodeData.lat.toFixed(4)}, {nodeData.lon.toFixed(4)}</p>
          <h3>Connected roads ({roadEnds(net, nodeData.id).length})</h3>
          <ul>
            {roadEnds(net, nodeData.id).map((r) => (
              <li key={r.id}>
                <button className="pf-btn small" data-testid={`inspector-road-${r.id}`}
                  onClick={() => { setInspectEdge(r.id); setInspectNode(null); }}>
                  {r.id}
                </button>{' '}
                → {r.from === nodeData.id ? r.to : r.from} · {formatMetres(r.distanceM)} · {formatSeconds(r.baselineTimeS)}
              </li>
            ))}
          </ul>
          {(onSetOrigin || onSetDestination) && (
            <div className="pf-row">
              {onSetOrigin && (
                <button className="pf-btn small" data-testid="inspector-set-origin"
                  onClick={() => { onSetOrigin(nodeData.id); setInspectNode(null); }}>
                  Set as Origin
                </button>
              )}
              {onSetDestination && (
                <button className="pf-btn small" data-testid="inspector-set-destination"
                  onClick={() => { onSetDestination(nodeData.id); setInspectNode(null); }}>
                  Set as Destination
                </button>
              )}
            </div>
          )}
          <div className="pf-row">
            <button className="pf-btn small" data-testid="inspector-close" onClick={() => setInspectNode(null)}>Close</button>
          </div>
        </div>
      )}
      {edgeData && (
        <div className="pf-drawer" role="dialog" aria-label={`Road ${edgeData.id}`} data-testid="inspector-drawer">
          <h3>Road {edgeData.id}</h3>
          <p className="pf-meta">{edgeData.from} → {edgeData.to}{edgeData.oneWay ? ' · one-way' : ' · two-way'}</p>
          <dl className="pf-facts">
            <dt>Distance</dt><dd>{formatMetres(edgeData.distanceM)}</dd>
            <dt>Base time</dt><dd>{formatSeconds(edgeData.baselineTimeS)}</dd>
            <dt>Toll</dt><dd>{formatInr(edgeData.tollInr)}</dd>
            <dt>On route</dt><dd>{edgeOnRoute ? 'yes' : 'no'}</dd>
          </dl>
          <p className="pf-meta" data-testid="inspector-road-state">
            {edgeClosed ? 'CLOSED' : edgeFactor !== undefined && edgeFactor < 1000 ? `Congested at ${Math.round(edgeFactor / 10)}% speed` : 'Flowing normally'}
            {edgeIncidents.length > 0 && ` · incidents: ${edgeIncidents.map((i) => `${i.id}(${i.kind})`).join(', ')}`}
          </p>
          <div className="pf-row">
            <button className="pf-btn small" data-testid="inspector-close" onClick={() => setInspectEdge(null)}>Close</button>
          </div>
        </div>
      )}
      {showKeys && (
        <div className="pf-drawer" role="dialog" aria-label="Keyboard shortcuts" data-testid="map-shortcuts">
          <h3>Map shortcuts</h3>
          <ul>
            <li><code>+</code> / <code>-</code> zoom in / out</li>
            <li><code>0</code> or <code>f</code> fit to content</li>
            <li><code>c</code> center on route</li>
            <li><code>r</code> rotate 90°</li>
            <li><code>?</code> this panel · <code>Esc</code> close</li>
          </ul>
          <div className="pf-row">
            <button className="pf-btn small" onClick={() => setShowKeys(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
