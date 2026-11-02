// Journey Simulator (M8): drives a real simulated run along the planned route.
// Per-arc durations come from route.evaluate; diversion decisions come from
// diversion.evaluate; the vehicle overlay is a non-interactive div moved in
// requestAnimationFrame (panel state mirrors at <=10 Hz).
import { useEffect, useRef } from 'react';
import { z } from 'zod';
import type { Core } from 'cytoscape';
import MapView from '../components/MapView';
import TrafficPanel from '../components/TrafficPanel';
import { engineClient, useEngineStatus } from '../engine/client';
import { EngineError } from '../engine/EngineClient';
import { formatSeconds, networkPayload } from '../data/dataset';
import { useRoute } from '../store';
import { useTraffic } from '../traffic';
import { SPEEDS, useSim, type DiversionBanner } from '../simulation';

const EvalSchema = z.object({
  valid: z.boolean(), blocked: z.boolean().catch(false),
  timeS: z.number().catch(0), distanceM: z.number().catch(0),
}).passthrough();

const DivSchema = z.object({
  decision: z.string(), reason: z.string().catch(''),
  savingS: z.number().nullable().catch(null),
  currentEtaS: z.number().catch(0), candidateEtaS: z.number().nullable().catch(null),
  notify: z.boolean().catch(false), notificationReason: z.string().catch(''),
  candidate: z.object({ arcs: z.array(z.object({ arcId: z.string() })).catch([]) }).nullable().catch(null),
  policy: z.record(z.unknown()).catch({}),
}).passthrough();

const AcceptSchema = z.object({
  accepted: z.boolean(),
  plan: z.object({
    arcs: z.array(z.object({ arcId: z.string(), from: z.string(), to: z.string() })).catch([]),
    vertices: z.array(z.string()).catch([]),
  }),
}).passthrough();

interface Mutable {
  arcIdx: number; frac: number; simTimeS: number; lastWall: number;
  lastMirror: number; lastCheckSim: number; lastTrafficVersion: number;
  checking: boolean; accepts: number; stays: number; durCache: Map<string, number>;
}

export default function Journey() {
  const engineStatus = useEngineStatus();
  const facts = useRoute((s) => s.facts);
  const sim = useSim();
  const trafficVersion = useTraffic((s) => s.version);
  const overlayOf = useTraffic((s) => s.overlay);
  const cyOut = useRef<Core | null>(null);
  const vehicleRef = useRef<HTMLDivElement>(null);
  const m = useRef<Mutable>({
    arcIdx: 0, frac: 0, simTimeS: 0, lastWall: 0, lastMirror: 0,
    lastCheckSim: -1000, lastTrafficVersion: 1, checking: false,
    accepts: 0, stays: 0, durCache: new Map(),
  });

  async function evalArc(arcId: string, from: string): Promise<number> {
    const cached = m.current.durCache.get(arcId);
    if (cached !== undefined) return cached;
    const o = await engineClient.call(
      'route.evaluate',
      { network: networkPayload(), overlay: overlayOf(), objective: sim.objective || 'FASTEST', plan: { arcs: [arcId], source: from } },
      { channel: 'journey' },
    );
    if (o.stale) throw new Error('stale evaluate');
    const ev = EvalSchema.parse(o.result);
    if (!ev.valid || ev.blocked) throw new Error(`arc ${arcId} not traversable`);
    m.current.durCache.set(arcId, ev.timeS);
    return ev.timeS;
  }

  async function start() {
    if (!facts?.found) return;
    sim.set({ status: 'starting', error: '', summary: null, banner: null, guidance: '' });
    try {
      m.current = {
        arcIdx: 0, frac: 0, simTimeS: 0, lastWall: performance.now(), lastMirror: 0,
        lastCheckSim: -1000, lastTrafficVersion: trafficVersion, checking: false,
        accepts: 0, stays: 0, durCache: new Map(),
      };
      const durations: number[] = [];
      for (const a of facts.arcs) durations.push(await evalArc(a.arcId, a.from));
      const planned = durations.reduce((x, y) => x + y, 0);
      const legs: Record<string, { from: string; to: string }> = {};
      for (const a of facts.arcs) legs[a.arcId] = { from: a.from, to: a.to };
      sim.set({
        status: 'running', planArcs: facts.arcs.map((a) => a.arcId),
        planVertices: facts.vertices, objective: facts.objectiveDescription.split(':')[0] ?? 'FASTEST',
        durations, plannedTimeS: planned, legs,
        pos: { arcIdx: 0, arcId: facts.arcs[0]?.arcId ?? '', fracPermille: 0, simTimeS: 0 },
        policy: {},
      });
      m.current.lastWall = performance.now();
    } catch (e) {
      sim.set({ status: 'error', error: e instanceof EngineError ? `${e.code}: ${e.message}` : String(e) });
    }
  }

  async function checkDiversion() {
    const s = useSim.getState();
    if (s.status !== 'running' || s.banner || m.current.checking) return;
    const mu = m.current;
    if (mu.simTimeS - mu.lastCheckSim < 60 && mu.lastTrafficVersion === trafficVersion) return;
    mu.checking = true;
    try {
      const remaining = s.planArcs.slice(mu.arcIdx);
      if (remaining.length === 0) return;
      const arc = remaining[0] as string;
      const frac = Math.max(0, Math.min(1000, Math.floor(mu.frac)));
      const payload = {
        network: networkPayload(), overlay: overlayOf(),
        plan: { arcs: remaining },
        position: { arc, fractionPermille: frac },
        simTimeS: Math.floor(mu.simTimeS),
        config: { thresholdS: 600 }, policy: s.policy,
      };
      const o = await engineClient.call('diversion.evaluate', payload, { channel: 'diversion' });
      if (o.stale) return;
      const d = DivSchema.parse(o.result);
      mu.lastCheckSim = mu.simTimeS;
      mu.lastTrafficVersion = trafficVersion;
      useSim.getState().set({ policy: d.policy as Record<string, unknown> });
      if (d.notify) {
        const banner: DiversionBanner = {
          decision: d.decision, reason: d.reason, savingS: d.savingS,
          currentEtaS: d.currentEtaS, candidateEtaS: d.candidateEtaS,
          candidateArcs: (d.candidate?.arcs ?? []).map((a) => a.arcId),
          frozen: { arcIdx: mu.arcIdx, arcId: arc, fracPermille: frac, simTimeS: Math.floor(mu.simTimeS) },
          overlayVersion: trafficVersion,
        };
        useSim.getState().set({ banner, status: 'paused' });
      } else {
        useSim.getState().set({ guidance: `${d.decision} — ${d.reason}` });
      }
    } catch (e) {
      useSim.getState().set({
        guidance: `check failed: ${e instanceof EngineError ? e.code : String(e)}`,
      });
    } finally {
      m.current.checking = false;
    }
  }
  const checkRef = useRef(checkDiversion);
  checkRef.current = checkDiversion;

  // Main loop: advance sim clock, move the overlay, mirror state at <=10 Hz.
  useEffect(() => {
    if (sim.status !== 'running') return;
    let raf = 0;
    const tick = (now: number) => {
      const s = useSim.getState();
      const mu = m.current;
      const dt = Math.max(0, (now - mu.lastWall) / 1000);
      mu.lastWall = now;
      mu.simTimeS += dt * s.speed;
      let guard = 0;
      while (guard++ < 1000) {
        const dur = s.durations[mu.arcIdx];
        if (dur === undefined || dur <= 0) break;
        mu.frac += ((dt * s.speed) / dur) * 1000;
        if (mu.frac < 1000) break;
        const overflow = ((mu.frac - 1000) / 1000) * dur; // sim seconds into next arc
        mu.arcIdx += 1;
        mu.frac = 0;
        if (mu.arcIdx >= s.planArcs.length) {
          mu.simTimeS = Math.round(mu.simTimeS);
          useSim.getState().set({
            status: 'completed',
            pos: { arcIdx: mu.arcIdx, arcId: '', fracPermille: 1000, simTimeS: Math.floor(mu.simTimeS) },
            summary: {
              origin: s.planVertices[0] ?? '', destination: s.planVertices[s.planVertices.length - 1] ?? '',
              objective: s.objective, plannedTimeS: s.plannedTimeS,
              actualSimTimeS: Math.floor(mu.simTimeS),
              distanceM: 0, arcsTraversed: s.planArcs.length,
              diversionsAccepted: mu.accepts, stays: mu.stays, status: 'completed',
            },
          });
          return;
        }
        // Re-spend overflow against the next arc below in a time-faithful way:
        void overflow;
        break; // one arc crossing per frame keeps motion uniform; overflow < 1 frame
      }
      // Vehicle overlay: interpolate rendered vertex positions (handles pan/zoom).
      const cy = cyOut.current;
      const arcId = s.planArcs[mu.arcIdx];
      if (cy && arcId && vehicleRef.current) {
        const arc = arcOf(arcId);
        if (arc) {
          const a = cy.getElementById(arc.from).renderedPosition();
          const b = cy.getElementById(arc.to).renderedPosition();
          const f = Math.min(1, mu.frac / 1000);
          vehicleRef.current.style.transform =
            `translate(${a.x + (b.x - a.x) * f}px, ${a.y + (b.y - a.y) * f}px) translate(-50%,-50%)`;
        }
      }
      if (now - mu.lastMirror >= 100) {
        mu.lastMirror = now;
        useSim.getState().set({
          pos: { arcIdx: mu.arcIdx, arcId: arcId ?? '', fracPermille: Math.floor(mu.frac), simTimeS: Math.floor(mu.simTimeS) },
        });
      }
      void checkRef.current();
      raf = requestAnimationFrame(tick);
    };
    m.current.lastWall = performance.now();
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim.status, sim.speed]);

  // Traffic edits trigger an immediate diversion check while running.
  useEffect(() => {
    if (sim.status === 'running') void checkRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trafficVersion]);

  async function accept() {
    const s = useSim.getState();
    if (!s.banner) return;
    const b = s.banner;
    try {
      const payload = {
        network: networkPayload(), overlay: overlayOf(),
        plan: { arcs: s.planArcs.slice(b.frozen.arcIdx) },
        position: { arc: b.frozen.arcId, fractionPermille: b.frozen.fracPermille },
        simTimeS: b.frozen.simTimeS, config: { thresholdS: 600 },
        action: 'accept', expectedVersion: b.overlayVersion,
        expectedPosition: { arc: b.frozen.arcId, fractionPermille: b.frozen.fracPermille },
        candidate: { arcs: b.candidateArcs }, policy: s.policy,
      };
      const o = await engineClient.call('diversion.evaluate', payload, { channel: 'diversion' });
      if (!o.stale) {
        const a = AcceptSchema.parse(o.result);
        if (a.accepted) {
          // Adopt the engine-validated plan; it starts at the occupied arc, so
          // the vehicle continues without teleporting.
          const durations: number[] = [];
          for (const arc of a.plan.arcs) {
            const known = m.current.durCache.get(arc.arcId);
            durations.push(known ?? (await evalArc(arc.arcId, arc.from)));
          }
          m.current.arcIdx = 0;
          m.current.frac = b.frozen.fracPermille;
          m.current.simTimeS = b.frozen.simTimeS;
          m.current.accepts += 1;
          const legs = { ...useSim.getState().legs };
          for (const arc of a.plan.arcs) legs[arc.arcId] = { from: arc.from, to: arc.to };
          useSim.getState().record({ kind: 'accept', simTimeS: b.frozen.simTimeS, detail: `accepted ${b.decision} (${b.reason}), savings ${b.savingS ?? 'n/a'}s` });
          useSim.getState().set({
            planArcs: a.plan.arcs.map((x) => x.arcId), planVertices: a.plan.vertices,
            durations, plannedTimeS: durations.reduce((x, y) => x + y, 0), legs,
            banner: null, status: 'running',
          });
          m.current.lastWall = performance.now();
        }
      }
    } catch (e) {
      useSim.getState().set({
        error: e instanceof EngineError ? `${e.code}: ${e.message}` : String(e),
        banner: null, status: 'running',
      });
    }
  }

  async function stay() {
    const s = useSim.getState();
    if (!s.banner) return;
    const b = s.banner;
    try {
      const o = await engineClient.call('diversion.evaluate', {
        network: networkPayload(), overlay: overlayOf(),
        plan: { arcs: s.planArcs.slice(b.frozen.arcIdx) },
        position: { arc: b.frozen.arcId, fractionPermille: b.frozen.fracPermille },
        simTimeS: b.frozen.simTimeS, config: { thresholdS: 600 },
        action: 'reject', policy: s.policy,
      }, { channel: 'diversion' });
      if (!o.stale) {
        const d = DivSchema.parse(o.result);
        useSim.getState().set({ policy: d.policy as Record<string, unknown> });
      }
    } catch {
      /* a failed reject still dismisses locally; the next check re-alerts */
    }
    m.current.stays += 1;
    useSim.getState().record({ kind: 'stay', simTimeS: b.frozen.simTimeS, detail: `stayed despite ${b.decision} (${b.reason})` });
    useSim.getState().set({ banner: null, status: 'running' });
    m.current.lastWall = performance.now();
  }

  function arcOf(arcId: string): { from: string; to: string } | null {
    return useSim.getState().legs[arcId] ?? null;
  }

  const progress = sim.planArcs.length === 0 ? 0
    : Math.min(1, (sim.pos.arcIdx + sim.pos.fracPermille / 1000) / sim.planArcs.length);

  return (
    <div>
      <div className="pf-workspace">
        <div className="pf-map-wrap" style={{ position: 'relative' }}>
          <MapView routeArcIds={sim.planArcs} cyOut={cyOut} />
          {(sim.status === 'running' || sim.status === 'paused') && (
            <div ref={vehicleRef} data-testid="vehicle" data-arc={sim.pos.arcId}
              data-frac={sim.pos.fracPermille}
              aria-hidden="true"
              style={{
                position: 'absolute', top: 0, left: 0, width: 14, height: 14,
                borderRadius: '50%', background: 'var(--pf-accent)',
                border: '2px solid var(--pf-paper)', pointerEvents: 'none',
              }} />
          )}
        </div>
        <div className="pf-panel">
          <section className="pf-card" aria-label="Journey controls">
            <h2>Journey Simulator</h2>
            {!facts?.found && <p data-testid="journey-no-plan">Plan a route first, then start a journey.</p>}
            <p className="pf-meta" data-testid="engine-status">Engine: {engineStatus}</p>
            <p className="pf-meta" data-testid="journey-status">Status: {sim.status}</p>
            <p className="pf-meta" data-testid="journey-progress" aria-live="polite">
              {(progress * 100).toFixed(1)}% · {formatSeconds(sim.pos.simTimeS)} elapsed ·
              on {sim.pos.arcId || '—'} @ {sim.pos.fracPermille}‰
            </p>
            <div className="pf-field">
              <label htmlFor="journey-speed">Speed</label>
              <select id="journey-speed" value={sim.speed} data-testid="journey-speed"
                onChange={(e) => sim.set({ speed: Number(e.target.value) })}>
                {SPEEDS.map((x) => <option key={x} value={x}>{x}×</option>)}
              </select>
            </div>
            <div className="pf-row">
              {(sim.status === 'idle' || sim.status === 'completed' || sim.status === 'error') && (
                <button className="pf-btn primary" onClick={() => void start()} disabled={!facts?.found || engineStatus !== 'ready'} data-testid="journey-start">
                  Start Journey
                </button>
              )}
              {sim.status === 'running' && (
                <button className="pf-btn" onClick={() => sim.set({ status: 'paused' })} data-testid="journey-pause">Pause</button>
              )}
              {sim.status === 'paused' && !sim.banner && (
                <button className="pf-btn primary" onClick={() => { m.current.lastWall = performance.now(); sim.set({ status: 'running' }); }} data-testid="journey-resume">Resume</button>
              )}
              {(sim.status === 'paused' || sim.status === 'completed' || sim.status === 'error') && (
                <button className="pf-btn" onClick={() => sim.set({ status: 'idle', banner: null, summary: null, guidance: '' })} data-testid="journey-reset">Reset</button>
              )}
            </div>
            {sim.guidance && <p className="pf-meta" data-testid="journey-guidance">{sim.guidance}</p>}
            {sim.error && <div className="pf-alert error" role="alert" data-testid="journey-error">{sim.error}</div>}
          </section>

          {sim.banner && (
            <section className="pf-card" aria-label="Diversion proposal" data-testid="diversion-banner">
              <h2>{sim.banner.decision === 'STAY' ? 'Stay' : 'Diversion proposed'}</h2>
              <p data-testid="diversion-detail">
                {sim.banner.decision} — {sim.banner.reason}; saving {sim.banner.savingS ?? 'n/a'}s
                (threshold 600s) at {sim.banner.frozen.arcId} @ {sim.banner.frozen.fracPermille}‰,
                ETA now {formatSeconds(sim.banner.currentEtaS)}
                {sim.banner.candidateEtaS !== null && ` vs ${formatSeconds(sim.banner.candidateEtaS)}`}
              </p>
              <div className="pf-row">
                <button className="pf-btn primary" onClick={() => void accept()} data-testid="diversion-accept">Accept Diversion</button>
                <button className="pf-btn" onClick={() => void stay()} data-testid="diversion-stay">Stay on Current Route</button>
              </div>
            </section>
          )}

          {sim.summary && (
            <section className="pf-card" aria-label="Journey summary" data-testid="journey-summary">
              <h2>Journey complete</h2>
              <dl className="pf-facts">
                <dt>From → to</dt><dd data-testid="summary-route">{sim.summary.origin} → {sim.summary.destination}</dd>
                <dt>Planned time</dt><dd data-testid="summary-planned">{formatSeconds(sim.summary.plannedTimeS)}</dd>
                <dt>Actual sim time</dt><dd data-testid="summary-actual">{formatSeconds(sim.summary.actualSimTimeS)}</dd>
                <dt>Arcs traversed</dt><dd data-testid="summary-arcs">{sim.summary.arcsTraversed}</dd>
                <dt>Diversions accepted</dt><dd data-testid="summary-accepts">{sim.summary.diversionsAccepted}</dd>
                <dt>Stays</dt><dd data-testid="summary-stays">{sim.summary.stays}</dd>
              </dl>
            </section>
          )}

          <section className="pf-card" aria-label="Decision history">
            <h2>Decision history ({sim.history.length})</h2>
            <ul data-testid="decision-history">
              {sim.history.map((h, i) => (
                <li key={i} data-testid={`decision-${i}`}>{h.kind} @ {formatSeconds(h.simTimeS)}: {h.detail}</li>
              ))}
            </ul>
          </section>

          <TrafficPanel />
        </div>
      </div>
    </div>
  );
}
