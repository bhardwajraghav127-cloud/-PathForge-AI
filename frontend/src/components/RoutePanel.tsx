// Route planner panel (U4): searchable O/D, swap, My Places, tabbed results
// (Overview / Steps / Compare / Why). All numbers come from the WASM engine.
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { engineClient, useEngineStatus } from '../engine/client';
import { EngineError } from '../engine/EngineClient';
import { VERTICES, formatInr, formatMetres, formatSeconds, networkPayload, vertexName } from '../data/dataset';
import { usePlaces } from '../places';
import ExplainDrawer from '../explain/ExplainDrawer';
import { useRoute, type AltRoute, type CompareDelta, type RouteFacts } from '../store';
import { useTraffic } from '../traffic';
import { Chip, SearchSelect, Tabs, useToasts } from './ui';

const OBJECTIVES = ['FASTEST', 'SHORTEST', 'LOWEST_TOLL', 'AVOID_CONGESTION', 'BALANCED'];

const RouteResultSchema = z
  .object({
    found: z.boolean(),
    reason: z.string().catch(''),
    arcs: z.array(z.object({ arcId: z.string(), roadId: z.string(), from: z.string(), to: z.string() })).catch([]),
    vertices: z.array(z.string()).catch([]),
    distanceM: z.number().catch(0),
    baselineTimeS: z.number().catch(0),
    timeS: z.number().catch(0),
    delayS: z.number().catch(0),
    tollInr: z.number().catch(0),
    objectiveCost: z.number().catch(0),
    objectiveDescription: z.string().catch(''),
  })
  .passthrough();

const AltsSchema = z.object({
  best: RouteResultSchema,
  alternatives: z.array(RouteResultSchema).catch([]),
});

const CompareSchema = z.object({
  comparisons: z
    .array(z.object({ id: z.string(), incidentIds: z.array(z.string()).catch([]) }).passthrough())
    .catch([]),
  deltas: z
    .array(
      z.object({
        uniqueArcs: z.array(z.string()).catch([]),
        timeDeltaS: z.number().nullable().catch(null),
        distanceDeltaM: z.number().nullable().catch(null),
        tollDeltaInr: z.number().nullable().catch(null),
      }),
    )
    .catch([]),
  sharedArcs: z.array(z.string()).catch([]),
});

const VERTEX_OPTIONS = VERTICES.map((v) => ({ id: v.id, label: `${v.name} (${v.id})` }));

export default function RoutePanel() {
  const engineStatus = useEngineStatus();
  const route = useRoute();
  const planner = useRoute((s) => s.planner);
  const setPlanner = useRoute((s) => s.setPlanner);
  const trafficVersion = useTraffic((s) => s.version);
  const overlayOf = useTraffic((s) => s.overlay);
  const places = usePlaces((s) => s.places);
  const savePlace = usePlaces((s) => s.save);
  const removePlace = usePlaces((s) => s.remove);
  const pushToast = useToasts((s) => s.push);
  const [placeName, setPlaceName] = useState('');
  const [tab, setTab] = useState('overview');
  const [showWhy, setShowWhy] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const lastVersion = useRef(1);
  const inFlight = useRef(false);
  const { phase, params, facts, error } = route;

  async function compute(ovVersion: number) {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const overlay = overlayOf();
      const { source, target, objective } = useRoute.getState().planner;
      const base = { network: networkPayload(), overlay, source, target, objective };
      const o = await engineClient.call('route.find', { ...base, algorithm: 'DIJKSTRA' }, { channel: 'route' });
      if (o.stale) return;
      const found = RouteResultSchema.parse(o.result) as RouteFacts;
      if (lastVersion.current !== ovVersion) return;
      route.succeed(found);
      if (found.found) {
        pushToast(`Route found: ${found.arcs.length} segments, ${formatSeconds(found.timeS)}`);
        const ao = await engineClient.call(
          'route.alternatives',
          { ...base, maxCandidates: 10, maxAlternatives: 3 },
          { channel: 'alts' },
        );
        if (!ao.stale && lastVersion.current === ovVersion) {
          const parsed = AltsSchema.parse(ao.result);
          const alts = (parsed.alternatives as RouteFacts[]).map((a, i) => ({ ...a, altId: `alt${i}` }) as AltRoute);
          const plans = [
            { id: 'best', arcs: found.arcs.map((a) => a.arcId) },
            ...alts.filter((a) => a.found).map((a) => ({ id: a.altId, arcs: a.arcs.map((x) => x.arcId) })),
          ];
          let deltas: CompareDelta[] = [];
          let shared: string[] = [];
          if (plans.length > 1) {
            const co = await engineClient.call(
              'route.compare',
              { network: networkPayload(), overlay, objective, plans },
              { channel: 'compare' },
            );
            if (!co.stale && lastVersion.current === ovVersion) {
              const cp = CompareSchema.parse(co.result);
              const incById = new Map(cp.comparisons.map((c) => [c.id, c.incidentIds]));
              deltas = plans.map((p, i) => ({
                id: p.id,
                timeDeltaS: cp.deltas[i]?.timeDeltaS ?? null,
                distanceDeltaM: cp.deltas[i]?.distanceDeltaM ?? null,
                tollDeltaInr: cp.deltas[i]?.tollDeltaInr ?? null,
                uniqueArcs: cp.deltas[i]?.uniqueArcs ?? [],
                incidentIds: incById.get(p.id) ?? [],
              }));
              shared = cp.sharedArcs;
            }
          }
          if (lastVersion.current === ovVersion) route.setExtras(alts, deltas, shared);
        }
      } else {
        pushToast(`No route: ${found.reason || 'unreachable'}`, 'error');
      }
    } catch (e) {
      if (lastVersion.current === ovVersion) {
        const msg = e instanceof EngineError ? `${e.code}: ${e.message}` : String(e);
        route.fail(msg);
        pushToast(msg, 'error');
      }
    } finally {
      inFlight.current = false;
    }
  }

  async function find() {
    lastVersion.current = trafficVersion;
    route.begin({ ...planner });
    await compute(trafficVersion);
  }

  useEffect(() => {
    if (phase !== 'found' || !params) return;
    if (trafficVersion === lastVersion.current) return;
    lastVersion.current = trafficVersion;
    void compute(trafficVersion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trafficVersion]);

  const busy = phase === 'calculating' || engineStatus === 'loading';
  const displayed: RouteFacts | null = route.selectedAlt
    ? (route.alternatives.find((a) => a.altId === route.selectedAlt) ?? facts)
    : facts;
  const bestDelta = route.comparison.find((c) => c.id === 'best');
  const slowest = route.alternatives.filter((a) => a.found).map((a) => a.timeS).reduce((m, t) => Math.max(m, t), 0);

  return (
    <div className="pf-panel">
      <section className="pf-card" aria-label="Route inputs">
        <h2>Plan a route</h2>
        <SearchSelect id="origin" label="Origin" options={VERTEX_OPTIONS} value={planner.source}
          onPick={(id) => setPlanner({ source: id })} testid="origin" />
        <div className="pf-row">
          <button className="pf-btn small" data-testid="od-swap"
            onClick={() => setPlanner({ source: planner.target, target: planner.source })}
            aria-label="Swap origin and destination">
            ⇅ Swap
          </button>
          <span className="pf-meta">Tip: tap any city on the map to set origin or destination.</span>
          <button className="pf-btn small" data-testid="emergency-preset"
            onClick={() => {
              setPlanner({ source: 'ambala', target: 'delhi', objective: 'FASTEST' });
              pushToast('Emergency drill: fastest Ambala→Delhi, incident-aware. SIMULATED — not real dispatch.');
            }}>
            Emergency drill
          </button>
        </div>
        <SearchSelect id="destination" label="Destination" options={VERTEX_OPTIONS} value={planner.target}
          onPick={(id) => setPlanner({ target: id })} testid="destination" />
        <div className="pf-field">
          <label htmlFor="objective">Objective</label>
          <select id="objective" value={planner.objective} onChange={(e) => setPlanner({ objective: e.target.value })} data-testid="objective">
            {OBJECTIVES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div className="pf-row">
          <button className="pf-btn primary" onClick={() => void find()} disabled={busy} data-testid="find-route">
            {phase === 'calculating' ? 'Calculating…' : 'Find Best Route'}
          </button>
        </div>
        <p className="pf-meta" data-testid="engine-status">Engine: {engineStatus}</p>
        <h3>My Places</h3>
        <div className="pf-row">
          <div className="pf-field">
            <label htmlFor="place-name">Save current pair as</label>
            <input id="place-name" value={placeName} onChange={(e) => setPlaceName(e.target.value)}
              placeholder="e.g. Daily commute" data-testid="places-name" />
          </div>
          <button className="pf-btn small" data-testid="places-save"
            onClick={() => {
              if (!placeName.trim()) return;
              savePlace(placeName.trim(), planner.source, planner.target);
              pushToast(`Saved “${placeName.trim()}”`);
              setPlaceName('');
            }}>
            Save
          </button>
        </div>
        {places.length > 0 && (
          <ul data-testid="places-list">
            {places.map((p) => (
              <li key={p.id} data-testid={`places-${p.id}`}>
                {p.name}: {vertexName(p.source)} → {vertexName(p.target)}{' '}
                <button className="pf-btn small" data-testid={`places-apply-${p.id}`}
                  onClick={() => { setPlanner({ source: p.source, target: p.target }); pushToast(`Loaded “${p.name}”`); }}>
                  Apply
                </button>{' '}
                <button className="pf-btn small" data-testid={`places-delete-${p.id}`}
                  onClick={() => { removePlace(p.id); pushToast(`Removed “${p.name}”`); }}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {phase === 'found' && displayed && (
        <section className="pf-card" aria-label="Route result" data-testid="route-result">
          <h2>{route.selectedAlt ? `Alternative ${route.selectedAlt}` : 'Best route'}</h2>
          <Tabs testid="planner-tabs" value={tab} onChange={setTab}
            tabs={[
              { id: 'overview', label: 'Overview' },
              { id: 'steps', label: `Steps (${displayed.arcs.length})` },
              { id: 'compare', label: 'Compare' },
              { id: 'why', label: 'Why' },
            ]} />
          {tab === 'overview' && (
            <div data-testid="planner-tab-overview">
              <p className="pf-meta">{displayed.objectiveDescription}</p>
              <dl className="pf-facts">
                <dt>Distance</dt><dd data-testid="fact-distance">{formatMetres(displayed.distanceM)} ({displayed.distanceM} m)</dd>
                <dt>Time</dt><dd data-testid="fact-time">{formatSeconds(displayed.timeS)} ({displayed.timeS} s)</dd>
                <dt>Toll</dt><dd data-testid="fact-toll">{formatInr(displayed.tollInr)} ({displayed.tollInr})</dd>
                <dt>Traffic delay</dt><dd data-testid="fact-delay">{formatSeconds(displayed.delayS)} ({displayed.delayS} s)</dd>
              </dl>
              <h3>Route insights</h3>
              <ul data-testid="route-insights">
                {facts && slowest > facts.timeS && (
                  <li>Best is {Math.round(((slowest - facts.timeS) / slowest) * 100)}% faster than the slowest alternative.</li>
                )}
                {facts && facts.tollInr === 0 && <li>Toll-free route.</li>}
                {bestDelta && bestDelta.incidentIds.length > 0 && (
                  <li>{bestDelta.incidentIds.length} incident(s) affect this route: {bestDelta.incidentIds.join(', ')}.</li>
                )}
                {facts && facts.delayS > 0 && (
                  <li>Traffic adds {Math.round((facts.delayS / facts.timeS) * 100)}% to the free-flow time.</li>
                )}
                {route.sharedArcs.length > 0 && (
                  <li>{route.sharedArcs.length} arc(s) shared across all compared plans.</li>
                )}
              </ul>
            </div>
          )}
          {tab === 'steps' && (
            <ol className="pf-steps" data-testid="route-steps">
              {displayed.arcs.map((a) => (
                <li key={a.arcId} data-arc={a.arcId}>
                  {vertexName(a.from)} → {vertexName(a.to)} <code>{a.arcId}</code>
                </li>
              ))}
            </ol>
          )}
          {tab === 'compare' && (
            <div data-testid="planner-tab-compare">
              {facts?.found && route.alternatives.length > 0 ? (
                <div>
                  <ul data-testid="alt-list">
                    <li>
                      <button className="pf-btn" onClick={() => route.selectAlt(null)} data-testid="alt-best">
                        Best ({formatSeconds(facts.timeS)})
                      </button>
                    </li>
                    {route.alternatives.map((a) => (
                      <li key={a.altId}>
                        <button className="pf-btn" onClick={() => route.selectAlt(a.altId)} data-testid={`alt-${a.altId}`}>
                          {a.altId}: {a.found ? formatSeconds(a.timeS) : 'unreachable'}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <table data-testid="compare-table">
                    <caption>Alternatives vs best (engine facts)</caption>
                    <thead>
                      <tr><th scope="col">Plan</th><th scope="col">Time</th><th scope="col">Δ time</th><th scope="col">Δ dist</th><th scope="col">Δ toll</th></tr>
                    </thead>
                    <tbody>
                      {route.comparison.filter((c) => c.id !== 'best').map((c) => {
                        const alt = route.alternatives.find((a) => a.altId === c.id);
                        return (
                          <tr key={c.id}>
                            <th scope="row">{c.id}</th>
                            <td>{alt ? formatSeconds(alt.timeS) : 'n/a'}</td>
                            <td>{c.timeDeltaS === null ? 'n/a' : `+${c.timeDeltaS}s`}</td>
                            <td>{c.distanceDeltaM === null ? 'n/a' : `+${c.distanceDeltaM}m`}</td>
                            <td>{c.tollDeltaInr === null ? 'n/a' : `+₹${c.tollDeltaInr}`}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="pf-meta">No alternatives for this route.</p>
              )}
            </div>
          )}
          {tab === 'why' && (
            <div data-testid="planner-tab-why">
              {route.comparison.length > 0 ? (
                <div>
                  <button className="pf-btn" onClick={() => setShowWhy((v) => !v)} data-testid="why-toggle">
                    {showWhy ? 'Hide explanation' : 'Why This Route?'}
                  </button>
                  {showWhy && (
                    <div data-testid="why-panel">
                      <p data-testid="why-best">
                        Best route costs {facts ? formatSeconds(facts.timeS) : '?'}. Attribution incidents on this
                        route: {(bestDelta?.incidentIds.join(', ') || 'none')}.
                      </p>
                      <ul>
                        {route.comparison.filter((c) => c.id !== 'best').map((c) => (
                          <li key={c.id} data-testid={`why-${c.id}`}>
                            {c.id}: {c.timeDeltaS === null ? 'n/a' : `+${c.timeDeltaS}s vs best`};
                            unique arcs {c.uniqueArcs.length}; incidents {(c.incidentIds.join(', ') || 'none')}
                          </li>
                        ))}
                      </ul>
                      <p className="pf-meta" data-testid="why-shared">
                        {route.sharedArcs.length} shared arc(s) across compared plans.
                      </p>
                      <button className="pf-btn" onClick={() => setExplainOpen(true)} data-testid="why-evidence">
                        Open edge-by-edge evidence
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <p className="pf-meta">Comparison data appears after alternatives load.</p>
              )}
            </div>
          )}
          {route.selectedAlt && <p><Chip tone="info">Showing {route.selectedAlt} — map follows this plan</Chip></p>}
        </section>
      )}

      {phase === 'unreachable' && (
        <div className="pf-alert error" role="alert" data-testid="route-unreachable">
          No route: {error || params?.target} is unreachable under current conditions.
        </div>
      )}
      {phase === 'error' && (
        <div className="pf-alert error" role="alert" data-testid="route-error">{error}</div>
      )}
      {displayed?.found && params && (
        <ExplainDrawer open={explainOpen} onClose={() => setExplainOpen(false)} testid="why"
          source={params.source} target={params.target} objective={params.objective} algorithm="DIJKSTRA"
          arcs={displayed.arcs} vertices={displayed.vertices}
          totals={{ timeS: displayed.timeS, distanceM: displayed.distanceM, tollInr: displayed.tollInr }}
          alternatives={route.alternatives.filter((a) => a.found).map((a) => ({
            label: a.altId, timeS: a.timeS, distanceM: a.distanceM, tollInr: a.tollInr,
            arcs: a.arcs.map((x) => x.arcId),
          }))} />
      )}
    </div>
  );
}
