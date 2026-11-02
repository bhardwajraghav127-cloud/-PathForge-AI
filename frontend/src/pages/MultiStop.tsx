// Multi-Stop Planner (U6): stop editor with drag reorder, numbered map
// markers, leg details, saved tours, and unreachable recovery. The tour
// order and all timings come from route.multistop (Held-Karp).
import { useState } from 'react';
import { z } from 'zod';
import MapView from '../components/MapView';
import { Chip, EmptyState, useToasts } from '../components/ui';
import { engineClient, useEngineStatus } from '../engine/client';
import { EngineError } from '../engine/EngineClient';
import { VERTICES, formatInr, formatMetres, formatSeconds, networkPayload, vertexName } from '../data/dataset';
import { useTours } from '../tours';

const LegSchema = z.object({
  from: z.string(), to: z.string(),
  route: z.object({
    found: z.boolean(), timeS: z.number().catch(0), distanceM: z.number().catch(0),
    arcs: z.array(z.object({ arcId: z.string(), from: z.string(), to: z.string() })).catch([]),
  }),
});
const MultistopSchema = z.object({
  found: z.boolean(), reason: z.string().catch(''),
  order: z.array(z.string()).catch([]), legs: z.array(LegSchema).catch([]),
  totalTimeS: z.number().catch(0), totalDistanceM: z.number().catch(0),
  totalTollInr: z.number().catch(0), optimal: z.boolean().catch(false),
  method: z.string().catch(''),
}).passthrough();

const DEFAULT_STOPS = ['delhi', 'chandigarh', 'karnal', 'ambala'];

interface StopRow { id: string }

export default function MultiStop() {
  const engineStatus = useEngineStatus();
  const pushToast = useToasts((s) => s.push);
  const tours = useTours((s) => s.tours);
  const saveTour = useTours((s) => s.save);
  const removeTour = useTours((s) => s.remove);
  const [stops, setStops] = useState<StopRow[]>(DEFAULT_STOPS.map((id) => ({ id })));
  const [pick, setPick] = useState('zirakpur');
  const [startId, setStartId] = useState('delhi');
  const [endId, setEndId] = useState('');
  const [tourName, setTourName] = useState('');
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [phase, setPhase] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<z.infer<typeof MultistopSchema> | null>(null);
  const [error, setError] = useState('');

  function move(i: number, d: number) {
    setStops((s) => {
      const j = i + d;
      if (j < 0 || j >= s.length) return s;
      const c = [...s];
      const a = c[i] as StopRow;
      c[i] = c[j] as StopRow;
      c[j] = a;
      return c;
    });
  }

  function dropAt(i: number) {
    if (dragIdx === null || dragIdx === i) {
      setDragIdx(null);
      return;
    }
    setStops((s) => {
      const c = [...s];
      const [moved] = c.splice(dragIdx, 1) as StopRow[];
      c.splice(i, 0, moved as StopRow);
      return c;
    });
    setDragIdx(null);
  }

  async function optimize() {
    setPhase('working');
    setError('');
    setResult(null);
    try {
      const payload: Record<string, unknown> = {
        network: networkPayload(), stops: stops.map((s) => s.id),
        exactUpTo: 10, allowHeuristic: true,
      };
      if (startId) payload['start'] = startId;
      if (endId) payload['end'] = endId;
      const o = await engineClient.call('route.multistop', payload, { channel: 'multistop' });
      if (o.stale) return;
      const r = MultistopSchema.parse(o.result);
      setResult(r);
      setPhase('done');
      if (r.found) pushToast(`Tour optimized: ${r.optimal ? 'OPTIMAL' : r.method}, ${formatSeconds(r.totalTimeS)}`);
      else pushToast(`No tour: ${r.reason}`, 'error');
    } catch (e) {
      const msg = e instanceof EngineError ? `${e.code}: ${e.message}` : String(e);
      setError(msg);
      setPhase('error');
      pushToast(msg, 'error');
    }
  }

  const legArcs = result?.legs.flatMap((l) => l.route.arcs.map((a) => a.arcId)) ?? [];
  const markerOrder = result?.found ? result.order : stops.map((s) => s.id);

  return (
    <div>
      <div className="pf-workspace">
        <div className="pf-map-wrap">
          <MapView routeArcIds={legArcs} stopIds={stops.map((s) => s.id)} stopOrder={markerOrder}
            statsExtra={result?.found ? `${result.order.length} stops` : `${stops.length} stops`} />
        </div>
        <div className="pf-panel">
          <section className="pf-card" aria-label="Stop list">
            <h2>Multi-Stop Planner</h2>
            <p className="pf-meta" data-testid="engine-status">Engine: {engineStatus}</p>
            <div className="pf-row">
              <div className="pf-field">
                <label htmlFor="stop-pick">Add stop</label>
                <select id="stop-pick" value={pick} onChange={(e) => setPick(e.target.value)} data-testid="stop-pick">
                  {VERTICES.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              <button className="pf-btn" onClick={() => setStops((s) => [...s, { id: pick }])} data-testid="stop-add">Add</button>
            </div>
            {stops.length === 0 ? (
              <EmptyState title="No stops" hint="Add at least two stops to optimize a tour." testid="stops-empty" />
            ) : (
              <ol data-testid="stop-list">
                {stops.map((s, i) => (
                  <li key={`${s.id}-${i}`} data-testid={`stop-${i}`}
                    draggable
                    onDragStart={() => setDragIdx(i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => dropAt(i)}
                    onDragEnd={() => setDragIdx(null)}
                    style={{ cursor: 'grab' }}>
                    <span className="pf-chip">{i + 1}</span> {vertexName(s.id)}{' '}
                    <button className="pf-btn small" onClick={() => move(i, -1)} data-testid={`stop-up-${i}`} aria-label={`move ${s.id} up`}>↑</button>
                    <button className="pf-btn small" onClick={() => move(i, 1)} data-testid={`stop-down-${i}`} aria-label={`move ${s.id} down`}>↓</button>
                    <button className="pf-btn small" onClick={() => setStops((cur) => cur.filter((_, j) => j !== i))} data-testid={`stop-remove-${i}`}>Remove</button>
                  </li>
                ))}
              </ol>
            )}
            <div className="pf-row">
              <div className="pf-field">
                <label htmlFor="stop-start">Start</label>
                <select id="stop-start" value={startId} onChange={(e) => setStartId(e.target.value)} data-testid="stop-start">
                  {stops.map((s) => <option key={s.id} value={s.id}>{vertexName(s.id)}</option>)}
                </select>
              </div>
              <div className="pf-field">
                <label htmlFor="stop-end">End (optional)</label>
                <select id="stop-end" value={endId} onChange={(e) => setEndId(e.target.value)} data-testid="stop-end">
                  <option value="">— open tour —</option>
                  {stops.map((s) => <option key={s.id} value={s.id}>{vertexName(s.id)}</option>)}
                </select>
              </div>
            </div>
            <button className="pf-btn primary" onClick={() => void optimize()} disabled={phase === 'working' || stops.length < 2} data-testid="stops-optimize">
              {phase === 'working' ? 'Optimizing…' : 'Optimize Stops'}
            </button>
            {phase === 'error' && <div className="pf-alert error" role="alert" data-testid="stops-error">{error}</div>}
            <h3>Saved tours</h3>
            <div className="pf-row">
              <div className="pf-field">
                <label htmlFor="tour-name">Save current as</label>
                <input id="tour-name" value={tourName} onChange={(e) => setTourName(e.target.value)} data-testid="tour-name" />
              </div>
              <button className="pf-btn small" data-testid="tour-save"
                onClick={() => {
                  if (!tourName.trim()) return;
                  saveTour(tourName.trim(), stops.map((s) => s.id), startId, endId);
                  pushToast(`Saved tour “${tourName.trim()}”`);
                  setTourName('');
                }}>
                Save tour
              </button>
            </div>
            {tours.length > 0 && (
              <ul data-testid="tour-list">
                {tours.map((t) => (
                  <li key={t.id} data-testid={`tour-${t.id}`}>
                    {t.name} ({t.stops.length} stops){' '}
                    <button className="pf-btn small" data-testid={`tour-apply-${t.id}`}
                      onClick={() => {
                        setStops(t.stops.map((id) => ({ id })));
                        setStartId(t.start);
                        setEndId(t.end);
                        pushToast(`Loaded tour “${t.name}”`);
                      }}>
                      Load
                    </button>{' '}
                    <button className="pf-btn small" data-testid={`tour-delete-${t.id}`}
                      onClick={() => removeTour(t.id)}>
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {phase === 'done' && result?.found && (
            <section className="pf-card" aria-label="Optimized tour" data-testid="multistop-result">
              <h2>Optimized tour</h2>
              <p className="pf-meta" data-testid="multistop-method">
                {result.optimal ? 'OPTIMAL' : 'heuristic'} · {result.method}
              </p>
              <p data-testid="multistop-order">Order: {result.order.map(vertexName).join(' → ')}</p>
              <dl className="pf-facts">
                <dt>Total time</dt><dd data-testid="multistop-time">{formatSeconds(result.totalTimeS)} ({result.totalTimeS} s)</dd>
                <dt>Total distance</dt><dd data-testid="multistop-dist">{formatMetres(result.totalDistanceM)} ({result.totalDistanceM} m)</dd>
                <dt>Total toll</dt><dd data-testid="multistop-toll">{formatInr(result.totalTollInr)} ({result.totalTollInr})</dd>
              </dl>
              <ol>
                {result.legs.map((l, i) => (
                  <li key={i} data-testid={`multistop-leg-${i}`}>
                    <span className="pf-chip">{i + 1}</span>{' '}
                    {vertexName(l.from)} → {vertexName(l.to)}: {formatSeconds(l.route.timeS)},
                    {l.route.arcs.length} arcs <code>{l.route.arcs.map((a) => a.arcId).join(' ')}</code>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {phase === 'done' && result && !result.found && (
            <div className="pf-alert error" role="alert" data-testid="multistop-unreachable">
              No tour: {result.reason}. Some stop pair is disconnected under current traffic.
              <div className="pf-row" style={{ marginTop: 8 }}>
                <button className="pf-btn small" data-testid="stops-drop-last"
                  onClick={() => {
                    setStops((s) => s.slice(0, -1));
                    pushToast('Removed the last stop — press Optimize to retry');
                  }}>
                  Remove last stop
                </button>
                <button className="pf-btn small" data-testid="stops-reset-defaults"
                  onClick={() => {
                    setStops(DEFAULT_STOPS.map((id) => ({ id })));
                    setStartId('delhi');
                    setEndId('');
                  }}>
                  Reset to defaults
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
