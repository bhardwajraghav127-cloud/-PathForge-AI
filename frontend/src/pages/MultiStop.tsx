// Multi-Stop Planner (M9): build a stop list, pin start/end, and optimize with
// the genuine Held-Karp engine (route.multistop). All order/timing facts render
// from the engine response.
import { useState } from 'react';
import { z } from 'zod';
import MapView from '../components/MapView';
import { engineClient, useEngineStatus } from '../engine/client';
import { EngineError } from '../engine/EngineClient';
import { VERTICES, formatInr, formatMetres, formatSeconds, networkPayload, vertexName } from '../data/dataset';

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

interface StopRow { id: string }

export default function MultiStop() {
  const engineStatus = useEngineStatus();
  const [stops, setStops] = useState<StopRow[]>([
    { id: 'delhi' }, { id: 'chandigarh' }, { id: 'karnal' }, { id: 'ambala' },
  ]);
  const [pick, setPick] = useState('zirakpur');
  const [startId, setStartId] = useState('delhi');
  const [endId, setEndId] = useState('');
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
    } catch (e) {
      setError(e instanceof EngineError ? `${e.code}: ${e.message}` : String(e));
      setPhase('error');
    }
  }

  const legArcs = result?.legs.flatMap((l) => l.route.arcs.map((a) => a.arcId)) ?? [];

  return (
    <div>
      <div className="pf-workspace">
        <div className="pf-map-wrap">
          <MapView routeArcIds={legArcs} />
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
            <ol data-testid="stop-list">
              {stops.map((s, i) => (
                <li key={`${s.id}-${i}`} data-testid={`stop-${i}`}>
                  {vertexName(s.id)}{' '}
                  <button className="pf-btn" onClick={() => move(i, -1)} data-testid={`stop-up-${i}`} aria-label={`move ${s.id} up`}>↑</button>
                  <button className="pf-btn" onClick={() => move(i, 1)} data-testid={`stop-down-${i}`} aria-label={`move ${s.id} down`}>↓</button>
                  <button className="pf-btn" onClick={() => setStops((cur) => cur.filter((_, j) => j !== i))} data-testid={`stop-remove-${i}`}>Remove</button>
                </li>
              ))}
            </ol>
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
                    {vertexName(l.from)} → {vertexName(l.to)}: {formatSeconds(l.route.timeS)},
                    {l.route.arcs.length} arcs <code>{l.route.arcs.map((a) => a.arcId).join(' ')}</code>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {phase === 'done' && result && !result.found && (
            <div className="pf-alert error" role="alert" data-testid="multistop-unreachable">
              No tour: {result.reason}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
