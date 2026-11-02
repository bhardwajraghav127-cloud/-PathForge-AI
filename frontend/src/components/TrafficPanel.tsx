// Traffic editor: report incidents, set congestion factors, close/reopen
// roads. Every mutation bumps the overlay version and the route panel
// recomputes against the real engine.
import { useState } from 'react';
import { ROADS, vertexName } from '../data/dataset';
import { useTraffic, type IncidentDir, type TrafficIncident } from '../traffic';
import { Confirm, useToasts } from './ui';

const KINDS: TrafficIncident['kind'][] = ['jam', 'accident', 'construction', 'partial'];
const DIRS: IncidentDir[] = ['both', 'forward', 'reverse'];

function roadLabel(id: string): string {
  const r = ROADS.find((x) => x.id === id);
  if (!r) return id;
  return `${r.name} (${vertexName(r.from)}→${vertexName(r.to)})`;
}

export default function TrafficPanel() {
  const version = useTraffic((s) => s.version);
  const incidents = useTraffic((s) => s.incidents);
  const factors = useTraffic((s) => s.factors);
  const closures = useTraffic((s) => s.closures);
  const add = useTraffic((s) => s.addIncident);
  const remove = useTraffic((s) => s.removeIncident);
  const setF = useTraffic((s) => s.setFactor);
  const clearF = useTraffic((s) => s.clearFactor);
  const toggle = useTraffic((s) => s.toggleClosure);
  const clearAll = useTraffic((s) => s.clearAll);
  const [road, setRoad] = useState('ex06');
  const [kind, setKind] = useState<TrafficIncident['kind']>('jam');
  const [dir, setDir] = useState<IncidentDir>('both');
  const [pct, setPct] = useState(40);
  const [confirmClear, setConfirmClear] = useState(false);
  const { push } = useToasts();

  return (
    <section className="pf-card" aria-label="Traffic editor">
      <h2>Traffic &amp; incidents</h2>
      <p className="pf-meta" data-testid="overlay-version">
        Overlay v{version} · {incidents.length} incident(s) · {Object.keys(factors).length} factor(s) · {closures.length} closure(s)
      </p>
      <div className="pf-field">
        <label htmlFor="traffic-road">Road</label>
        <select id="traffic-road" value={road} onChange={(e) => setRoad(e.target.value)} data-testid="traffic-road">
          {ROADS.map((r) => <option key={r.id} value={r.id}>{r.id} — {roadLabel(r.id)}</option>)}
        </select>
      </div>
      <div className="pf-row">
        <div className="pf-field">
          <label htmlFor="traffic-kind">Kind</label>
          <select id="traffic-kind" value={kind} onChange={(e) => setKind(e.target.value as TrafficIncident['kind'])} data-testid="traffic-kind">
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <div className="pf-field">
          <label htmlFor="traffic-dir">Direction</label>
          <select id="traffic-dir" value={dir} onChange={(e) => setDir(e.target.value as IncidentDir)} data-testid="traffic-dir">
            {DIRS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>
      <div className="pf-row">
        <button className="pf-btn" onClick={() => { add(road, dir, kind); push('Incident reported'); }} data-testid="traffic-add">
          Report incident
        </button>
        <button className="pf-btn" onClick={() => { const closed = closures.includes(road); toggle(road); push(closed ? 'Road reopened' : 'Road closed'); }} data-testid="traffic-close">
          {closures.includes(road) ? 'Reopen road' : 'Close road'}
        </button>
      </div>
      <div className="pf-field">
        <label htmlFor="traffic-factor">Congestion factor: {pct}% speed</label>
        <input id="traffic-factor" type="range" min={10} max={100} value={pct}
          onChange={(e) => setPct(Number(e.target.value))} data-testid="traffic-factor" />
      </div>
      <div className="pf-row">
        <button className="pf-btn" onClick={() => { setF(road, pct * 10); push(`Factor ${pct}% applied`); }} data-testid="traffic-apply-factor">
          Apply factor
        </button>
        <button className="pf-btn" onClick={() => { clearF(road); push('Factor cleared', 'info'); }} data-testid="traffic-clear-factor">
          Clear factor
        </button>
      </div>
      {(incidents.length > 0 || Object.keys(factors).length > 0 || closures.length > 0) && (
        <div className="pf-row">
          <button className="pf-btn small" onClick={() => setConfirmClear(true)} data-testid="traffic-clear-all">
            Clear all traffic
          </button>
        </div>
      )}
      {incidents.length > 0 && (
        <ul data-testid="incident-list">
          {incidents.map((i) => (
            <li key={i.id} data-testid={`incident-${i.id}`}>
              {i.id}: {i.kind} on {i.road} ({i.dir}){' '}
              <button className="pf-btn small" onClick={() => { remove(i.id); push('Incident removed', 'info'); }} data-testid={`incident-remove-${i.id}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {closures.length > 0 && (
        <p className="pf-meta" data-testid="closure-list">Closed: {closures.join(', ')}</p>
      )}
      <Confirm open={confirmClear} title="Clear all traffic?"
        body="Removes every incident, congestion factor, and closure from the overlay."
        confirmLabel="Clear all" testid="traffic-clear"
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => { clearAll(); setConfirmClear(false); push('Traffic overlay cleared'); }} />
    </section>
  );
}
