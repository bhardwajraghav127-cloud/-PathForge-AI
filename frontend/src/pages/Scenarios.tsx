// Scenario Comparison (U6): what-if cards with summary stats, visual delta
// chart, load/duplicate/delete, JSON export, expandable results, and map
// preview of any scenario. All numbers come from scenario.compare.
import { useState } from 'react';
import { z } from 'zod';
import MapView from '../components/MapView';
import TrafficPanel from '../components/TrafficPanel';
import VivaCard from '../components/VivaCard';
import { Confirm, EmptyState, useToasts } from '../components/ui';
import { engineClient, useEngineStatus } from '../engine/client';
import { EngineError } from '../engine/EngineClient';
import { formatMetres, formatSeconds, networkPayload } from '../data/dataset';
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

type CmpRow = z.infer<typeof CmpSchema>['results'][number];

export default function Scenarios() {
  const engineStatus = useEngineStatus();
  const pushToast = useToasts((s) => s.push);
  const { scenarios, save, remove } = useScenarios();
  const overlayOf = useTraffic((s) => s.overlay);
  const loadSnapshot = useTraffic((s) => s.loadSnapshot);
  const [name, setName] = useState('congested');
  const [rows, setRows] = useState<CmpRow[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');

  function snapshot() {
    save(name || `scenario-${scenarios.length + 1}`, overlayOf());
    pushToast(`Snapshot “${name}” saved`);
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
      const results = CmpSchema.parse(o.result).results;
      setRows(results);
      setPreview(null);
      setPhase('done');
      pushToast(`Compared ${results.length} scenarios`);
    } catch (e) {
      const msg = e instanceof EngineError ? `${e.code}: ${e.message}` : String(e);
      setError(msg);
      setPhase('error');
      pushToast(msg, 'error');
    }
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify({ query: 'chandigarh→delhi FASTEST', rows }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'scenario-compare.json';
    a.click();
    URL.revokeObjectURL(url);
    pushToast('Comparison exported as JSON');
  }

  const previewRow = rows.find((r) => r.scenarioId === preview);
  const previewArcs = previewRow?.route.arcs.map((a) => a.arcId) ?? [];
  const maxTime = Math.max(1, ...rows.map((r) => r.route.timeS));
  const maxDist = Math.max(1, ...rows.map((r) => r.route.distanceM));
  const pendingDelete = scenarios.find((s) => s.id === confirmDelete);
  const [panelHidden, setPanelHidden] = useState(false);

  return (
    <div>
      <button className="pf-btn small pf-panel-toggle" data-testid="panel-toggle"
        aria-expanded={!panelHidden} onClick={() => setPanelHidden(!panelHidden)}>
        {panelHidden ? 'Show panel' : 'Hide panel'}
      </button>
      <div className={`pf-workspace${panelHidden ? ' panel-hidden' : ''}`}>
        <div className="pf-map-wrap">
          <MapView routeArcIds={previewArcs} originId="chandigarh" destId="delhi"
            statsExtra={preview ? `preview: ${preview}` : 'select a scenario to preview'} />
        </div>
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
            {scenarios.length === 0 ? (
              <EmptyState title="No snapshots yet"
                hint="Edit traffic on any page, then save it here as a named what-if."
                testid="scenario-empty" />
            ) : (
              <div data-testid="scenario-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {scenarios.map((s) => (
                  <div key={s.id} className="pf-card" data-testid={`scenario-${s.id}`} style={{ padding: 10 }}>
                    <p><strong>{s.name}</strong> <span className="pf-meta">· overlay v{s.overlay.version}</span></p>
                    <p className="pf-meta">
                      {s.overlay.incidents.length} incident(s) · {Object.keys(s.overlay.factors).length} factor(s) · {s.overlay.closures.length} closure(s)
                    </p>
                    <div className="pf-row">
                      <button className="pf-btn small" data-testid={`scenario-load-${s.id}`}
                        onClick={() => { loadSnapshot(s.overlay); pushToast(`Loaded “${s.name}” into the traffic editor`); }}>
                        Load into traffic
                      </button>
                      <button className="pf-btn small" data-testid={`scenario-duplicate-${s.id}`}
                        onClick={() => { save(`${s.name} (copy)`, s.overlay); pushToast(`Duplicated as “${s.name} (copy)”`); }}>
                        Duplicate
                      </button>
                      <button className="pf-btn small danger" data-testid={`scenario-remove-${s.id}`}
                        onClick={() => setConfirmDelete(s.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {phase === 'done' && (
            <section className="pf-card" aria-label="Comparison results" data-testid="scenario-results">
              <h2>Results</h2>
              <div data-testid="scenario-chart" role="img" aria-label="Time and distance bars per scenario">
                {rows.map((r) => (
                  <div key={r.scenarioId} style={{ marginBottom: 6 }}>
                    <div className="pf-meta">{r.scenarioId}</div>
                    <div style={{ height: 10, borderRadius: 5, background: 'var(--pf-paper-sink)' }} title={`time ${r.route.timeS}s`}>
                      <div style={{ width: `${(r.route.timeS / maxTime) * 100}%`, height: '100%', borderRadius: 5, background: 'var(--pf-route)' }} />
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: 'var(--pf-paper-sink)', marginTop: 2 }} title={`distance ${r.route.distanceM}m`}>
                      <div style={{ width: `${(r.route.distanceM / maxDist) * 100}%`, height: '100%', borderRadius: 3, background: 'var(--pf-accent)' }} />
                    </div>
                  </div>
                ))}
              </div>
              <ul>
                {rows.map((r) => (
                  <li key={r.scenarioId} data-testid={`scenario-row-${r.scenarioId}`}>
                    {r.scenarioId}: {r.route.found ? formatSeconds(r.route.timeS) : 'unreachable'}
                    {` (${r.route.timeS} s, ${r.route.distanceM} m)`}
                    {r.deltasVsFirst && ` · Δ +${r.deltasVsFirst.timeDeltaS}s / +${r.deltasVsFirst.distanceDeltaM}m`}
                    <div className="pf-row">
                      <button className="pf-btn small" data-testid={`scenario-preview-${r.scenarioId}`}
                        onClick={() => setPreview((p) => (p === r.scenarioId ? null : r.scenarioId))}
                        aria-pressed={preview === r.scenarioId}>
                        {preview === r.scenarioId ? 'Hide preview' : 'Show on map'}
                      </button>
                      <button className="pf-btn small" data-testid={`scenario-expand-${r.scenarioId}`}
                        onClick={() => setExpanded((e) => (e === r.scenarioId ? null : r.scenarioId))}
                        aria-expanded={expanded === r.scenarioId}>
                        {expanded === r.scenarioId ? 'Hide arcs' : 'Show arcs'}
                      </button>
                    </div>
                    {expanded === r.scenarioId && (
                      <p className="pf-meta" data-testid={`scenario-arcs-${r.scenarioId}`}>
                        {r.route.arcs.length} arcs: <code>{r.route.arcs.map((a) => a.arcId).join(' ')}</code>
                        {' '}· {formatMetres(r.route.distanceM)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              <div className="pf-row">
                <button className="pf-btn small" data-testid="scenario-export" onClick={exportJson}>Export JSON</button>
              </div>
            </section>
          )}

          <TrafficPanel />
          <VivaCard page="scenarios" />
        </div>
      </div>
      <Confirm open={confirmDelete !== null} title="Delete snapshot?"
        body={pendingDelete ? `“${pendingDelete.name}” will be removed. This cannot be undone.` : ''}
        confirmLabel="Delete" testid="scenario-delete"
        onConfirm={() => { if (confirmDelete) remove(confirmDelete); setConfirmDelete(null); pushToast('Snapshot deleted'); }}
        onCancel={() => setConfirmDelete(null)} />
    </div>
  );
}
