// Route planner panel: O/D autocomplete, objective, Find Best Route, engine
// facts, alternatives and Why-This-Route attribution. All numbers come from
// the WASM engine; this file only renders them.
import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { engineClient, useEngineStatus } from '../engine/client';
import { EngineError } from '../engine/EngineClient';
import { VERTICES, formatInr, formatMetres, formatSeconds, networkPayload, vertexName } from '../data/dataset';
import { useRoute, type AltRoute, type CompareDelta, type RouteFacts } from '../store';
import { useTraffic } from '../traffic';

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

function PlaceInput({
  id, label, value, onPick,
}: {
  id: string; label: string; value: string; onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
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
        id={id} role="combobox" aria-expanded={focused} aria-controls={`${id}-list`}
        aria-autocomplete="list" autoComplete="off" placeholder={shown} value={text}
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
        <ul id={`${id}-list`} role="listbox" className="pf-suggest">
          {matches.map((m, i) => (
            <li key={m.id} role="option" aria-selected={i === active} data-testid={`${id}-option-${m.id}`}
              onMouseDown={(e) => { e.preventDefault(); onPick(m.id); setText(''); setOpen(false); }}
              onMouseEnter={() => setActive(i)}>
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
  const { phase, params, facts, error, alternatives, comparison, sharedArcs, selectedAlt, begin, succeed, fail, setExtras, selectAlt } = useRoute();
  const trafficVersion = useTraffic((s) => s.version);
  const overlayOf = useTraffic((s) => s.overlay);
  const [source, setSource] = useState('chandigarh');
  const [target, setTarget] = useState('delhi');
  const [objective, setObjective] = useState('FASTEST');
  const [showWhy, setShowWhy] = useState(false);
  const lastVersion = useRef(1);
  const inFlight = useRef(false);

  async function compute(ovVersion: number) {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const overlay = overlayOf();
      const base = { network: networkPayload(), overlay, source, target, objective };
      const o = await engineClient.call('route.find', { ...base, algorithm: 'DIJKSTRA' }, { channel: 'route' });
      if (o.stale) return;
      const found = RouteResultSchema.parse(o.result) as RouteFacts;
      if (lastVersion.current !== ovVersion) return; // superseded by a newer edit
      succeed(found);
      if (found.found) {
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
          if (lastVersion.current === ovVersion) setExtras(alts, deltas, shared);
        }
      }
    } catch (e) {
      if (lastVersion.current === ovVersion) {
        fail(e instanceof EngineError ? `${e.code}: ${e.message}` : String(e));
      }
    } finally {
      inFlight.current = false;
    }
  }

  async function find() {
    lastVersion.current = trafficVersion;
    begin({ source, target, objective });
    await compute(trafficVersion);
  }

  // AC-11: traffic edits recompute the displayed route automatically.
  useEffect(() => {
    if (phase !== 'found' || !params) return;
    if (trafficVersion === lastVersion.current) return;
    lastVersion.current = trafficVersion;
    void compute(trafficVersion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trafficVersion]);

  const busy = phase === 'calculating' || engineStatus === 'loading';
  const displayed: RouteFacts | null = selectedAlt
    ? (alternatives.find((a) => a.altId === selectedAlt) ?? facts)
    : facts;
  const bestDelta = comparison.find((c) => c.id === 'best');

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

      {phase === 'found' && displayed && (
        <section className="pf-card" aria-label="Route result" data-testid="route-result">
          <h2>{selectedAlt ? `Alternative ${selectedAlt}` : 'Best route'}</h2>
          <p className="pf-meta">{displayed.objectiveDescription}</p>
          <dl className="pf-facts">
            <dt>Distance</dt><dd data-testid="fact-distance">{formatMetres(displayed.distanceM)} ({displayed.distanceM} m)</dd>
            <dt>Time</dt><dd data-testid="fact-time">{formatSeconds(displayed.timeS)} ({displayed.timeS} s)</dd>
            <dt>Toll</dt><dd data-testid="fact-toll">{formatInr(displayed.tollInr)} ({displayed.tollInr})</dd>
            <dt>Traffic delay</dt><dd data-testid="fact-delay">{formatSeconds(displayed.delayS)} ({displayed.delayS} s)</dd>
          </dl>
          <h2>Steps ({displayed.arcs.length})</h2>
          <ol className="pf-steps" data-testid="route-steps">
            {displayed.arcs.map((a) => (
              <li key={a.arcId} data-arc={a.arcId}>
                {vertexName(a.from)} → {vertexName(a.to)} <code>{a.arcId}</code>
              </li>
            ))}
          </ol>
        </section>
      )}

      {phase === 'found' && facts?.found && alternatives.length > 0 && (
        <section className="pf-card" aria-label="Alternative routes">
          <h2>View Alternative Routes ({alternatives.length})</h2>
          <ul data-testid="alt-list">
            <li>
              <button className="pf-btn" onClick={() => selectAlt(null)} data-testid="alt-best">
                Best ({formatSeconds(facts.timeS)})
              </button>
            </li>
            {alternatives.map((a) => (
              <li key={a.altId}>
                <button className="pf-btn" onClick={() => selectAlt(a.altId)} data-testid={`alt-${a.altId}`}>
                  {a.altId}: {a.found ? formatSeconds(a.timeS) : 'unreachable'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {phase === 'found' && facts?.found && comparison.length > 0 && (
        <section className="pf-card" aria-label="Why this route">
          <h2>Why This Route?</h2>
          <button className="pf-btn" onClick={() => setShowWhy((v) => !v)} data-testid="why-toggle">
            {showWhy ? 'Hide explanation' : 'Why This Route?'}
          </button>
          {showWhy && (
            <div data-testid="why-panel">
              <p data-testid="why-best">
                Best route costs {formatSeconds(facts.timeS)}. Attribution incidents on this
                route: {(bestDelta?.incidentIds.join(', ') || 'none')}.
              </p>
              <ul>
                {comparison.filter((c) => c.id !== 'best').map((c) => (
                  <li key={c.id} data-testid={`why-${c.id}`}>
                    {c.id}: {c.timeDeltaS === null ? 'n/a' : `+${c.timeDeltaS}s vs best`};
                    unique arcs {c.uniqueArcs.length}; incidents {(c.incidentIds.join(', ') || 'none')}
                  </li>
                ))}
              </ul>
              <p className="pf-meta" data-testid="why-shared">
                {sharedArcs.length} shared arc(s) across compared plans.
              </p>
            </div>
          )}
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
