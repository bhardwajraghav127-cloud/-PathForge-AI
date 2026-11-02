// Algorithm Laboratory (M10): run genuine lab.* engine commands on a tiny
// graph or the full dataset, step through deterministic traces, compare
// algorithms, and inspect MST results. Nothing here computes paths.
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import MapView from '../components/MapView';
import TrafficPanel from '../components/TrafficPanel';
import VivaCard from '../components/VivaCard';
import { engineClient, useEngineStatus } from '../engine/client';
import { EngineError } from '../engine/EngineClient';
import { DATASET, type Dataset, formatSeconds } from '../data/dataset';
import { useTraffic } from '../traffic';
import { useToasts } from '../components/ui';

const TINY: Dataset = {
  schemaVersion: 1,
  vertices: [
    { id: 'a', name: 'A', lat: 28.0, lon: 77.0 },
    { id: 'b', name: 'B', lat: 28.0, lon: 77.0001 },
    { id: 'c', name: 'C', lat: 28.0001, lon: 77.0001 },
    { id: 'd', name: 'D', lat: 28.0001, lon: 77.0 },
  ],
  roads: [
    { id: 'ab', from: 'a', to: 'b', oneWay: true, distanceM: 10, baselineTimeS: 10, refSpeedKph: 4, tollInr: 0, roadType: 'lab', name: 'a-b cheap', available: true },
    { id: 'ba', from: 'b', to: 'a', oneWay: true, distanceM: 10, baselineTimeS: 90, refSpeedKph: 4, tollInr: 0, roadType: 'lab', name: 'b-a pricey', available: true },
    { id: 'bc', from: 'b', to: 'c', oneWay: true, distanceM: 10, baselineTimeS: 10, refSpeedKph: 4, tollInr: 0, roadType: 'lab', name: 'b-c cheap', available: true },
    { id: 'cb', from: 'c', to: 'b', oneWay: true, distanceM: 10, baselineTimeS: 90, refSpeedKph: 4, tollInr: 0, roadType: 'lab', name: 'c-b pricey', available: true },
    { id: 'cd', from: 'c', to: 'd', oneWay: true, distanceM: 10, baselineTimeS: 10, refSpeedKph: 4, tollInr: 0, roadType: 'lab', name: 'c-d cheap', available: true },
    { id: 'dc', from: 'd', to: 'c', oneWay: true, distanceM: 10, baselineTimeS: 90, refSpeedKph: 4, tollInr: 0, roadType: 'lab', name: 'd-c pricey', available: true },
    { id: 'da', from: 'd', to: 'a', oneWay: true, distanceM: 10, baselineTimeS: 10, refSpeedKph: 4, tollInr: 0, roadType: 'lab', name: 'd-a cheap', available: true },
    { id: 'ad', from: 'a', to: 'd', oneWay: true, distanceM: 10, baselineTimeS: 90, refSpeedKph: 4, tollInr: 0, roadType: 'lab', name: 'a-d pricey', available: true },
    { id: 'ac', from: 'a', to: 'c', oneWay: true, distanceM: 25, baselineTimeS: 25, refSpeedKph: 4, tollInr: 0, roadType: 'lab', name: 'a-c diagonal', available: true },
  ],
};

const ALGOS = ['BFS', 'DFS', 'DIJKSTRA', 'A_STAR', 'MST_PRIM', 'MST_KRUSKAL', 'TOPO_SORT', 'BINSEARCH'];
const NEEDS_TARGET = new Set(['DIJKSTRA', 'A_STAR']);

// Reference material (textbook facts, not engine output).
const ALGO_INFO: Record<string, { complexity: string; use: string; invariant: string }> = {
  BFS: { complexity: 'O(V + E) time, O(V) space', use: 'Fewest-hop paths on unweighted graphs; level-order exploration.', invariant: 'The queue always holds one frontier level; first visit is shortest in hops.' },
  DFS: { complexity: 'O(V + E) time, O(V) space', use: 'Connectivity, cycle detection, topological order building blocks.', invariant: 'The stack is the current root-to-node path; finish times nest.' },
  DIJKSTRA: { complexity: 'O((V + E) log V) with a binary heap', use: 'Optimal routes on non-negative weights; the engine default.', invariant: 'A settled vertex holds its final shortest distance.' },
  A_STAR: { complexity: 'O((V + E) log V); expands fewer nodes with a good heuristic', use: 'Goal-directed search; optimal iff the heuristic never overestimates.', invariant: 'f = g + h orders expansion; this engine rejects inadmissible maps.' },
  MST_PRIM: { complexity: 'O(E log V) lazy heap', use: 'Grow the cheapest connected network from a root (cabling, overlays).', invariant: 'The cut property: the cheapest crossing edge is always safe.' },
  MST_KRUSKAL: { complexity: 'O(E log E) with union-find', use: 'Same MST via global edge order; natural fit for distributed edges.', invariant: 'Edges join different components only — never a cycle.' },
  TOPO_SORT: { complexity: 'O(V + E) (Kahn)', use: 'Build/dependency order on DAGs; cycle detection otherwise.', invariant: 'Lexicographically smallest available vertex first (deterministic).' },
  BINSEARCH: { complexity: 'O(log n) probes', use: 'Exact index (or insertion point) in sorted arrays.', invariant: 'The target, if present, is always inside [lo, hi].' },
};

const TraceEventSchema = z.object({
  step: z.number().catch(0), type: z.string().catch(''),
  vertex: z.string().catch(''), arc: z.string().catch(''),
  dist: z.number().catch(0), note: z.string().catch(''),
});
type TraceEvent = z.infer<typeof TraceEventSchema>;

const LabResultSchema = z.object({
  algorithm: z.string(),
  order: z.array(z.string()).catch([]),
  hasCycle: z.boolean().catch(false),
  route: z.object({
    found: z.boolean(), timeS: z.number().catch(0),
    arcs: z.array(z.object({ arcId: z.string(), from: z.string(), to: z.string() })).catch([]),
  }).nullable().catch(null),
  mst: z.object({
    edges: z.array(z.object({ roadId: z.string(), from: z.string(), to: z.string(), weightM: z.number() })).catch([]),
    totalWeightM: z.number().catch(0), forest: z.boolean().catch(false),
  }).nullable().catch(null),
  trace: z.array(TraceEventSchema).catch([]),
}).passthrough();

const CmpSchema = z.object({
  results: z.array(z.object({
    algorithm: z.string(), traceLength: z.number().catch(0),
    visitedVertices: z.number().catch(0), expandedVertices: z.number().catch(0),
    cost: z.number().nullable().catch(null), found: z.boolean().catch(true),
  })).catch([]),
  comparison: z.object({ costAgreement: z.boolean().nullable().optional() }).passthrough(),
}).passthrough();

const EMPTY_CUSTOM: Dataset = {
  schemaVersion: 1,
  vertices: [
    { id: 'a', name: 'A', lat: 28.0, lon: 77.0 },
    { id: 'b', name: 'B', lat: 28.0, lon: 77.0001 },
  ],
  roads: [
    { id: 'ab', from: 'a', to: 'b', oneWay: true, distanceM: 10, baselineTimeS: 10, refSpeedKph: 4, tollInr: 0, roadType: 'custom', name: 'a-b', available: true },
  ],
};

export default function Lab() {
  const engineStatus = useEngineStatus();
  const trafficVersion = useTraffic((s) => s.version);
  const overlayOf = useTraffic((s) => s.overlay);
  const [netId, setNetId] = useState('tiny');
  const [custom, setCustom] = useState<Dataset>(EMPTY_CUSTOM);
  const [newVid, setNewVid] = useState('c');
  const [roadFrom, setRoadFrom] = useState('a');
  const [roadTo, setRoadTo] = useState('b');
  const [roadDist, setRoadDist] = useState('10');
  const [roadTime, setRoadTime] = useState('10');
  const [roadOneWay, setRoadOneWay] = useState(true);
  const [issues, setIssues] = useState<string[]>([]);
  const [validMsg, setValidMsg] = useState('');
  const [delV, setDelV] = useState('b');
  const [delR, setDelR] = useState('ab');
  const [editR, setEditR] = useState('ab');
  const [editDist, setEditDist] = useState('10');
  const [editTime, setEditTime] = useState('10');
  const [algo, setAlgo] = useState('BFS');
  const [speed, setSpeed] = useState(1);
  const pushToast = useToasts((s) => s.push);
  const [source, setSource] = useState('a');
  const [target, setTarget] = useState('c');
  const [objective, setObjective] = useState('FASTEST');
  const [values, setValues] = useState('10,20,30,40,50');
  const [binTarget, setBinTarget] = useState('30');
  const [binOut, setBinOut] = useState('');
  const [result, setResult] = useState<z.infer<typeof LabResultSchema> | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const [cmpA, setCmpA] = useState('DIJKSTRA');
  const [cmpB, setCmpB] = useState('A_STAR');
  const [cmp, setCmp] = useState<z.infer<typeof CmpSchema> | null>(null);

  const net: Dataset = netId === 'tiny' ? TINY : netId === 'dataset' ? DATASET : custom;
  const vertexIds = useMemo(() => net.vertices.map((v) => v.id), [net]);

  useEffect(() => {
    if (!vertexIds.includes(source)) setSource(vertexIds[0] ?? '');
    if (!vertexIds.includes(target)) setTarget(vertexIds[vertexIds.length - 1] ?? '');
  }, [vertexIds, source, target]);

  async function validateCustom() {
    setIssues([]);
    setValidMsg('');
    try {
      const o = await engineClient.call('network.validate', { network: custom }, { channel: 'lab-validate' });
      if (o.stale) return;
      const r = o.result as { valid?: boolean; issues?: { code?: string; message?: string }[] };
      const list = (r.issues ?? []).map((i) => `${i.code ?? '?'}: ${i.message ?? ''}`);
      setIssues(list);
      if (r.valid === true && list.length === 0) {
        setValidMsg(`Valid: ${custom.vertices.length} vertices, ${custom.roads.length} roads. Algorithms may run.`);
      }
    } catch (e) {
      setIssues([`ERROR: ${e instanceof EngineError ? e.message : String(e)}`]);
    }
  }

  useEffect(() => {
    if (!playing || !result) return;
    if (step >= result.trace.length) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setStep((s) => s + 1), Math.round(400 / speed));
    return () => clearTimeout(t);
  }, [playing, step, result, speed]);

  async function runAlgorithm(which: string) {
    setError('');
    setResult(null);
    setStep(0);
    setPlaying(false);
    try {
      const payload: Record<string, unknown> = {
        network: net, overlay: overlayOf(), algorithm: which, source,
        objective, maxEvents: 20000,
      };
      if (which === 'BINSEARCH') {
        payload['values'] = values.split(',').map((x) => Number(x.trim()));
        payload['target'] = Number(binTarget);
        delete payload['source'];
      } else if (NEEDS_TARGET.has(which)) {
        payload['target'] = target;
      }
      const o = await engineClient.call('lab.run', payload, { channel: 'lab' });
      if (o.stale) return;
      if (which === 'BINSEARCH') {
        const r = o.result as { index?: number; exact?: boolean };
        setBinOut(`index=${r.index} exact=${r.exact}`);
        return;
      }
      const r = LabResultSchema.parse(o.result);
      setResult(r);
      setStep(r.trace.length);
      if (which !== algo) setAlgo(which);
    } catch (e) {
      setError(e instanceof EngineError ? `${e.code}: ${e.message}` : String(e));
    }
  }

  function run() {
    void runAlgorithm(algo);
  }

  async function compare() {
    setError('');
    setCmp(null);
    try {
      const o = await engineClient.call('lab.compare', {
        network: net, overlay: overlayOf(),
        runs: [
          { algorithm: cmpA, source, target, objective },
          { algorithm: cmpB, source, target, objective },
        ],
      }, { channel: 'lab-compare' });
      if (o.stale) return;
      setCmp(CmpSchema.parse(o.result));
    } catch (e) {
      setError(e instanceof EngineError ? `${e.code}: ${e.message}` : String(e));
    }
  }

  const shown: TraceEvent[] = result?.trace.slice(0, step) ?? [];
  const visited = useMemo(
    () => [...new Set(shown.filter((e) => e.type === 'visit' || e.type === 'select').map((e) => e.vertex).filter(Boolean))],
    [shown],
  );
  const frontier = useMemo(() => {
    const seen = new Set(visited);
    const out: string[] = [];
    for (const e of shown) {
      if ((e.type === 'discover' || e.type === 'relax') && e.vertex && !seen.has(e.vertex)) {
        seen.add(e.vertex);
        out.push(e.vertex);
      }
    }
    return out;
  }, [shown, visited]);
  const tracedArcs = useMemo(() => [...new Set(shown.map((e) => e.arc).filter(Boolean))], [shown]);
  const current = shown.length > 0 ? (shown[shown.length - 1]?.vertex || null) : null;
  const bestDist = useMemo(() => {
    for (let i = shown.length - 1; i >= 0; i--) {
      const d = shown[i]?.dist;
      if (d !== undefined && d >= 0) return d;
    }
    return null;
  }, [shown]);
  const routeArcs = result?.route?.arcs.map((a) => a.arcId) ?? [];
  const mstSum = result?.mst ? result.mst.edges.map((e) => e.weightM).join(' + ') : '';
  const info = ALGO_INFO[algo];
  const [panelHidden, setPanelHidden] = useState(false);

  return (
    <div>
      <button className="pf-btn small pf-panel-toggle" data-testid="panel-toggle"
        aria-expanded={!panelHidden} onClick={() => setPanelHidden(!panelHidden)}>
        {panelHidden ? 'Show panel' : 'Hide panel'}
      </button>
      <div className={`pf-workspace${panelHidden ? ' panel-hidden' : ''}`}>
        <div className="pf-map-wrap">
          <MapView network={net} routeArcIds={step >= (result?.trace.length ?? 0) ? routeArcs : tracedArcs}
            visitedIds={visited} frontierIds={frontier} currentId={current} defaultView="explore" />
        </div>
        <div className="pf-panel">
          <section className="pf-card" aria-label="Lab controls">
            <h2>Algorithm Laboratory</h2>
            <p className="pf-meta" data-testid="engine-status">Engine: {engineStatus}</p>
            <div className="pf-row">
              <div className="pf-field">
                <label htmlFor="lab-net">Network</label>
                <select id="lab-net" value={netId} onChange={(e) => { setNetId(e.target.value); setSource('a'); setTarget('c'); setResult(null); }} data-testid="lab-net">
                  <option value="tiny">tiny-lab (4 nodes)</option>
                  <option value="dataset">north-india (20 nodes)</option>
                  <option value="custom">custom (editable)</option>
                </select>
              </div>
              <div className="pf-field">
                <label htmlFor="lab-algo">Algorithm</label>
                <select id="lab-algo" value={algo} onChange={(e) => setAlgo(e.target.value)} data-testid="lab-algo">
                  {ALGOS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            </div>
            {algo !== 'BINSEARCH' && (
              <div className="pf-row">
                <div className="pf-field">
                  <label htmlFor="lab-source">Source</label>
                  <select id="lab-source" value={source} onChange={(e) => setSource(e.target.value)} data-testid="lab-source">
                    {vertexIds.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                {NEEDS_TARGET.has(algo) && (
                  <div className="pf-field">
                    <label htmlFor="lab-target">Target</label>
                    <select id="lab-target" value={target} onChange={(e) => setTarget(e.target.value)} data-testid="lab-target">
                      {vertexIds.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                )}
                {(algo === 'DIJKSTRA' || algo === 'A_STAR') && (
                  <div className="pf-field">
                    <label htmlFor="lab-objective">Objective</label>
                    <select id="lab-objective" value={objective} onChange={(e) => setObjective(e.target.value)} data-testid="lab-objective">
                      {['FASTEST', 'SHORTEST', 'LOWEST_TOLL', 'AVOID_CONGESTION', 'BALANCED'].map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                )}
              </div>
            )}
            {algo === 'BINSEARCH' && (
              <div className="pf-row">
                <div className="pf-field">
                  <label htmlFor="lab-values">Sorted values</label>
                  <input id="lab-values" value={values} onChange={(e) => setValues(e.target.value)} data-testid="lab-values" />
                </div>
                <div className="pf-field">
                  <label htmlFor="lab-target-v">Target</label>
                  <input id="lab-target-v" value={binTarget} onChange={(e) => setBinTarget(e.target.value)} data-testid="lab-bin-target" />
                </div>
              </div>
            )}
            {info && (
              <div data-testid="lab-algo-info">
                <p className="pf-meta"><strong>{algo}</strong> · {info.complexity}</p>
                <p className="pf-meta">{info.use}</p>
                <p className="pf-meta">Invariant: {info.invariant}</p>
              </div>
            )}
            <div className="pf-row">
              <button className="pf-btn primary" onClick={() => run()} data-testid="lab-run">Run Algorithm</button>
            </div>
            {binOut && <p data-testid="lab-binsearch-out">{binOut}</p>}
            {error && <div className="pf-alert error" role="alert" data-testid="lab-error">{error}</div>}
          </section>

          {result && (
            <section className="pf-card" aria-label="Trace player" data-testid="lab-result">
              <h2>{result.algorithm} result</h2>
              {result.order.length > 0 && <p data-testid="lab-order">Order: {result.order.join(' → ')}</p>}
              {result.hasCycle && <p data-testid="lab-cycle">Cycle detected (partial order shown).</p>}
              {result.route && <p data-testid="lab-route">Route: {result.route.found ? `${formatSeconds(result.route.timeS)} via ${result.route.arcs.map((a) => a.arcId).join(' ')}` : 'unreachable'}</p>}
              {result.mst && (
                <p data-testid="lab-mst">
                  MST weight {result.mst.totalWeightM}m · {result.mst.edges.length} edges{result.mst.forest ? ' · FOREST (disconnected)' : ''}
                  : {result.mst.edges.map((e) => `${e.roadId}(${e.weightM}m)`).join(' ')}
                  {mstSum && ` = ${mstSum} = ${result.mst.totalWeightM}m`}
                </p>
              )}
              <p className="pf-meta" data-testid="lab-live-stats">
                Visited {visited.length} · frontier {frontier.length}
                {bestDist !== null && ` · current best ${bestDist}`}
              </p>
              <div className="pf-field">
                <label htmlFor="lab-step">Trace step {step}/{result.trace.length}</label>
                <input id="lab-step" type="range" min={0} max={result.trace.length} value={step}
                  onChange={(e) => { setPlaying(false); setStep(Number(e.target.value)); }} data-testid="lab-step" />
              </div>
              <div className="pf-row">
                <button className="pf-btn" onClick={() => setPlaying((p) => !p)} data-testid="lab-play">{playing ? 'Pause' : 'Play'}</button>
                <button className="pf-btn" onClick={() => { setPlaying(false); setStep((s) => Math.max(0, s - 1)); }} data-testid="lab-prev" aria-label="Previous step">‹ Prev</button>
                <button className="pf-btn" onClick={() => { setPlaying(false); setStep((s) => Math.min(result.trace.length, s + 1)); }} data-testid="lab-next" aria-label="Next step">Next ›</button>
                <button className="pf-btn" onClick={() => { setPlaying(false); setStep(0); }} data-testid="lab-reset">Reset</button>
                <div className="pf-field">
                  <label htmlFor="lab-speed">Speed</label>
                  <select id="lab-speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} data-testid="lab-speed">
                    <option value={0.5}>0.5×</option>
                    <option value={1}>1×</option>
                    <option value={2}>2×</option>
                    <option value={4}>4×</option>
                  </select>
                </div>
              </div>
              <ol data-testid="trace-events">
                {shown.map((e) => (
                  <li key={e.step} data-testid={`trace-${e.step}`}>
                    #{e.step} {e.type} {e.vertex} {e.arc} {e.note}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {netId === 'custom' && (
            <section className="pf-card" aria-label="Graph editor">
              <h2>Graph editor</h2>
              <div className="pf-row">
                <div className="pf-field">
                  <label htmlFor="lab-new-v">New vertex id</label>
                  <input id="lab-new-v" value={newVid} onChange={(e) => setNewVid(e.target.value)} data-testid="lab-new-v" />
                </div>
                <button className="pf-btn" onClick={() => {
                  const id = newVid.trim();
                  if (!id || custom.vertices.some((v) => v.id === id)) return;
                  const n = custom.vertices.length;
                  setCustom((c) => ({
                    ...c,
                    vertices: [...c.vertices, { id, name: id.toUpperCase(), lat: 28.0 + 0.0001 * n, lon: 77.0 + 0.0001 * n }],
                  }));
                  setNewVid('');
                }} data-testid="lab-add-v">Add vertex</button>
              </div>
              <div className="pf-row">
                <div className="pf-field">
                  <label htmlFor="lab-road-from">From</label>
                  <select id="lab-road-from" value={roadFrom} onChange={(e) => setRoadFrom(e.target.value)} data-testid="lab-road-from">
                    {custom.vertices.map((v) => <option key={v.id} value={v.id}>{v.id}</option>)}
                  </select>
                </div>
                <div className="pf-field">
                  <label htmlFor="lab-road-to">To</label>
                  <select id="lab-road-to" value={roadTo} onChange={(e) => setRoadTo(e.target.value)} data-testid="lab-road-to">
                    {custom.vertices.map((v) => <option key={v.id} value={v.id}>{v.id}</option>)}
                  </select>
                </div>
              </div>
              <div className="pf-row">
                <div className="pf-field">
                  <label htmlFor="lab-road-dist">Distance (m)</label>
                  <input id="lab-road-dist" value={roadDist} onChange={(e) => setRoadDist(e.target.value)} data-testid="lab-road-dist" />
                </div>
                <div className="pf-field">
                  <label htmlFor="lab-road-time">Time (s)</label>
                  <input id="lab-road-time" value={roadTime} onChange={(e) => setRoadTime(e.target.value)} data-testid="lab-road-time" />
                </div>
                <div className="pf-field">
                  <label htmlFor="lab-road-oneway">One-way</label>
                  <input id="lab-road-oneway" type="checkbox" checked={roadOneWay} onChange={(e) => setRoadOneWay(e.target.checked)} data-testid="lab-road-oneway" />
                </div>
              </div>
              <div className="pf-row">
                <button className="pf-btn" onClick={() => {
                  const d = Number(roadDist);
                  const t = Number(roadTime);
                  if (!Number.isFinite(d) || !Number.isFinite(t) || d <= 0 || t <= 0) return;
                  if (!custom.vertices.some((v) => v.id === roadFrom) || !custom.vertices.some((v) => v.id === roadTo)) return;
                  const id = `${roadFrom}${roadTo}${custom.roads.length}`;
                  if (custom.roads.some((r) => r.id === id)) return;
                  setCustom((c) => ({
                    ...c,
                    roads: [...c.roads, { id, from: roadFrom, to: roadTo, oneWay: roadOneWay, distanceM: d, baselineTimeS: t, refSpeedKph: 4, tollInr: 0, roadType: 'custom', name: id, available: true }],
                  }));
                }} data-testid="lab-add-road">Add road</button>
                <button className="pf-btn" onClick={() => {
                  if (custom.roads.length === 0) return;
                  setCustom((c) => ({ ...c, roads: c.roads.slice(0, -1) }));
                }} data-testid="lab-remove-road">Remove last road</button>
                <button className="pf-btn" onClick={() => void validateCustom()} data-testid="lab-validate">Validate</button>
              </div>
              <h3>Examples</h3>
              <div className="pf-row">
                <button className="pf-btn small" data-testid="lab-example-line"
                  onClick={() => {
                    setCustom({
                      schemaVersion: 1,
                      vertices: [
                        { id: 'a', name: 'A', lat: 28.0, lon: 77.0 },
                        { id: 'b', name: 'B', lat: 28.0, lon: 77.0001 },
                        { id: 'c', name: 'C', lat: 28.0, lon: 77.0002 },
                      ],
                      roads: [
                        { id: 'ab', from: 'a', to: 'b', oneWay: false, distanceM: 10, baselineTimeS: 10, refSpeedKph: 4, tollInr: 0, roadType: 'custom', name: 'ab', available: true },
                        { id: 'bc', from: 'b', to: 'c', oneWay: false, distanceM: 10, baselineTimeS: 10, refSpeedKph: 4, tollInr: 0, roadType: 'custom', name: 'bc', available: true },
                      ],
                    });
                    pushToast('Loaded line example');
                  }}>
                  Line
                </button>
                <button className="pf-btn small" data-testid="lab-example-disconnected"
                  onClick={() => {
                    setCustom({
                      schemaVersion: 1,
                      vertices: [
                        { id: 'a', name: 'A', lat: 28.0, lon: 77.0 },
                        { id: 'b', name: 'B', lat: 28.0, lon: 77.0001 },
                        { id: 'c', name: 'C', lat: 28.0, lon: 77.0002 },
                      ],
                      roads: [
                        { id: 'ab', from: 'a', to: 'b', oneWay: false, distanceM: 10, baselineTimeS: 10, refSpeedKph: 4, tollInr: 0, roadType: 'custom', name: 'ab', available: true },
                      ],
                    });
                    pushToast('Loaded disconnected example (MST shows FOREST)');
                  }}>
                  Disconnected
                </button>
                <button className="pf-btn small" data-testid="lab-example-dense"
                  onClick={() => {
                    setCustom({
                      schemaVersion: 1,
                      vertices: [
                        { id: 'a', name: 'A', lat: 28.0, lon: 77.0 },
                        { id: 'b', name: 'B', lat: 28.0, lon: 77.0001 },
                        { id: 'c', name: 'C', lat: 28.0001, lon: 77.0001 },
                      ],
                      roads: [
                        { id: 'ab', from: 'a', to: 'b', oneWay: false, distanceM: 10, baselineTimeS: 10, refSpeedKph: 4, tollInr: 0, roadType: 'custom', name: 'ab', available: true },
                        { id: 'bc', from: 'b', to: 'c', oneWay: false, distanceM: 15, baselineTimeS: 15, refSpeedKph: 4, tollInr: 0, roadType: 'custom', name: 'bc', available: true },
                        { id: 'ac', from: 'a', to: 'c', oneWay: true, distanceM: 30, baselineTimeS: 30, refSpeedKph: 4, tollInr: 0, roadType: 'custom', name: 'ac', available: true },
                      ],
                    });
                    pushToast('Loaded dense example');
                  }}>
                  Dense
                </button>
              </div>
              <h3>Delete</h3>
              <div className="pf-row">
                <div className="pf-field">
                  <label htmlFor="lab-del-v-sel">Vertex</label>
                  <select id="lab-del-v-sel" value={delV} onChange={(e) => setDelV(e.target.value)} data-testid="lab-del-v-sel">
                    {custom.vertices.map((v) => <option key={v.id} value={v.id}>{v.id}</option>)}
                  </select>
                </div>
                <button className="pf-btn small danger" data-testid="lab-del-v"
                  onClick={() => {
                    if (custom.roads.some((r) => r.from === delV || r.to === delV)) {
                      pushToast(`Cannot delete ${delV}: roads still reference it`, 'error');
                      return;
                    }
                    setCustom((c) => ({ ...c, vertices: c.vertices.filter((v) => v.id !== delV) }));
                    pushToast(`Deleted vertex ${delV}`);
                  }}>
                  Delete vertex
                </button>
                <div className="pf-field">
                  <label htmlFor="lab-del-road-sel">Road</label>
                  <select id="lab-del-road-sel" value={delR} onChange={(e) => setDelR(e.target.value)} data-testid="lab-del-road-sel">
                    {custom.roads.map((r) => <option key={r.id} value={r.id}>{r.id}</option>)}
                  </select>
                </div>
                <button className="pf-btn small danger" data-testid="lab-del-road"
                  onClick={() => {
                    setCustom((c) => ({ ...c, roads: c.roads.filter((r) => r.id !== delR) }));
                    pushToast(`Deleted road ${delR}`);
                  }}>
                  Delete road
                </button>
              </div>
              <h3>Edit weights</h3>
              <div className="pf-row">
                <div className="pf-field">
                  <label htmlFor="lab-edit-road-sel">Road</label>
                  <select id="lab-edit-road-sel" value={editR} onChange={(e) => setEditR(e.target.value)} data-testid="lab-edit-road-sel">
                    {custom.roads.map((r) => <option key={r.id} value={r.id}>{r.id}</option>)}
                  </select>
                </div>
                <div className="pf-field">
                  <label htmlFor="lab-edit-dist">Distance (m)</label>
                  <input id="lab-edit-dist" value={editDist} onChange={(e) => setEditDist(e.target.value)} data-testid="lab-edit-dist" />
                </div>
                <div className="pf-field">
                  <label htmlFor="lab-edit-time">Time (s)</label>
                  <input id="lab-edit-time" value={editTime} onChange={(e) => setEditTime(e.target.value)} data-testid="lab-edit-time" />
                </div>
                <button className="pf-btn small" data-testid="lab-edit-road-apply"
                  onClick={() => {
                    const d = Number(editDist);
                    const t = Number(editTime);
                    if (!Number.isFinite(d) || !Number.isFinite(t) || d <= 0 || t <= 0) {
                      pushToast('Distance and time must be positive numbers', 'error');
                      return;
                    }
                    setCustom((c) => ({
                      ...c,
                      roads: c.roads.map((r) => (r.id === editR ? { ...r, distanceM: d, baselineTimeS: t } : r)),
                    }));
                    pushToast(`Updated ${editR}: ${d}m / ${t}s`);
                  }}>
                  Apply
                </button>
              </div>
              <p className="pf-meta" data-testid="lab-custom-counts">
                {custom.vertices.length} vertices · {custom.roads.length} roads
              </p>
              {validMsg && <p data-testid="lab-valid-ok">{validMsg}</p>}
              <ul data-testid="lab-issues">
                {issues.map((i, k) => <li key={k}>{i}</li>)}
              </ul>
            </section>
          )}

          <section className="pf-card" aria-label="Algorithm comparison">
            <h2>Compare algorithms</h2>
            <div className="pf-row">
              <div className="pf-field">
                <label htmlFor="lab-cmp-a">Run A</label>
                <select id="lab-cmp-a" value={cmpA} onChange={(e) => setCmpA(e.target.value)} data-testid="lab-cmp-a">
                  {ALGOS.filter((a) => a !== 'BINSEARCH').map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div className="pf-field">
                <label htmlFor="lab-cmp-b">Run B</label>
                <select id="lab-cmp-b" value={cmpB} onChange={(e) => setCmpB(e.target.value)} data-testid="lab-cmp-b">
                  {ALGOS.filter((a) => a !== 'BINSEARCH').map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            </div>
            <div className="pf-row">
              <button className="pf-btn" onClick={() => void compare()} data-testid="lab-compare">Run Comparison</button>
              <button className="pf-btn small" data-testid="lab-cmp-swap"
                onClick={() => { const a = cmpA; setCmpA(cmpB); setCmpB(a); }}>
                Swap A/B
              </button>
            </div>
            {cmp && (
              <div>
                <table data-testid="lab-compare-out">
                  <caption>Run metrics (engine facts)</caption>
                  <thead>
                    <tr><th scope="col">Run</th><th scope="col">Visited</th><th scope="col">Expanded</th><th scope="col">Trace</th><th scope="col">Cost</th><th scope="col">Load</th></tr>
                  </thead>
                  <tbody>
                    {cmp.results.map((r) => (
                      <tr key={r.algorithm} data-testid={`lab-compare-${r.algorithm}`}>
                        <th scope="row">{r.algorithm}</th>
                        <td>{r.visitedVertices}</td>
                        <td>{r.expandedVertices}</td>
                        <td>{r.traceLength}</td>
                        <td>{r.cost === null ? 'n/a' : r.cost}</td>
                        <td>
                          <button className="pf-btn small" data-testid={`lab-load-${r.algorithm}`}
                            onClick={() => void runAlgorithm(r.algorithm)}>
                            Into player
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p data-testid="lab-cost-agreement">
                  cost agreement: {String(cmp.comparison.costAgreement ?? 'n/a')}
                  {cmp.results.length === 2
                    && cmp.results[0]?.cost !== null && cmp.results[0]?.cost !== undefined
                    && cmp.results[1]?.cost !== null && cmp.results[1]?.cost !== undefined
                    && ` (Δ ${Math.abs((cmp.results[0]?.cost ?? 0) - (cmp.results[1]?.cost ?? 0))})`}
                </p>
              </div>
            )}
          </section>

          <TrafficPanel />
          <p className="pf-meta" data-testid="traffic-note">Closures apply to lab runs (MST shows FOREST when split). Overlay v{trafficVersion}.</p>
          <VivaCard page="lab" />
        </div>
      </div>
    </div>
  );
}
