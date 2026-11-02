// Real Roads planner (R3): genuine OSM graph + C++/WASM routing rendered
// along true edge polylines. Origin/destination from the local gazetteer or
// map clicks snapped to the nearest vertex (500 m). Engine stats
// (visited/relaxed/heap) and warnings display verbatim.
import { useMemo, useState } from 'react';
import { z } from 'zod';
import RealMap, { type MapPin } from '../realmap/RealMap';
import SourceBadge from '../realmap/SourceBadge';
import { SearchSelect, useToasts } from '../components/ui';
import { engineClient, useEngineStatus } from '../engine/client';
import { EngineError } from '../engine/EngineClient';
import { formatMetres, formatSeconds } from '../data/dataset';
import { DemoRouteSchema } from '../demo/scenario';
import {
  REAL_BOUNDS, REAL_CENTER, REAL_PLACES, REAL_VERTICES,
  joinArcs, nearestVertex, realLabels, realNetworkPayload, realRoadsGeo,
} from '../realmap/realData';
import { REAL_META } from '../realmap/realMeta';

const AltsSchema = z.object({ alternatives: z.array(DemoRouteSchema).catch([]) }).passthrough();
const StatsSchema = z.object({
  elapsedUs: z.number().catch(0), visitedVertices: z.number().catch(0),
  relaxedEdges: z.number().catch(0), heapOps: z.number().catch(0),
}).passthrough();

interface Endpoint {
  vertexId: string;
  lat: number;
  lon: number;
  label: string;
  snapM: number;
}

export default function RealRoads() {
  const engineStatus = useEngineStatus();
  const pushToast = useToasts((s) => s.push);
  const [panelHidden, setPanelHidden] = useState(false);
  const [origin, setOrigin] = useState<Endpoint | null>(null);
  const [dest, setDest] = useState<Endpoint | null>(null);
  const [active, setActive] = useState<'origin' | 'dest'>('origin');
  const [objective, setObjective] = useState('FASTEST');
  const [algorithm, setAlgorithm] = useState('DIJKSTRA');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<z.infer<typeof DemoRouteSchema> | null>(null);
  const [stats, setStats] = useState<z.infer<typeof StatsSchema> | null>(null);
  const [alts, setAlts] = useState<z.infer<typeof DemoRouteSchema>[]>([]);
  const [error, setError] = useState('');

  const roads = useMemo(() => realRoadsGeo(), []);
  const labels = useMemo(() => realLabels(), []);
  const options = useMemo(
    () => REAL_PLACES.map((p) => ({ id: p.id, label: `${p.name} (${p.kind})` })),
    [],
  );

  function pickPlace(placeId: string, which: 'origin' | 'dest') {
    const p = REAL_PLACES.find((x) => x.id === placeId);
    if (!p) return;
    const v = nearestVertex(p.lat, p.lon);
    if (!v) {
      pushToast(`No road vertex near ${p.name}`, 'error');
      return;
    }
    const dLat = (v.lat - p.lat) * 111320;
    const dLon = (v.lon - p.lon) * 111320 * Math.cos((p.lat * Math.PI) / 180);
    const ep: Endpoint = {
      vertexId: v.id, lat: v.lat, lon: v.lon,
      label: `${p.name} → ${v.id}`, snapM: Math.round(Math.hypot(dLat, dLon)),
    };
    if (which === 'origin') {
      setOrigin(ep);
      setActive('dest');
    } else {
      setDest(ep);
      setActive('origin');
    }
  }

  function onMapClick(ll: { lng: number; lat: number }) {
    const v = nearestVertex(ll.lat, ll.lng);
    if (!v) {
      pushToast('No road within 500 m of that click', 'error');
      return;
    }
    const dLat = (v.lat - ll.lat) * 111320;
    const dLon = (v.lon - ll.lng) * 111320 * Math.cos((ll.lat * Math.PI) / 180);
    const ep: Endpoint = {
      vertexId: v.id, lat: v.lat, lon: v.lon,
      label: `map click → ${v.id}`, snapM: Math.round(Math.hypot(dLat, dLon)),
    };
    if (active === 'origin') {
      setOrigin(ep);
      setActive('dest');
    } else {
      setDest(ep);
      setActive('origin');
    }
  }

  async function find() {
    if (!origin || !dest || busy) return;
    setBusy(true);
    setError('');
    setResult(null);
    setAlts([]);
    setStats(null);
    try {
      const base = {
        network: realNetworkPayload(), overlay: { version: 1 },
        source: origin.vertexId, target: dest.vertexId, objective,
      };
      const o = await engineClient.call('route.find', { ...base, algorithm }, { channel: 'real' });
      if (o.stale) return;
      const found = DemoRouteSchema.parse(o.result);
      setStats(StatsSchema.parse(o.stats));
      setResult(found);
      if (found.found) {
        pushToast(`Real route: ${found.arcs.length} segments, ${formatSeconds(found.timeS)} (estimated)`);
        const ao = await engineClient.call(
          'route.alternatives', { ...base, maxCandidates: 6, maxAlternatives: 2 }, { channel: 'real' },
        );
        if (!ao.stale) {
          const parsed = AltsSchema.parse(ao.result);
          setAlts(parsed.alternatives.filter((a) => a.found).slice(0, 2));
        }
      } else {
        pushToast(`No route: ${found.reason || 'unreachable'}`, 'error');
      }
    } catch (e) {
      const msg = e instanceof EngineError ? `${e.code}: ${e.message}` : String(e);
      setError(msg);
      pushToast(msg, 'error');
    } finally {
      setBusy(false);
    }
  }

  const routeCoords = useMemo(
    () => (result?.found ? joinArcs(result.arcs.map((a) => a.arcId)) : null),
    [result],
  );
  const altCoords = useMemo(
    () => alts.map((a) => joinArcs(a.arcs.map((x) => x.arcId))),
    [alts],
  );
  const pins: MapPin[] = useMemo(() => {
    const out: MapPin[] = [];
    if (origin) out.push({ lng: origin.lon, lat: origin.lat, color: '#0f6b4a', text: 'O', testid: 'real-pin-origin' });
    if (dest) out.push({ lng: dest.lon, lat: dest.lat, color: '#0b5fff', text: 'D', testid: 'real-pin-dest' });
    return out;
  }, [origin, dest]);

  return (
    <div>
      <button className="pf-btn small pf-panel-toggle" data-testid="panel-toggle"
        aria-expanded={!panelHidden} onClick={() => setPanelHidden(!panelHidden)}>
        {panelHidden ? 'Show panel' : 'Hide panel'}
      </button>
      <div className={`pf-workspace${panelHidden ? ' panel-hidden' : ''}`}>
        <div className="pf-map-wrap pf-map-tall">
          <RealMap testid="realmap" initialCenter={REAL_CENTER} initialZoom={13}
            fitBounds={REAL_BOUNDS} roads={roads} labels={labels}
            route={routeCoords} altRoutes={altCoords} pins={pins} onMapClick={onMapClick} />
        </div>
        <div className="pf-panel">
          <section className="pf-card" aria-label="Real route planner">
            <h2>Real Roads navigation</h2>
            <p className="pf-meta" data-testid="engine-status">Engine: {engineStatus}</p>
            <p className="pf-meta" data-testid="real-coverage">
              {REAL_VERTICES.length.toLocaleString()} vertices · {REAL_META.coverage}
            </p>
            <div className="pf-row" role="group" aria-label="Click sets">
              <button className="pf-btn small" data-testid="real-arm-origin" aria-pressed={active === 'origin'}
                onClick={() => setActive('origin')}>
                Click sets origin
              </button>
              <button className="pf-btn small" data-testid="real-arm-dest" aria-pressed={active === 'dest'}
                onClick={() => setActive('dest')}>
                Click sets destination
              </button>
            </div>
            <SearchSelect id="real-origin" label="Origin (gazetteer)" options={options}
              value="" onPick={(id) => pickPlace(id, 'origin')} testid="real-origin" />
            {origin && <p className="pf-meta" data-testid="real-origin-set">{origin.label} · snapped {origin.snapM} m</p>}
            <SearchSelect id="real-dest" label="Destination (gazetteer)" options={options}
              value="" onPick={(id) => pickPlace(id, 'dest')} testid="real-dest" />
            {dest && <p className="pf-meta" data-testid="real-dest-set">{dest.label} · snapped {dest.snapM} m</p>}
            <div className="pf-row">
              <div className="pf-field">
                <label htmlFor="real-objective">Objective</label>
                <select id="real-objective" value={objective} onChange={(e) => setObjective(e.target.value)}
                  data-testid="real-objective">
                  <option value="FASTEST">FASTEST</option>
                  <option value="SHORTEST">SHORTEST</option>
                </select>
              </div>
              <div className="pf-field">
                <label htmlFor="real-algorithm">Algorithm</label>
                <select id="real-algorithm" value={algorithm} onChange={(e) => setAlgorithm(e.target.value)}
                  data-testid="real-algorithm">
                  <option value="DIJKSTRA">DIJKSTRA</option>
                  <option value="A_STAR">A_STAR</option>
                </select>
              </div>
            </div>
            <div className="pf-row">
              <button className="pf-btn primary" onClick={() => void find()} disabled={busy || !origin || !dest}
                data-testid="real-find">
                {busy ? 'Routing…' : 'Find Real Route'}
              </button>
              <button className="pf-btn" data-testid="real-swap"
                disabled={!origin && !dest}
                onClick={() => { const o = origin; setOrigin(dest); setDest(o); setResult(null); }}>
                Swap
              </button>
            </div>
            {error && <div className="pf-alert error" role="alert" data-testid="real-error">{error}</div>}
          </section>
          {result && (
            <section className="pf-card" aria-label="Real route result" data-testid="real-result">
              {result.found ? (
                <div>
                  <h2>Route found</h2>
                  <dl className="pf-facts">
                    <dt>Segments</dt><dd data-testid="real-segments">{result.arcs.length}</dd>
                    <dt>Distance</dt><dd data-testid="real-distance">{formatMetres(result.distanceM)}</dd>
                    <dt>Time (est.)</dt><dd data-testid="real-time">{formatSeconds(result.timeS)}</dd>
                    <dt>Algorithm</dt><dd>{algorithm}</dd>
                  </dl>
                  {stats && (
                    <p className="pf-meta" data-testid="real-stats">
                      visited {stats.visitedVertices} · relaxed {stats.relaxedEdges} · heap {stats.heapOps} ·{' '}
                      {stats.elapsedUs.toLocaleString()} µs engine
                    </p>
                  )}
                  {alts.length > 0 && (
                    <ul data-testid="real-alts">
                      {alts.map((a, i) => (
                        <li key={i} data-testid={`real-alt-${i}`}>
                          Alt {i + 1}: {a.arcs.length} segments · {formatMetres(a.distanceM)} ·{' '}
                          {formatSeconds(a.timeS)} (est.)
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <div data-testid="real-unreachable">
                  <h2>No route</h2>
                  <p>{result.reason || 'Destination unreachable on the directed real graph.'}</p>
                  <p className="pf-meta">One-way streets and bbox edges can disconnect pairs that look close.</p>
                </div>
              )}
            </section>
          )}
          <SourceBadge meta={REAL_META} />
        </div>
      </div>
    </div>
  );
}
