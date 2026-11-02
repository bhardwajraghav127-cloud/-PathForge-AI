// Real Lab (R6): explainability on genuine OSM streets. A Dijkstra-vs-A*
// race using lab.run traces rendered as settled-vertex waves on the real
// map, a why-panel with engine receipts, a click-any-road inspector, and a
// viva walkthrough whose answers point at live artifacts.
import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import type { Map as MLMap } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import RealMap from '../realmap/RealMap';
import SourceBadge from '../realmap/SourceBadge';
import { useToasts } from '../components/ui';
import { engineClient, useEngineStatus } from '../engine/client';
import { EngineError } from '../engine/EngineClient';
import { formatMetres, formatSeconds } from '../data/dataset';
import { useRealTraffic } from '../realmap/realTraffic';
import {
  REAL_BOUNDS, REAL_CENTER, REAL_PLACES, REAL_ROADS, REAL_VERTICES,
  joinArcs, nearestRoad, nearestVertex, realLabels,
  realNetworkPayload, realRoadsGeo,
} from '../realmap/realData';
import { REAL_META } from '../realmap/realMeta';

const TraceEventSchema = z.object({
  step: z.number().catch(0), type: z.string().catch(''),
  vertex: z.string().catch(''), arc: z.string().catch(''),
  dist: z.number().catch(0), note: z.string().catch(''),
});

const LabRouteSchema = z.object({
  found: z.boolean(), reason: z.string().catch(''),
  timeS: z.number().catch(0), distanceM: z.number().catch(0),
  arcs: z.array(z.object({ arcId: z.string(), from: z.string(), to: z.string() })).catch([]),
  vertices: z.array(z.string()).catch([]),
}).passthrough();

const LabResultSchema = z.object({
  algorithm: z.string(),
  route: LabRouteSchema.nullable().catch(null),
  trace: z.array(TraceEventSchema).catch([]),
}).passthrough();

const StatsSchema = z.object({
  elapsedUs: z.number().catch(0), visitedVertices: z.number().catch(0),
  relaxedEdges: z.number().catch(0), heapOps: z.number().catch(0),
  expandedVertices: z.number().catch(0),
}).passthrough();

type LabStats = z.infer<typeof StatsSchema>;

interface RaceRun {
  algo: string;
  visits: [number, number][];
  traceLen: number;
  truncated: boolean;
  stats: LabStats;
  route: z.infer<typeof LabRouteSchema> | null;
  receipt: unknown;
}

const MAX_EVENTS = 100000;

const VIVA: { q: string; a: string; link: string; linkText: string }[] = [
  {
    q: 'Why did the Smart Demo reroute instead of waiting out the jam?',
    a: 'The C++ diversion policy recomputes the remaining ETA over the live overlay and compares it with the best candidate from your exact position. It only notifies when the saving clears a 60-second threshold, so a reroute banner means the engine proved — with the current closures — that waiting costs at least a minute. The decision receipt (overlay version, policy reason, saving estimate) is shown on the demo page.',
    link: '/real-demo', linkText: 'Open the Real Demo',
  },
  {
    q: 'Why does A* settle fewer vertices than Dijkstra in the race above?',
    a: 'Both are optimal here, but Dijkstra expands radially in order of distance from the origin while A* adds a straight-line (haversine) heuristic that pulls the search toward the target. The race table shows both settle counts from the same engine: identical path cost, far fewer A* visits.',
    link: '/real-lab', linkText: 'Re-run the race above',
  },
  {
    q: 'How do you know the A* heuristic is admissible on these streets?',
    a: 'Every road cost is a haversine-derived distance or time at or below the straight-line bound, and the engine re-verifies admissibility over the usable arcs on every A* call. If the check ever failed, the run would carry a HEURISTIC_ZERO warning and fall back to Dijkstra-equivalent search — optimality is never silently broken.',
    link: '/real-roads', linkText: 'Plan a route with A*',
  },
  {
    q: 'What happens when a road closes in front of a moving fleet vehicle?',
    a: 'Each vehicle re-evaluates its remaining plan against the shared overlay every 180 simulated seconds (60 on high priority) and immediately when the overlay version changes. If the policy notifies, the vehicle waits for the operator: Accept replays the frozen position and candidate through the engine, Stay records a rejection receipt. Blocked vehicles report BLOCKED instead of inventing a path.',
    link: '/real-fleet', linkText: 'Open the Real Fleet',
  },
  {
    q: 'Where does the road data come from, and what are its limits?',
    a: 'A bounded OpenStreetMap extract of New Delhi (7,052 vertices, 9,423 directed roads, ~596 km), processed once into a validated directed graph; the pipeline report lists every dropped loop and kept component. Limits: one small bbox, no live traffic feed, assumed class speeds for time estimates, and no turn restrictions yet.',
    link: '/real', linkText: 'Inspect the basemap',
  },
  {
    q: 'What is real here and what is simulated?',
    a: 'Real: OSM road geometry, the directed graph, every route polyline, and every diversion decision computed by the C++ engine. Simulated: incidents, closures, congestion factors, vehicle motion, ETAs from assumed speeds, SLA deadlines, and dispatch events. The notice SIMULATION — NOT LIVE GPS, DISPATCH OR TRAFFIC appears on every real page.',
    link: '/real-demo', linkText: 'See the simulation notice',
  },
];

export default function RealLab() {
  const engineStatus = useEngineStatus();
  const trafficVersion = useRealTraffic((s) => s.version);
  const overlayOf = useRealTraffic((s) => s.overlay);
  const pushToast = useToasts((s) => s.push);
  const mapOut = useRef<MLMap | null>(null);
  const [origin, setOrigin] = useState('Connaught Place');
  const [destination, setDestination] = useState('Central Vista');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [runs, setRuns] = useState<{ d: RaceRun | null; a: RaceRun | null }>({ d: null, a: null });
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [panelHidden, setPanelHidden] = useState(false);
  const [inspect, setInspect] = useState<{
    roadId: string; name: string; roadClass: string; oneWay: boolean;
    lengthM: number; distM: number; inDijkstra: number; inAstar: number;
    closed: boolean; factorPct: number | null;
  } | null>(null);
  const [revealed, setRevealed] = useState<boolean[]>(() => VIVA.map(() => false));

  const roads = useMemo(() => realRoadsGeo(), []);
  const labels = useMemo(() => realLabels(), []);
  const vertexPos = useMemo(() => {
    const m = new Map<string, [number, number]>();
    for (const v of REAL_VERTICES) m.set(v.id, [v.lon, v.lat]);
    return m;
  }, []);

  const maxSteps = Math.max(runs.d?.visits.length ?? 0, runs.a?.visits.length ?? 0);

  function emptyFC(): FeatureCollection {
    return { type: 'FeatureCollection', features: [] };
  }

  function visitsFC(coords: [number, number][]): FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: coords.map((c) => ({
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'Point' as const, coordinates: c },
      })),
    };
  }

  function ensureRaceLayers() {
    const map = mapOut.current;
    if (!map) return;
    const defs: [string, string][] = [['reallab-d', '#2563eb'], ['reallab-a', '#ea580c']];
    for (const [id, color] of defs) {
      if (!map.getSource(id)) {
        map.addSource(id, { type: 'geojson', data: emptyFC() });
        map.addLayer({
          id, type: 'circle', source: id,
          paint: { 'circle-radius': 3, 'circle-color': color, 'circle-opacity': 0.55 },
        });
      }
    }
  }

  // Paint settled-vertex waves for the current playback step.
  useEffect(() => {
    const map = mapOut.current;
    if (!map || (!runs.d && !runs.a)) return;
    ensureRaceLayers();
    const d = map.getSource('reallab-d');
    const a = map.getSource('reallab-a');
    if (d && 'setData' in d && runs.d) {
      (d as { setData: (d: FeatureCollection) => void })
        .setData(visitsFC(runs.d.visits.slice(0, Math.min(step, runs.d.visits.length))));
    }
    if (a && 'setData' in a && runs.a) {
      (a as { setData: (d: FeatureCollection) => void })
        .setData(visitsFC(runs.a.visits.slice(0, Math.min(step, runs.a.visits.length))));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, runs]);

  useEffect(() => {
    if (!playing || maxSteps === 0) return;
    if (step >= maxSteps) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setStep((s) => Math.min(maxSteps, s + 250 * speed)), 80);
    return () => clearTimeout(t);
  }, [playing, step, maxSteps, speed]);

  useEffect(() => () => {
    const map = mapOut.current;
    if (!map) return;
    for (const id of ['reallab-d', 'reallab-a']) {
      try {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      } catch { /* map already torn down */ }
    }
  }, []);

  async function runRace() {
    if (running) return;
    const oPlace = REAL_PLACES.find((p) => p.name === origin);
    const dPlace = REAL_PLACES.find((p) => p.name === destination);
    if (!oPlace || !dPlace) {
      setError('Pick two named places.');
      return;
    }
    const oSnap = nearestVertex(oPlace.lat, oPlace.lon);
    const dSnap = nearestVertex(dPlace.lat, dPlace.lon);
    if (!oSnap || !dSnap) {
      setError('Could not snap a place to the real graph.');
      return;
    }
    setRunning(true);
    setError('');
    setRuns({ d: null, a: null });
    setStep(0);
    setPlaying(false);
    try {
      const payload = (algorithm: string) => ({
        network: realNetworkPayload(), overlay: overlayOf(),
        algorithm, source: oSnap.id, target: dSnap.id,
        objective: 'FASTEST', maxEvents: MAX_EVENTS,
      });
      const [od, oa] = await Promise.all([
        engineClient.call('lab.run', payload('DIJKSTRA'), { channel: 'reallab-d' }),
        engineClient.call('lab.run', payload('A_STAR'), { channel: 'reallab-a' }),
      ]);
      if (od.stale || oa.stale) return;
      const mk = (algo: string, o: typeof od): RaceRun => {
        const r = LabResultSchema.parse(o.result);
        const visits: [number, number][] = [];
        for (const e of r.trace) {
          if (e.type !== 'visit' || !e.vertex) continue;
          const p = vertexPos.get(e.vertex);
          if (p) visits.push(p);
        }
        const stats = StatsSchema.parse(o.stats);
        const env = o.result as { warningsEmitted?: string[] };
        return {
          algo, visits, traceLen: r.trace.length,
          truncated: (stats as { traceTruncated?: boolean }).traceTruncated === true
            || (env.warningsEmitted ?? []).includes('TRACE_TRUNCATED'),
          stats, route: r.route, receipt: o.result,
        };
      };
      const d = mk('DIJKSTRA', od);
      const a = mk('A_STAR', oa);
      setRuns({ d, a });
      setStep(Math.max(d.visits.length, a.visits.length));
      pushToast(`Race complete: Dijkstra settled ${d.visits.length}, A* settled ${a.visits.length}`);
    } catch (e) {
      setError(e instanceof EngineError ? `${e.code}: ${e.message}` : String(e));
    } finally {
      setRunning(false);
    }
  }

  function onMapClick(ll: { lng: number; lat: number }) {
    const hit = nearestRoad(ll.lng, ll.lat);
    if (!hit) {
      setInspect(null);
      pushToast('No road within 100 m of that click', 'error');
      return;
    }
    const r = REAL_ROADS.find((x) => x.id === hit.roadId);
    if (!r) {
      setInspect(null);
      return;
    }
    const t = useRealTraffic.getState();
    const countIn = (route: RaceRun['route']) =>
      route?.arcs.filter((a) => a.arcId.split(':')[0] === r.id).length ?? 0;
    setInspect({
      roadId: r.id, name: r.name || '(unnamed way)', roadClass: r.roadType,
      oneWay: r.oneWay, lengthM: r.distanceM, distM: hit.distM,
      inDijkstra: countIn(runs.d?.route ?? null), inAstar: countIn(runs.a?.route ?? null),
      closed: t.closures.includes(r.id),
      factorPct: t.factors[r.id] !== undefined ? (t.factors[r.id] ?? 0) / 10 : null,
    });
  }

  const dRouteCoords = runs.d?.route ? joinArcs(runs.d.route.arcs.map((a) => a.arcId)) : null;
  const aRouteCoords = runs.a?.route ? joinArcs(runs.a.route.arcs.map((a) => a.arcId)) : null;
  const samePath = runs.d?.route && runs.a?.route
    ? runs.d.route.arcs.map((a) => a.arcId).join('|') === runs.a.route.arcs.map((a) => a.arcId).join('|')
    : null;
  const sameCost = runs.d?.route && runs.a?.route
    ? runs.d.route.timeS === runs.a.route.timeS : null;

  return (
    <div>
      <button className="pf-btn small pf-panel-toggle" data-testid="panel-toggle"
        aria-expanded={!panelHidden} onClick={() => setPanelHidden(!panelHidden)}>
        {panelHidden ? 'Show panel' : 'Hide panel'}
      </button>
      <div className={`pf-workspace${panelHidden ? ' panel-hidden' : ''}`}>
        <div className="pf-map-wrap pf-map-tall">
          <RealMap testid="realmap" initialCenter={REAL_CENTER} initialZoom={13}
            fitBounds={REAL_BOUNDS} roads={roads} labels={labels} mapOut={mapOut}
            route={dRouteCoords} altRoutes={aRouteCoords ? [aRouteCoords] : []}
            onMapClick={onMapClick} />
        </div>
        <div className="pf-panel">
          <section className="pf-card" aria-label="Algorithm race">
            <h2>Dijkstra vs A* race</h2>
            <p className="pf-meta" data-testid="engine-status">Engine: {engineStatus}</p>
            <p className="pf-meta" data-testid="reallab-overlay">Real overlay v{trafficVersion}</p>
            <div className="pf-field">
              <label htmlFor="reallab-origin">Origin</label>
              <select id="reallab-origin" value={origin} data-testid="reallab-origin"
                onChange={(e) => setOrigin(e.target.value)}>
                {REAL_PLACES.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            </div>
            <div className="pf-field">
              <label htmlFor="reallab-dest">Destination</label>
              <select id="reallab-dest" value={destination} data-testid="reallab-dest"
                onChange={(e) => setDestination(e.target.value)}>
                {REAL_PLACES.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            </div>
            <div className="pf-row">
              <button className="pf-btn primary" data-testid="reallab-run"
                disabled={running} onClick={() => void runRace()}>
                {running ? 'Racing…' : 'Run race'}
              </button>
            </div>
            {error && <div className="pf-alert error" role="alert" data-testid="reallab-error">{error}</div>}
            {runs.d && runs.a && (
              <div data-testid="reallab-table">
                <table className="pf-table">
                  <thead>
                    <tr><th scope="col">Metric</th><th scope="col">Dijkstra</th><th scope="col">A*</th></tr>
                  </thead>
                  <tbody>
                    <tr><th scope="row">Settled vertices</th>
                      <td data-testid="reallab-d-visited">{runs.d.stats.visitedVertices}</td>
                      <td data-testid="reallab-a-visited">{runs.a.stats.visitedVertices}</td></tr>
                    <tr><th scope="row">Relaxed edges</th>
                      <td>{runs.d.stats.relaxedEdges}</td><td>{runs.a.stats.relaxedEdges}</td></tr>
                    <tr><th scope="row">Heap ops</th>
                      <td>{runs.d.stats.heapOps}</td><td>{runs.a.stats.heapOps}</td></tr>
                    <tr><th scope="row">Engine time</th>
                      <td>{(runs.d.stats.elapsedUs / 1000).toFixed(1)} ms</td>
                      <td>{(runs.a.stats.elapsedUs / 1000).toFixed(1)} ms</td></tr>
                    <tr><th scope="row">Path time (est.)</th>
                      <td>{runs.d.route ? formatSeconds(runs.d.route.timeS) : '—'}</td>
                      <td>{runs.a.route ? formatSeconds(runs.a.route.timeS) : '—'}</td></tr>
                    <tr><th scope="row">Segments</th>
                      <td>{runs.d.route?.arcs.length ?? '—'}</td>
                      <td>{runs.a.route?.arcs.length ?? '—'}</td></tr>
                  </tbody>
                </table>
                <p className="pf-meta" data-testid="reallab-verdict">
                  {samePath === true && sameCost === true
                    && `Identical optimal path (${runs.d.route?.arcs.length} segments, ${runs.d.route ? formatSeconds(runs.d.route.timeS) : ''}); A* settled ${runs.a.visits.length} vertices vs Dijkstra ${runs.d.visits.length}.`}
                  {samePath === false && sameCost === true
                    && `Same optimal cost, different tie-breaking (${runs.d.route?.arcs.length} vs ${runs.a.route?.arcs.length} segments).`}
                  {sameCost === false && 'Different path costs — investigate before trusting this pair.'}
                  {(!runs.d.route?.found || !runs.a.route?.found) && ' One of the runs did not find a route.'}
                </p>
                {(runs.d.truncated || runs.a.truncated) && (
                  <div className="pf-alert warn" role="alert" data-testid="reallab-truncated">
                    Trace truncated at {MAX_EVENTS} events — counts are exact, the wave animation is partial.
                  </div>
                )}
              </div>
            )}
          </section>
          {runs.d && runs.a && (
            <section className="pf-card" aria-label="Expansion playback">
              <h2>Expansion playback</h2>
              <p className="pf-meta" data-testid="reallab-step">
                Settled: Dijkstra {Math.min(step, runs.d.visits.length)} / {runs.d.visits.length} ·{' '}
                A* {Math.min(step, runs.a.visits.length)} / {runs.a.visits.length}
              </p>
              <div className="pf-row">
                {!playing && (
                  <button className="pf-btn" data-testid="reallab-play"
                    onClick={() => { if (step >= maxSteps) setStep(0); setPlaying(true); }}>
                    Play waves
                  </button>
                )}
                {playing && (
                  <button className="pf-btn" data-testid="reallab-pause" onClick={() => setPlaying(false)}>
                    Pause
                  </button>
                )}
                <label>Speed{' '}
                  <select value={speed} data-testid="reallab-speed"
                    onChange={(e) => setSpeed(Number(e.target.value))}>
                    <option value={1}>1×</option>
                    <option value={2}>2×</option>
                    <option value={4}>4×</option>
                  </select>
                </label>
              </div>
              <div className="pf-field">
                <label htmlFor="reallab-scrub">Scrub settled order</label>
                <input id="reallab-scrub" type="range" min={0} max={maxSteps} value={step}
                  onChange={(e) => { setPlaying(false); setStep(Number(e.target.value)); }}
                  data-testid="reallab-scrub" />
              </div>
              <p className="pf-meta">
                Blue dots settle in Dijkstra order, orange in A* order — the recorded engine
                sequence, not an approximation. Dijkstra has no early exit, so it settles every
                reachable vertex; A* stops at the target.
              </p>
            </section>
          )}
          {runs.d && runs.a && (
            <section className="pf-card" aria-label="Why panel" data-testid="reallab-why">
              <h2>Why this result?</h2>
              <p>
                Both runs use the FASTEST objective on overlay v{trafficVersion}, so closures and
                congestion factors apply equally. A* reaches the same optimal cost while settling{' '}
                {runs.d.visits.length > 0
                  ? Math.round((1 - runs.a.visits.length / runs.d.visits.length) * 100)
                  : 0}% fewer vertices because the haversine heuristic orders the heap toward{' '}
                {destination}. Dijkstra's wave is the honest cost of having no goal direction.
              </p>
              <details>
                <summary>Dijkstra engine receipt</summary>
                <pre data-testid="reallab-receipt-d">{JSON.stringify(runs.d.receipt).slice(0, 2000)}</pre>
              </details>
              <details>
                <summary>A* engine receipt</summary>
                <pre data-testid="reallab-receipt-a">{JSON.stringify(runs.a.receipt).slice(0, 2000)}</pre>
              </details>
            </section>
          )}
          <section className="pf-card" aria-label="Road inspector" data-testid="reallab-inspector">
            <h2>Road inspector</h2>
            {!inspect && <p className="pf-meta">Click any road on the map for its real facts.</p>}
            {inspect && (
              <div data-testid="reallab-road">
                <dl className="pf-facts">
                  <dt>Road</dt><dd data-testid="reallab-road-id">{inspect.roadId}</dd>
                  <dt>Name</dt><dd>{inspect.name}</dd>
                  <dt>Class</dt><dd data-testid="reallab-road-class">{inspect.roadClass}</dd>
                  <dt>Direction</dt><dd>{inspect.oneWay ? 'one-way' : 'two-way'}</dd>
                  <dt>Length</dt><dd>{formatMetres(inspect.lengthM)}</dd>
                  <dt>Click distance</dt><dd>{inspect.distM} m</dd>
                  <dt>Overlay</dt><dd data-testid="reallab-road-state">
                    {inspect.closed ? 'CLOSED' : 'open'}
                    {inspect.factorPct !== null ? ` · ${inspect.factorPct}% speed (simulated)` : ''}
                  </dd>
                  <dt>Race usage</dt><dd data-testid="reallab-road-usage">
                    Dijkstra {inspect.inDijkstra} · A* {inspect.inAstar} segments
                  </dd>
                </dl>
              </div>
            )}
          </section>
          <section className="pf-card" aria-label="Viva walkthrough" data-testid="reallab-viva">
            <h2>Viva walkthrough</h2>
            <ol>
              {VIVA.map((v, i) => (
                <li key={v.q} data-testid={`reallab-viva-${i}`}>
                  <p><strong>Q{i + 1}:</strong> {v.q}</p>
                  {!revealed[i] && (
                    <button className="pf-btn small" data-testid={`reallab-viva-reveal-${i}`}
                      onClick={() => setRevealed((r) => r.map((x, j) => (j === i ? true : x)))}>
                      Reveal model answer
                    </button>
                  )}
                  {revealed[i] && (
                    <div data-testid={`reallab-viva-answer-${i}`}>
                      <p>{v.a}</p>
                      <p><a href={`/#${v.link}`}>{v.linkText}</a></p>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </section>
          <SourceBadge meta={REAL_META} />
        </div>
      </div>
    </div>
  );
}
