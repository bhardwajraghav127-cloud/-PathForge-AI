// Route planner panel: origin/destination autocomplete, objective, Find Best
// Route, and engine-fact display. Sends route.find to the WASM engine and
// renders only what the engine returns.
import { useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { engineClient, useEngineStatus } from '../engine/client';
import { EngineError } from '../engine/EngineClient';
import { VERTICES, formatInr, formatMetres, formatSeconds, networkPayload, vertexName } from '../data/dataset';
import { useRoute, type RouteFacts } from '../store';

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

function PlaceInput({
  id, label, value, onPick,
}: {
  id: string; label: string; value: string; onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLUListElement>(null);
  const focused = text.length > 0 && open;
  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    const all = VERTICES.map((v) => ({ id: v.id, label: `${v.name} (${v.id})` }));
    if (!q) return all.slice(0, 8);
    return all.filter((o) => o.label.toLowerCase().includes(q)).slice(0, 8);
  }, [text]);
  const shown = vertexName(value);
  return (
    <div className="pf-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        role="combobox"
        aria-expanded={focused}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={shown}
        value={text}
        onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && matches.length > 0) { e.preventDefault(); setActive((a) => (a + 1) % matches.length); }
          else if (e.key === 'ArrowUp' && matches.length > 0) { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); }
          else if (e.key === 'Enter') {
            const m = matches[active];
            if (focused && m) { e.preventDefault(); onPick(m.id); setText(''); setOpen(false); }
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {focused && matches.length > 0 && (
        <ul ref={boxRef} id={`${id}-list`} role="listbox" className="pf-suggest">
          {matches.map((m, i) => (
            <li
              key={m.id} role="option" aria-selected={i === active} data-testid={`${id}-option-${m.id}`}
              onMouseDown={(e) => { e.preventDefault(); onPick(m.id); setText(''); setOpen(false); }}
              onMouseEnter={() => setActive(i)}
            >
              {m.label}
            </li>
          ))}
        </ul>
      )}
      <div className="pf-meta" data-testid={`${id}-current`}>Selected: {shown}</div>
    </div>
  );
}

export default function RoutePanel() {
  const engineStatus = useEngineStatus();
  const { phase, params, facts, error, begin, succeed, fail } = useRoute();
  const [source, setSource] = useState('chandigarh');
  const [target, setTarget] = useState('delhi');
  const [objective, setObjective] = useState('FASTEST');

  async function find() {
    begin({ source, target, objective });
    try {
      const o = await engineClient.call(
        'route.find',
        { network: networkPayload(), overlay: { version: 1 }, source, target, objective, algorithm: 'DIJKSTRA' },
        { channel: 'route' },
      );
      if (o.stale) return;
      const facts = RouteResultSchema.parse(o.result) as RouteFacts;
      succeed(facts);
    } catch (e) {
      fail(e instanceof EngineError ? `${e.code}: ${e.message}` : String(e));
    }
  }

  const busy = phase === 'calculating' || engineStatus === 'loading';
  return (
    <div className="pf-panel">
      <section className="pf-card" aria-label="Route inputs">
        <h2>Plan a route</h2>
        <PlaceInput id="origin" label="Origin" value={source} onPick={setSource} />
        <PlaceInput id="destination" label="Destination" value={target} onPick={setTarget} />
        <div className="pf-field">
          <label htmlFor="objective">Objective</label>
          <select id="objective" value={objective} onChange={(e) => setObjective(e.target.value)} data-testid="objective">
            {OBJECTIVES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div className="pf-row">
          <button className="pf-btn primary" onClick={() => void find()} disabled={busy} data-testid="find-route">
            {phase === 'calculating' ? 'Calculating…' : 'Find Best Route'}
          </button>
        </div>
        <p className="pf-meta" data-testid="engine-status">Engine: {engineStatus}</p>
      </section>

      {phase === 'found' && facts && (
        <section className="pf-card" aria-label="Route result" data-testid="route-result">
          <h2>Best route</h2>
          <p className="pf-meta">{facts.objectiveDescription}</p>
          <dl className="pf-facts">
            <dt>Distance</dt><dd data-testid="fact-distance">{formatMetres(facts.distanceM)} ({facts.distanceM} m)</dd>
            <dt>Time</dt><dd data-testid="fact-time">{formatSeconds(facts.timeS)} ({facts.timeS} s)</dd>
            <dt>Toll</dt><dd data-testid="fact-toll">{formatInr(facts.tollInr)} ({facts.tollInr})</dd>
            <dt>Traffic delay</dt><dd data-testid="fact-delay">{formatSeconds(facts.delayS)} ({facts.delayS} s)</dd>
          </dl>
          <h2>Steps ({facts.arcs.length})</h2>
          <ol className="pf-steps" data-testid="route-steps">
            {facts.arcs.map((a) => (
              <li key={a.arcId} data-arc={a.arcId}>
                {vertexName(a.from)} → {vertexName(a.to)} <code>{a.arcId}</code>
              </li>
            ))}
          </ol>
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
    </div>
  );
}
