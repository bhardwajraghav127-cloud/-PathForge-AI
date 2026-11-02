// Journey Simulator (U5): real simulated runs with progress bar, segment
// list, ETA, directed vehicle + trail + endpoint flags, follow mode, timeline
// scrubber, and diversion previews. Timing/decisions stay engine-sourced.
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import type { Core } from 'cytoscape';
import MapView from '../components/MapView';
import TrafficPanel from '../components/TrafficPanel';
import { engineClient, useEngineStatus } from '../engine/client';
import { EngineError } from '../engine/EngineClient';
import { formatMetres, formatSeconds, networkPayload, vertexName } from '../data/dataset';
import { useRoute } from '../store';
import { useTraffic } from '../traffic';
import { SPEEDS, useSim, type DiversionBanner } from '../simulation';
import VivaCard from '../components/VivaCard';

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
  policy: z.record(z.string(), z.unknown()).catch({}),
}).passthrough();

const AcceptSchema = z.object({
  accepted: z.boolean(),
  plan: z.object({
    arcs: z.array(z.object({ arcId: z.string(), from: z.string(), to: z.string() })).catch([]),
    vertices: z.array(z.string()).catch([]),
  }),
}).passthrough();

interface LogEntry { t: number; arcIdx: number; frac: number }
interface Mutable {
  arcIdx: number; frac: number; simTimeS: number; lastWall: number;
  lastMirror: number; lastCheckSim: number; lastTrafficVersion: number;
  checking: boolean; accepts: number; stays: number;
  durCache: Map<string, number>; distCache: Map<string, number>;
  log: LogEntry[]; vx: number; vy: number;
  trail: { x: number; y: number }[];
}

function freshMutable(trafficVersion: number): Mutable {
  return {
    arcIdx: 0, frac: 0, simTimeS: 0, lastWall: performance.now(), lastMirror: 0,
    lastCheckSim: -1000, lastTrafficVersion: trafficVersion, checking: false,
    accepts: 0, stays: 0, durCache: new Map(), distCache: new Map(),
    log: [], vx: 0, vy: 0, trail: [],
  };
}

export default function Journey() {
  const engineStatus = useEngineStatus();
  const facts = useRoute((s) => s.facts);
  const sim = useSim();
  const trafficVersion = useTraffic((s) => s.version);
  const overlayOf = useTraffic((s) => s.overlay);
  const cyOut = useRef<Core | null>(null);
  const vehicleRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const trailRef = useRef<HTMLDivElement>(null);
  const flagSRef = useRef<HTMLDivElement>(null);
  const flagFRef = useRef<HTMLDivElement>(null);
  const reducedMotionRef = useRef(false);
  useEffect(() => {
    if (window.matchMedia) {
      reducedMotionRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
  }, []);
  const [follow, setFollow] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);
  const [logLen, setLogLen] = useState(0);
  const m = useRef<Mutable>(freshMutable(1));

  async function evalArc(arcId: string, from: string): Promise<{ timeS: number; distanceM: number }> {
    const t = m.current.durCache.get(arcId);
    const d = m.current.distCache.get(arcId);
    if (t !== undefined && d !== undefined) return { timeS: t, distanceM: d };
    const o = await engineClient.call(
      'route.evaluate',
      { network: networkPayload(), overlay: overlayOf(), objective: sim.objective || 'FASTEST', plan: { arcs: [arcId], source: from } },
      { channel: 'journey' },
    );
    if (o.stale) throw new Error('stale evaluate');
    const ev = EvalSchema.parse(o.result);
    if (!ev.valid || ev.blocked) throw new Error(`arc ${arcId} not traversable`);
    m.current.durCache.set(arcId, ev.timeS);
    m.current.distCache.set(arcId, ev.distanceM);
    return { timeS: ev.timeS, distanceM: ev.distanceM };
  }

  async function start() {
    if (!facts?.found) return;
    sim.set({ status: 'starting', error: '', summary: null, banner: null, guidance: '' });
    setPreview(null);
    try {
      m.current = freshMutable(trafficVersion);
      const durations: number[] = [];
      const distances: number[] = [];
      for (const a of facts.arcs) {
        const e = await evalArc(a.arcId, a.from);
        durations.push(e.timeS);
        distances.push(e.distanceM);
      }
      const planned = durations.reduce((x, y) => x + y, 0);
      const legs: Record<string, { from: string; to: string }> = {};
      for (const a of facts.arcs) legs[a.arcId] = { from: a.from, to: a.to };
      sim.set({
        status: 'running', planArcs: facts.arcs.map((a) => a.arcId),
        planVertices: facts.vertices, objective: facts.objectiveDescription.split(':')[0] ?? 'FASTEST',
        durations, distances, plannedTimeS: planned, legs,
        pos: { arcIdx: 0, arcId: facts.arcs[0]?.arcId ?? '', fracPermille: 0, simTimeS: 0 },
        policy: {},
      });
      m.current.lastWall = performance.now();
      setLogLen(0);
    } catch (e) {
      sim.set({ status: 'error', error: e instanceof EngineError ? `${e.code}: ${e.message}` : String(e) });
    }
  }

  function stopEarly() {
    const s = useSim.getState();
    const mu = m.current;
    useSim.getState().set({
      status: 'completed',
      summary: {
        origin: s.planVertices[0] ?? '', destination: s.planVertices[s.planVertices.length - 1] ?? '',
        objective: s.objective, plannedTimeS: s.plannedTimeS,
        actualSimTimeS: Math.floor(mu.simTimeS),
        distanceM: s.distances.reduce((x, y) => x + y, 0),
        arcsTraversed: mu.arcIdx,
        diversionsAccepted: mu.accepts, stays: mu.stays, status: 'stopped',
      },
    });
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

  function placeVehicle(cy: Core, arcId: string, fracPermille: number): { x: number; y: number } | null {
    const leg = useSim.getState().legs[arcId];
    if (!leg) return null;
    const a = cy.getElementById(leg.from).renderedPosition();
    const b = cy.getElementById(leg.to).renderedPosition();
    const f = Math.min(1, Math.max(0, fracPermille / 1000));
    const x = a.x + (b.x - a.x) * f;
    const y = a.y + (b.y - a.y) * f;
    if (vehicleRef.current) {
      vehicleRef.current.style.transform = `translate(${x}px, ${y}px) translate(-50%,-50%)`;
    }
    if (arrowRef.current) {
      const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 90;
      arrowRef.current.style.transform = `translate(-50%,-50%) rotate(${deg}deg)`;
    }
    return { x, y };
  }

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
              distanceM: s.distances.reduce((x, y) => x + y, 0),
              arcsTraversed: s.planArcs.length,
              diversionsAccepted: mu.accepts, stays: mu.stays, status: 'completed',
            },
          });
          return;
        }
        break; // one arc crossing per frame keeps motion uniform
      }
      const cy = cyOut.current;
      const arcId = s.planArcs[mu.arcIdx];
      if (cy && arcId) {
        const p = placeVehicleRef.current(cy, arcId, mu.frac);
        if (p) {
          mu.vx = p.x;
          mu.vy = p.y;
          if (!reducedMotionRef.current) {
            mu.trail.push(p);
            if (mu.trail.length > 8) mu.trail.shift();
            const dots = trailRef.current?.children;
            if (dots) {
              for (let i = 0; i < dots.length; i++) {
                const dot = dots[i] as HTMLElement;
                const tp = mu.trail[mu.trail.length - 1 - i];
                dot.style.transform = tp
                  ? `translate(${tp.x}px, ${tp.y}px) translate(-50%,-50%)`
                  : 'translate(-100px,-100px)';
              }
            }
          }
        }
      }
      if (now - mu.lastMirror >= 100) {
        mu.lastMirror = now;
        useSim.getState().set({
          pos: { arcIdx: mu.arcIdx, arcId: arcId ?? '', fracPermille: Math.floor(mu.frac), simTimeS: Math.floor(mu.simTimeS) },
        });
        mu.log.push({ t: Math.floor(mu.simTimeS), arcIdx: mu.arcIdx, frac: Math.floor(mu.frac) });
        if (mu.log.length > 4000) mu.log.splice(0, mu.log.length - 4000);
        setLogLen(mu.log.length);
        updateFlags();
        if (followRef.current && cyOut.current) {
          const fcy = cyOut.current;
          const z = fcy.zoom();
          fcy.pan({ x: fcy.width() / 2 - mu.vx * z, y: fcy.height() / 2 - mu.vy * z });
        }
      }
      void checkRef.current();
      raf = requestAnimationFrame(tick);
    };
    m.current.lastWall = performance.now();
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim.status, sim.speed]);

  const placeVehicleRef = useRef(placeVehicle);
  placeVehicleRef.current = placeVehicle;
  const followRef = useRef(follow);
  followRef.current = follow;

  function updateFlags() {
    const cy = cyOut.current;
    const s = useSim.getState();
    if (!cy || s.planVertices.length === 0) return;
    const first = cy.getElementById(s.planVertices[0] ?? '');
    const last = cy.getElementById(s.planVertices[s.planVertices.length - 1] ?? '');
    if (first.length > 0 && flagSRef.current) {
      const p = first.renderedPosition();
      flagSRef.current.style.transform = `translate(${p.x}px, ${p.y - 26}px) translate(-50%,-50%)`;
    }
    if (last.length > 0 && flagFRef.current) {
      const p = last.renderedPosition();
      flagFRef.current.style.transform = `translate(${p.x}px, ${p.y - 26}px) translate(-50%,-50%)`;
    }
  }

  // Traffic edits trigger an immediate diversion check while running.
  useEffect(() => {
    if (sim.status === 'running') void checkRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trafficVersion]);

  // Timeline scrub preview (paused/completed only).
  useEffect(() => {
    const cy = cyOut.current;
    if (preview === null || !cy) return;
    const entry = m.current.log[preview];
    if (!entry) return;
    const s = useSim.getState();
    const arcId = s.planArcs[entry.arcIdx];
    if (arcId) placeVehicleRef.current(cy, arcId, entry.frac);
  }, [preview]);

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
          const durations: number[] = [];
          const distances: number[] = [];
          for (const arc of a.plan.arcs) {
            const e = await evalArc(arc.arcId, arc.from);
            durations.push(e.timeS);
            distances.push(e.distanceM);
          }
          m.current.arcIdx = 0;
          m.current.frac = b.frozen.fracPermille;
          m.current.simTimeS = b.frozen.simTimeS;
          m.current.accepts += 1;
          const legs = { ...useSim.getState().legs };
          for (const arc of a.plan.arcs) legs[arc.arcId] = { from: arc.from, to: arc.to };
          useSim.getState().record({
            kind: 'accept', simTimeS: b.frozen.simTimeS,
            detail: `accepted ${b.decision} (${b.reason}), savings ${b.savingS ?? 'n/a'}s`,
            arcId: b.frozen.arcId, fracPermille: b.frozen.fracPermille,
          });
          useSim.getState().set({
            planArcs: a.plan.arcs.map((x) => x.arcId), planVertices: a.plan.vertices,
            durations, distances, plannedTimeS: durations.reduce((x, y) => x + y, 0), legs,
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
    useSim.getState().record({
      kind: 'stay', simTimeS: b.frozen.simTimeS,
      detail: `stayed despite ${b.decision} (${b.reason})`,
      arcId: b.frozen.arcId, fracPermille: b.frozen.fracPermille,
    });
    useSim.getState().set({ banner: null, status: 'running' });
    m.current.lastWall = performance.now();
  }

  function showOnMap(arcId: string | undefined) {
    const cy = cyOut.current;
    if (!cy || !arcId) return;
    const e = cy.getElementById(arcId);
    if (e.length === 0) return;
    cy.center(e);
    cy.elements().removeClass('search-hit');
    e.addClass('search-hit');
    window.setTimeout(() => e.removeClass('search-hit'), 1800);
  }

  function arcOf(arcId: string): { from: string; to: string } | null {
    return useSim.getState().legs[arcId] ?? null;
  }

  const progress = sim.planArcs.length === 0 ? 0
    : Math.min(1, (sim.pos.arcIdx + sim.pos.fracPermille / 1000) / sim.planArcs.length);
  const remainingTime = sim.durations.slice(sim.pos.arcIdx).reduce((x, y) => x + y, 0)
    - (sim.durations[sim.pos.arcIdx] ?? 0) * (sim.pos.fracPermille / 1000);
  const remainingDist = sim.distances.slice(sim.pos.arcIdx).reduce((x, y) => x + y, 0)
    - (sim.distances[sim.pos.arcIdx] ?? 0) * (sim.pos.fracPermille / 1000);
  const showOverlays = sim.status === 'running' || sim.status === 'paused' || sim.status === 'completed';
  const previewEntry = preview !== null ? m.current.log[preview] : undefined;
  const [panelHidden, setPanelHidden] = useState(false);

  return (
    <div>
      <button className="pf-btn small pf-panel-toggle" data-testid="panel-toggle"
        aria-expanded={!panelHidden} onClick={() => setPanelHidden(!panelHidden)}>
        {panelHidden ? 'Show panel' : 'Hide panel'}
      </button>
      <div className={`pf-workspace${panelHidden ? ' panel-hidden' : ''}`}>
        <div className="pf-map-wrap" style={{ position: 'relative' }}>
          <MapView routeArcIds={sim.planArcs} cyOut={cyOut}
            statsExtra={sim.planArcs.length > 0 ? `${sim.planArcs.length} segments` : undefined} />
          {showOverlays && (
            <div ref={trailRef} data-testid="vehicle-trail" aria-hidden="true"
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              {[0.55, 0.48, 0.41, 0.34, 0.27, 0.2, 0.13, 0.08].map((op, i) => (
                <div key={i}
                  style={{
                    position: 'absolute', top: 0, left: 0, width: 10, height: 10,
                    borderRadius: '50%', background: 'var(--pf-accent)', opacity: op,
                    transform: 'translate(-100px,-100px)',
                  }} />
              ))}
            </div>
          )}
          {showOverlays && (
            <div>
              <div ref={flagSRef} data-testid="flag-start" aria-hidden="true"
                style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
                <span className="pf-chip ok">S</span>
              </div>
              <div ref={flagFRef} data-testid="flag-finish" aria-hidden="true"
                style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
                <span className="pf-chip info">F</span>
              </div>
            </div>
          )}
          {(sim.status === 'running' || sim.status === 'paused') && (
            <div ref={vehicleRef} data-testid="vehicle" data-arc={sim.pos.arcId}
              data-frac={sim.pos.fracPermille}
              aria-hidden="true"
              style={{
                position: 'absolute', top: 0, left: 0, width: 24, height: 24,
                borderRadius: '50%', background: 'var(--pf-accent)',
                border: '3px solid var(--pf-paper)', pointerEvents: 'none',
                boxShadow: 'var(--pf-shadow)',
              }}>
              <div ref={arrowRef}
                style={{
                  position: 'absolute', top: '50%', left: '50%',
                  width: 0, height: 0,
                  borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
                  borderBottom: '9px solid var(--pf-paper)',
                }} />
            </div>
          )}
        </div>
        <div className="pf-panel">
          <section className="pf-card" aria-label="Journey controls">
            <h2>Journey Simulator</h2>
            {!facts?.found && <p data-testid="journey-no-plan">Plan a route first, then start a journey.</p>}
            <p className="pf-meta" data-testid="engine-status">Engine: {engineStatus}</p>
            <p className="pf-meta" data-testid="journey-status">Status: {sim.status}</p>
            <div data-testid="journey-progressbar" role="progressbar" aria-valuenow={Math.round(progress * 100)}
              aria-valuemin={0} aria-valuemax={100} aria-label="Journey progress"
              style={{ height: 12, borderRadius: 6, background: 'var(--pf-paper-sink)', overflow: 'hidden' }}>
              <div style={{ width: `${(progress * 100).toFixed(1)}%`, height: '100%', background: 'var(--pf-accent)' }} />
            </div>
            <p className="pf-meta" data-testid="journey-progress" aria-live="polite">
              {(progress * 100).toFixed(1)}% · {formatSeconds(sim.pos.simTimeS)} elapsed ·
              on {sim.pos.arcId || '—'} @ {sim.pos.fracPermille}‰
            </p>
            <p className="pf-meta" data-testid="journey-eta">
              Remaining: {formatSeconds(Math.max(0, Math.round(remainingTime)))} · {formatMetres(Math.max(0, Math.round(remainingDist)))}
            </p>
            <div className="pf-field">
              <label htmlFor="journey-speed">Speed</label>
              <select id="journey-speed" value={sim.speed} data-testid="journey-speed"
                onChange={(e) => sim.set({ speed: Number(e.target.value) })}>
                {SPEEDS.map((x) => <option key={x} value={x}>{x}×</option>)}
              </select>
            </div>
            <div className="pf-field">
              <label htmlFor="journey-follow">
                <input id="journey-follow" type="checkbox" checked={follow}
                  onChange={(e) => setFollow(e.target.checked)} data-testid="journey-follow" />
                {' '}Follow vehicle
              </label>
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
              {sim.status === 'running' && (
                <button className="pf-btn" onClick={stopEarly} data-testid="journey-stop">Stop</button>
              )}
              {sim.status === 'paused' && !sim.banner && (
                <button className="pf-btn primary" onClick={() => { setPreview(null); m.current.lastWall = performance.now(); sim.set({ status: 'running' }); }} data-testid="journey-resume">Resume</button>
              )}
              {(sim.status === 'running' || sim.status === 'paused' || sim.status === 'completed' || sim.status === 'error') && (
                <button className="pf-btn" onClick={() => { setPreview(null); sim.set({ status: 'idle', banner: null, summary: null, guidance: '' }); }} data-testid="journey-reset">Reset</button>
              )}
            </div>
            {(sim.status === 'paused' || sim.status === 'completed') && logLen > 1 && (
              <div className="pf-field">
                <label htmlFor="journey-scrub">
                  Timeline scrub{previewEntry !== undefined ? ` — preview @ ${formatSeconds(previewEntry.t)}` : ''}
                </label>
                <input id="journey-scrub" type="range" min={0} max={logLen - 1}
                  value={preview ?? logLen - 1}
                  onChange={(e) => setPreview(Number(e.target.value))} data-testid="journey-scrub" />
              </div>
            )}
            {sim.guidance && <p className="pf-meta" data-testid="journey-guidance">{sim.guidance}</p>}
            {sim.error && <div className="pf-alert error" role="alert" data-testid="journey-error">{sim.error}</div>}
          </section>

          {sim.planArcs.length > 0 && (
            <section className="pf-card" aria-label="Route segments" data-testid="journey-segments">
              <h2>Segments ({sim.planArcs.length})</h2>
              <ol>
                {sim.planArcs.map((arcId, i) => {
                  const leg = arcOf(arcId);
                  const done = i < sim.pos.arcIdx;
                  const current = i === sim.pos.arcIdx && sim.status !== 'completed';
                  return (
                    <li key={`${arcId}-${i}`} data-testid={`journey-seg-${i}`}
                      style={done ? { opacity: 0.55 } : current ? { fontWeight: 700 } : { opacity: 0.8 }}>
                      {current ? '▶ ' : done ? '✓ ' : ''}
                      {leg ? `${vertexName(leg.from)} → ${vertexName(leg.to)}` : arcId}{' '}
                      <span className="pf-meta">
                        {formatSeconds(sim.durations[i] ?? 0)} · {formatMetres(sim.distances[i] ?? 0)}
                      </span>{' '}
                      <code>{arcId}</code>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          {sim.banner && (
            <section className="pf-card" aria-label="Diversion proposal" data-testid="diversion-banner">
              <h2>{sim.banner.decision === 'STAY' ? 'Stay' : 'Diversion proposed'}</h2>
              <p data-testid="diversion-detail">
                {sim.banner.decision} — {sim.banner.reason}; saving {sim.banner.savingS ?? 'n/a'}s
                (threshold 600s) at {sim.banner.frozen.arcId} @ {sim.banner.frozen.fracPermille}‰,
                ETA now {formatSeconds(sim.banner.currentEtaS)}
                {sim.banner.candidateEtaS !== null && ` vs ${formatSeconds(sim.banner.candidateEtaS)}`}
              </p>
              {sim.banner.candidateArcs.length > 0 && (
                <p className="pf-meta" data-testid="diversion-candidate">
                  Candidate ({sim.banner.candidateArcs.length} arcs):{' '}
                  <code>{sim.banner.candidateArcs.join(' ')}</code>
                </p>
              )}
              <div className="pf-row">
                <button className="pf-btn primary" onClick={() => void accept()} data-testid="diversion-accept">Accept Diversion</button>
                <button className="pf-btn" onClick={() => void stay()} data-testid="diversion-stay">Stay on Current Route</button>
              </div>
            </section>
          )}

          {sim.summary && (
            <section className="pf-card" aria-label="Journey summary" data-testid="journey-summary">
              <h2>Journey {sim.summary.status === 'completed' ? 'complete' : 'stopped'}</h2>
              <dl className="pf-facts">
                <dt>From → to</dt><dd data-testid="summary-route">{sim.summary.origin} → {sim.summary.destination}</dd>
                <dt>Planned time</dt><dd data-testid="summary-planned">{formatSeconds(sim.summary.plannedTimeS)}</dd>
                <dt>Actual sim time</dt><dd data-testid="summary-actual">{formatSeconds(sim.summary.actualSimTimeS)}</dd>
                <dt>Planned distance</dt><dd data-testid="summary-distance">{formatMetres(sim.summary.distanceM)}</dd>
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
                <li key={i} data-testid={`decision-${i}`}>
                  {h.kind} @ {formatSeconds(h.simTimeS)}: {h.detail}
                  {h.arcId && (
                    <button className="pf-btn small" data-testid={`decision-show-${i}`}
                      onClick={() => showOnMap(h.arcId)}>
                      Show on map
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <TrafficPanel />
          <VivaCard page="journey" />
        </div>
      </div>
    </div>
  );
}
