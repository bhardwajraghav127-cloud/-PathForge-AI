import { Link } from 'react-router-dom';
import MapView from '../components/MapView';
import { Chip, EmptyState, Metric } from '../components/ui';
import { formatInr, formatMetres, formatSeconds, vertexName } from '../data/dataset';
import { useSim } from '../simulation';
import { useNetwork, useRoute } from '../store';
import { useTraffic } from '../traffic';

export function Dashboard() {
  const { vertexCount, roadCount } = useNetwork();
  const facts = useRoute((s) => s.facts);
  const params = useRoute((s) => s.params);
  const incidents = useTraffic((s) => s.incidents);
  const closures = useTraffic((s) => s.closures);
  const version = useTraffic((s) => s.version);
  const simStatus = useSim((s) => s.status);
  const simPos = useSim((s) => s.pos);
  const planArcs = useSim((s) => s.planArcs);
  const history = useSim((s) => s.history);

  const arcIds = facts?.found ? facts.arcs.map((a) => a.arcId) : [];
  const progress = planArcs.length === 0 ? 0
    : Math.min(1, (simPos.arcIdx + simPos.fracPermille / 1000) / planArcs.length);
  const journeyActive = simStatus === 'running' || simStatus === 'paused';

  return (
    <div>
      <h2>Command Center</h2>
      <p data-testid="network-counts">
        Network: {vertexCount} vertices · {roadCount} roads (north-india-sim-v1)
      </p>

      <div className="pf-row" data-testid="dash-ctas" style={{ marginBottom: 12 }}>
        <Link className="pf-btn primary" to="/demo" data-testid="dash-cta-demo">Start Smart Demo</Link>
        <Link className="pf-btn" to="/lab" data-testid="dash-cta-algo">Explore Algorithms</Link>
      </div>

      <div className="pf-metrics" data-testid="dash-metrics">
        <Metric value={String(vertexCount)} label="Cities" testid="dash-metric-cities" />
        <Metric value={String(roadCount)} label="Roads" testid="dash-metric-roads" />
        <Metric value={String(closures.length)} label="Closures" testid="dash-metric-closures" />
        <Metric value={String(incidents.length)} label="Active incidents" testid="dash-metric-incidents" />
      </div>

      <div className="pf-workspace" style={{ marginTop: 16 }}>
        <div className="pf-map-wrap">
          <MapView routeArcIds={arcIds} originId={params?.source ?? null} destId={params?.target ?? null}
            statsExtra={facts?.found ? `${facts.arcs.length} arcs on route` : 'no route'} />
        </div>
        <div className="pf-panel">
          <section className="pf-card" aria-label="Current route" data-testid="dash-route-summary">
            <h2>Current route</h2>
            {facts?.found && params ? (
              <div>
                <p>
                  <strong>{vertexName(params.source)} → {vertexName(params.target)}</strong>{' '}
                  <Chip tone="ok" testid="dash-route-chip">{facts.arcs.length} segments</Chip>
                </p>
                <dl className="pf-facts">
                  <dt>Time</dt><dd>{formatSeconds(facts.timeS)}</dd>
                  <dt>Distance</dt><dd>{formatMetres(facts.distanceM)}</dd>
                  <dt>Toll</dt><dd>{formatInr(facts.tollInr)}</dd>
                  <dt>Delay</dt><dd>{formatSeconds(facts.delayS)}</dd>
                </dl>
                <p><Link to="/route">Refine in Route Planner</Link></p>
              </div>
            ) : (
              <EmptyState title="No route planned yet"
                hint="Plan a route to see its summary, traffic impact, and journey options here."
                testid="dash-route-empty" />
            )}
            <div className="pf-row">
              <Link className="pf-btn primary" to="/route" data-testid="dash-entry-route">Plan a Route</Link>
              <Link className="pf-btn" to="/journey" data-testid="dash-entry-journey">Start Journey</Link>
              <Link className="pf-btn" to="/lab" data-testid="dash-entry-lab">Explore Algorithms</Link>
            </div>
          </section>

          <section className="pf-card" aria-label="Traffic status" data-testid="dash-traffic">
            <h2>Traffic status</h2>
            <p className="pf-meta">Overlay v{version}</p>
            {incidents.length === 0 && closures.length === 0 ? (
              <p>Network flowing normally. <Link to="/route">Report an incident</Link></p>
            ) : (
              <ul>
                {incidents.map((i) => (
                  <li key={i.id}>{i.id}: {i.kind} on {i.road} ({i.dir})</li>
                ))}
                {closures.map((c) => (
                  <li key={c}>Road {c}: CLOSED</li>
                ))}
              </ul>
            )}
          </section>

          <section className="pf-card" aria-label="Journey status" data-testid="dash-journey">
            <h2>Journey</h2>
            {journeyActive || simStatus === 'completed' ? (
              <div>
                <p>
                  <Chip tone={simStatus === 'completed' ? 'ok' : 'info'}>{simStatus}</Chip>{' '}
                  {(progress * 100).toFixed(1)}% · {formatSeconds(simPos.simTimeS)} elapsed
                </p>
                <p className="pf-meta">On {simPos.arcId || '—'} @ {simPos.fracPermille}‰</p>
                <p><Link to="/journey">Open Journey Simulator</Link></p>
              </div>
            ) : (
              <EmptyState title="No active journey"
                hint={facts?.found ? 'A route is ready — start the simulator.' : 'Plan a route, then drive it here.'}
                testid="dash-journey-empty" />
            )}
          </section>

          <section className="pf-card" aria-label="Recent decisions" data-testid="dash-decisions">
            <h2>Recent decisions</h2>
            {history.length === 0 ? (
              <EmptyState title="No decisions recorded"
                hint="Stay/accept choices during journeys appear here."
                testid="dash-decisions-empty" />
            ) : (
              <ul>
                {history.slice(-4).reverse().map((h, i) => (
                  <li key={i}>{h.kind} @ {formatSeconds(h.simTimeS)}: {h.detail}</li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export function Placeholder({ title, milestone }: { title: string; milestone: string }) {
  return (
    <div>
      <h2>{title}</h2>
      <p data-testid="placeholder">Arrives in {milestone}. The engine commands it needs are already verified.</p>
    </div>
  );
}
