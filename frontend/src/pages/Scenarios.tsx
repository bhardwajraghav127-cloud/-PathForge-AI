// Scenario Comparison (M9): snapshot the current traffic overlay as a named
// what-if, persist it, and compare normal vs saved scenarios with the genuine
// scenario.compare engine command. Snapshots are immutable deep copies.
import { useState } from 'react';
import { z } from 'zod';
import TrafficPanel from '../components/TrafficPanel';
import { engineClient, useEngineStatus } from '../engine/client';
import { EngineError } from '../engine/EngineClient';
import { formatSeconds, networkPayload } from '../data/dataset';
import { useScenarios } from '../scenarios';
import { useTraffic } from '../traffic';

const CmpSchema = z.object({
  results: z.array(z.object({
    scenarioId: z.string(),
    overlayVersion: z.number().catch(0),
    route: z.object({
      found: z.boolean(), timeS: z.number().catch(0), distanceM: z.number().catch(0),
      tollInr: z.number().catch(0),
      arcs: z.array(z.object({ arcId: z.string() })).catch([]),
    }),
    deltasVsFirst: z.object({
      timeDeltaS: z.number().catch(0), distanceDeltaM: z.number().catch(0),
      tollDeltaInr: z.number().catch(0),
    }).nullable().catch(null),
  })).catch([]),
}).passthrough();

export default function Scenarios() {
  const engineStatus = useEngineStatus();
  const { scenarios, save, remove } = useScenarios();
  const overlayOf = useTraffic((s) => s.overlay);
  const [name, setName] = useState('congested');
  const [rows, setRows] = useState<z.infer<typeof CmpSchema>['results']>([]);
  const [phase, setPhase] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');

  function snapshot() {
    save(name || `scenario-${scenarios.length + 1}`, overlayOf());
  }

  async function compare() {
    setPhase('working');
    setError('');
    try {
      const o = await engineClient.call('scenario.compare', {
        network: networkPayload(),
        query: { source: 'chandigarh', target: 'delhi', objective: 'FASTEST', algorithm: 'DIJKSTRA' },
        scenarios: [{ id: 'normal', overlay: { version: 1 } },
          ...scenarios.map((s) => ({ id: s.name, overlay: s.overlay }))],
      }, { channel: 'scenarios' });
      if (o.stale) return;
      setRows(CmpSchema.parse(o.result).results);
      setPhase('done');
    } catch (e) {
      setError(e instanceof EngineError ? `${e.code}: ${e.message}` : String(e));
      setPhase('error');
    }
  }

  return (
    <div className="pf-workspace">
      <div className="pf-panel">
        <section className="pf-card" aria-label="What-if scenarios">
          <h2>Scenario Comparison</h2>
          <p className="pf-meta" data-testid="engine-status">Engine: {engineStatus}</p>
          <p className="pf-meta">Query: Chandigarh → Delhi, FASTEST. Normal = clean overlay v1.</p>
          <div className="pf-row">
            <div className="pf-field">
              <label htmlFor="scenario-name">Snapshot name</label>
              <input id="scenario-name" value={name} onChange={(e) => setName(e.target.value)} data-testid="scenario-name" />
            </div>
            <button className="pf-btn" onClick={snapshot} data-testid="scenario-save">Save current traffic</button>
            <button className="pf-btn primary" onClick={() => void compare()} disabled={phase === 'working'} data-testid="scenario-compare">
              {phase === 'working' ? 'Comparing…' : 'Compare scenarios'}
            </button>
          </div>
          {phase === 'error' && <div className="pf-alert error" role="alert" data-testid="scenario-error">{error}</div>}
        </section>

        <section className="pf-card" aria-label="Saved scenarios">
          <h2>Saved ({scenarios.length})</h2>
          <ul data-testid="scenario-list">
            {scenarios.map((s) => (
              <li key={s.id} data-testid={`scenario-${s.id}`}>
                {s.name} · overlay v{s.overlay.version}{' '}
                <button className="pf-btn" onClick={() => remove(s.id)} data-testid={`scenario-remove-${s.id}`}>Remove</button>
              </li>
            ))}
          </ul>
        </section>

        {phase === 'done' && (
          <section className="pf-card" aria-label="Comparison results" data-testid="scenario-results">
            <h2>Results</h2>
            <ul>
              {rows.map((r) => (
                <li key={r.scenarioId} data-testid={`scenario-row-${r.scenarioId}`}>
                  {r.scenarioId}: {r.route.found ? formatSeconds(r.route.timeS) : 'unreachable'}
                  {` (${r.route.timeS} s, ${r.route.distanceM} m)`}
                  {r.deltasVsFirst && ` · Δ +${r.deltasVsFirst.timeDeltaS}s / +${r.deltasVsFirst.distanceDeltaM}m`}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <div className="pf-panel">
        <TrafficPanel />
      </div>
    </div>
  );
}
