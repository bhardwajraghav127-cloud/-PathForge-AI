// Smart Journey Demo (V1): one-click scripted story over the real engine.
// FSM: idle → preparing → prepared → running → incident → evaluating →
// awaiting_decision → resumed → completed (+ error). Injection writes a real
// closure + incident into the shared traffic overlay (cleaned on reset);
// every evaluation/diversion comes from diversion.evaluate. No teleports:
// accept adopts the engine-returned plan at the frozen position.
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import type { Core } from 'cytoscape';
import MapView from '../components/MapView';
import { Confirm, useToasts } from '../components/ui';
import { engineClient, useEngineStatus } from '../engine/client';
import { EngineError } from '../engine/EngineClient';
import { formatInr, formatMetres, formatSeconds, networkPayload, vertexName } from '../data/dataset';
import { useTraffic } from '../traffic';
import { useSim, type DiversionBanner } from '../simulation';
import { useDemo, type DecisionReceipt } from '../demo/store';
import ExplainDrawer from '../explain/ExplainDrawer';
import VivaCard from '../components/VivaCard';
import {
  DEMO_DIVERSION_THRESHOLD_S, DemoDivSchema, DemoEvalSchema, prepareScenario,
} from '../demo/scenario';

const AcceptSchema = z.object({
  accepted: z.boolean(),
  plan: z.object({
    arcs: z.array(z.object({ arcId: z.string(), from: z.string(), to: z.string() })).catch([]),
    vertices: z.array(z.string()).catch([]),
  }),
}).passthrough();

const STAGES = ['Prepare', 'Plan', 'Depart', 'Disrupt', 'Analyze', 'Decide', 'Continue', 'Finish'];

// Demo-only speeds: the full 3.6 h simulated story fits a faculty slot at
// 3600x (~1 min wall); motion stays continuous (<=60 sim-s per frame, far
// below the shortest arc duration).
const DEMO_SPEEDS = [60, 600, 1800, 3600];

// Presenter narration: what to say at each stage. Static script; every
// number on screen still comes from the engine at run time.
const NARRATION = [
  { title: 'Prepare', say: 'One click resets the demo and asks the C++ engine for the fastest Chandigarh to Delhi route.' },
  { title: 'Plan', say: 'The engine returns the best route plus genuine Yen alternatives with honest time and toll deltas.' },
  { title: 'Depart', say: 'The vehicle drives the directed plan. Durations come from per-arc engine evaluations.' },
  { title: 'Disrupt', say: 'A SIMULATED closure hits a road ahead on our own future route — never an unrelated road.' },
  { title: 'Analyze', say: 'The diversion policy recomputes remaining costs from our exact position. Watch the policy reason.' },
  { title: 'Decide', say: 'The simulation pauses. Accept or stay — both are real, and staying a blocked route is allowed.' },
  { title: 'Continue', say: 'No teleporting: the vehicle resumes mid-arc on the engine-returned plan.' },
  { title: 'Finish', say: 'The receipt shows overlay version, policy reason, estimate, and your action. Replay any time.' },
];

function stageOf(status: string): number {
  switch (status) {
    case 'preparing': return 0;
    case 'prepared': return 1;
    case 'running': return 2;
    case 'incident': return 3;
    case 'evaluating': return 4;
    case 'awaiting_decision': return 5;
    case 'resumed': return 6;
    case 'completed': return 7;
    default: return 0;
  }
}

interface Mutable {
  arcIdx: number; frac: number; simTimeS: number; lastWall: number;
  lastMirror: number; checking: boolean; accepts: number; stays: number;
  durCache: Map<string, number>; distCache: Map<string, number>;
}

function freshMutable(): Mutable {
  return {
    arcIdx: 0, frac: 0, simTimeS: 0, lastWall: performance.now(), lastMirror: 0,
    checking: false, accepts: 0, stays: 0, durCache: new Map(), distCache: new Map(),
  };
}

export default function SmartDemo() {
  const engineStatus = useEngineStatus();
  const demo = useDemo();
  const overlayOf = useTraffic((s) => s.overlay);
  const pushToast = useToasts((s) => s.push);
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
  const m = useRef<Mutable>(freshMutable());
  const [paused, setPaused] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [guided, setGuided] = useState(true);
  const [presenter, setPresenter] = useState(false);
  const [autoChoice, setAutoChoice] = useState(false);
  const [autoIn, setAutoIn] = useState(0);
  const [explainOpen, setExplainOpen] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const guidedRef = useRef(guided);
  guidedRef.current = guided;
  const trail = useRef<{ x: number; y: number }[]>([]);

  async function evalArc(arcId: string, from: string): Promise<{ timeS: number; distanceM: number }> {
    const t = m.current.durCache.get(arcId);
    const d = m.current.distCache.get(arcId);
    if (t !== undefined && d !== undefined) return { timeS: t, distanceM: d };
    const o = await engineClient.call(
      'route.evaluate',
      { network: networkPayload(), overlay: overlayOf(), objective: 'FASTEST', plan: { arcs: [arcId], source: from } },
      { channel: 'demo' },
    );
    if (o.stale) throw new Error('stale evaluate');
    const ev = DemoEvalSchema.parse(o.result);
    if (!ev.valid || ev.blocked) throw new Error(`arc ${arcId} not traversable`);
    m.current.durCache.set(arcId, ev.timeS);
    m.current.distCache.set(arcId, ev.distanceM);
    return { timeS: ev.timeS, distanceM: ev.distanceM };
  }
  const evalRef = useRef(evalArc);
  evalRef.current = evalArc;

  function cleanupInjection() {
    const inj = useDemo.getState().injected;
    if (!inj) return;
    const t = useTraffic.getState();
    t.removeIncident(inj.incidentId);
    if (t.closures.includes(inj.road)) t.toggleClosure(inj.road);
    useDemo.getState().set({ injected: null });
  }

  function journeyActive(): boolean {
    const s = useSim.getState().status;
    return s === 'running' || s === 'paused' || s === 'starting';
  }

  async function start() {
    const st = useDemo.getState().status;
    if (st === 'preparing' || st === 'running' || st === 'resumed') return;
    if (journeyActive() || (st !== 'idle' && st !== 'completed' && st !== 'error')) {
      setConfirmOverwrite(true);
      return;
    }
    await runPrepare();
  }

  async function runPrepare() {
    setConfirmOverwrite(false);
    cleanupInjection();
    useDemo.getState().reset();
    useDemo.getState().set({ status: 'preparing', error: '' });
    m.current = freshMutable();
    try {
      const scenario = await prepareScenario(overlayOf());
      const durations: number[] = [];
      const distances: number[] = [];
      for (const a of scenario.route.arcs) {
        const e = await evalRef.current(a.arcId, a.from);
        durations.push(e.timeS);
        distances.push(e.distanceM);
      }
      const legs: Record<string, { from: string; to: string }> = {};
      for (const a of scenario.route.arcs) legs[a.arcId] = { from: a.from, to: a.to };
      useDemo.getState().set({
        status: 'prepared', scenario,
        planArcs: scenario.route.arcs.map((a) => a.arcId),
        planVertices: scenario.route.vertices, objective: 'FASTEST',
        durations, distances, plannedTimeS: durations.reduce((x, y) => x + y, 0), legs,
        pos: { arcIdx: 0, arcId: scenario.route.arcs[0]?.arcId ?? '', fracPermille: 0, simTimeS: 0 },
        policy: {},
      });
      pushToast(scenario.candidate
        ? `Demo ready: ${scenario.route.arcs.length} segments, incident planned on ${scenario.candidate.targetRoad}`
        : 'Demo ready: no beneficial diversion found, drive-through mode');
      // One click starts the drive; Plan stage stays visible in the timeline.
      // Guided mode curates a watchable pace; manual keeps the user's speed.
      useDemo.getState().set({ status: 'running', ...(guidedRef.current ? { speed: 600 } : {}) });
      m.current.lastWall = performance.now();
    } catch (e) {
      useDemo.getState().set({
        status: 'error',
        error: e instanceof EngineError ? `${e.code}: ${e.message}` : String(e),
      });
    }
  }

  async function injectAndEvaluate() {
    const s = useDemo.getState();
    const c = s.scenario?.candidate;
    if (!c || s.injected || m.current.checking) return;
    m.current.checking = true;
    useDemo.getState().set({ status: 'incident' });
    try {
      const t = useTraffic.getState();
      const incidentId = t.addIncident(c.targetRoad, 'both', 'accident');
      if (!useTraffic.getState().closures.includes(c.targetRoad)) {
        useTraffic.getState().toggleClosure(c.targetRoad);
      }
      const overlayVersion = useTraffic.getState().version;
      useDemo.getState().set({ injected: { incidentId, road: c.targetRoad }, status: 'evaluating' });
      pushToast(`SIMULATED incident: ${c.targetRoad} closed ahead`, 'error');
      const mu = m.current;
      const remaining = s.planArcs.slice(mu.arcIdx);
      const arc = remaining[0];
      if (!arc) throw new Error('no remaining plan at incident');
      const frac = Math.max(0, Math.min(1000, Math.floor(mu.frac)));
      const o = await engineClient.call('diversion.evaluate', {
        network: networkPayload(), overlay: overlayOf(),
        plan: { arcs: remaining },
        position: { arc, fractionPermille: frac },
        simTimeS: Math.floor(mu.simTimeS),
        config: { thresholdS: DEMO_DIVERSION_THRESHOLD_S }, policy: s.policy,
      }, { channel: 'demo-div' });
      if (o.stale) return;
      const d = DemoDivSchema.parse(o.result);
      useDemo.getState().set({ policy: d.policy as Record<string, unknown> });
      if (d.notify) {
        const banner: DiversionBanner = {
          decision: d.decision, reason: d.reason, savingS: d.savingS,
          currentEtaS: d.currentEtaS, candidateEtaS: d.candidateEtaS,
          candidateArcs: (d.candidate?.arcs ?? []).map((a) => a.arcId),
          frozen: { arcIdx: mu.arcIdx, arcId: arc, fracPermille: frac, simTimeS: Math.floor(mu.simTimeS) },
          overlayVersion,
        };
        useDemo.getState().set({ banner, status: 'awaiting_decision' });
      } else {
        // Honest stay: the engine, not the script, declined to recommend.
        useDemo.getState().set({ status: 'resumed' });
        pushToast(`Engine: stay on route (${d.decision} — ${d.reason})`);
      }
    } catch (e) {
      useDemo.getState().set({
        status: 'error',
        error: e instanceof EngineError ? `${e.code}: ${e.message}` : String(e),
      });
    } finally {
      m.current.checking = false;
    }
  }
  const injectRef = useRef(injectAndEvaluate);
  injectRef.current = injectAndEvaluate;

  // Main loop: advance sim clock, move the overlay, mirror state at <=10 Hz.
  // Only one rAF chain exists; the effect tears it down on status change.
  useEffect(() => {
    if (demo.status !== 'running' && demo.status !== 'resumed') return;
    let raf = 0;
    const tick = (now: number) => {
      const s = useDemo.getState();
      const mu = m.current;
      const dt = Math.max(0, (now - mu.lastWall) / 1000);
      mu.lastWall = now;
      if (pausedRef.current) {
        raf = requestAnimationFrame(tick);
        return;
      }
      mu.simTimeS += dt * s.speed;
      const dur = s.durations[mu.arcIdx];
      if (dur !== undefined && dur > 0) {
        mu.frac += ((dt * s.speed) / dur) * 1000;
        if (mu.frac >= 1000) {
          mu.arcIdx += 1;
          mu.frac = 0;
          if (mu.arcIdx >= s.planArcs.length) {
            mu.simTimeS = Math.round(mu.simTimeS);
            useDemo.getState().set({
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
        }
      }
      const c = s.scenario?.candidate;
      if (c && !s.injected && mu.arcIdx >= c.injectAtArcIdx) {
        void injectRef.current();
      }
      const cy = cyOut.current;
      const arcId = s.planArcs[mu.arcIdx];
      if (cy && arcId) {
        const leg = s.legs[arcId];
        if (leg) {
          const a = cy.getElementById(leg.from).renderedPosition();
          const b = cy.getElementById(leg.to).renderedPosition();
          const f = Math.min(1, Math.max(0, mu.frac / 1000));
          const x = a.x + (b.x - a.x) * f;
          const y = a.y + (b.y - a.y) * f;
          if (vehicleRef.current) {
            vehicleRef.current.style.transform = `translate(${x}px, ${y}px) translate(-50%,-50%)`;
          }
          if (arrowRef.current) {
            const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 90;
            arrowRef.current.style.transform = `translate(-50%,-50%) rotate(${deg}deg)`;
          }
          if (!reducedMotionRef.current) {
            trail.current.push({ x, y });
            if (trail.current.length > 6) trail.current.shift();
            const dots = trailRef.current?.children;
            if (dots) {
              for (let i = 0; i < dots.length; i++) {
                const dot = dots[i] as HTMLElement;
                const tp = trail.current[trail.current.length - 1 - i];
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
        useDemo.getState().set({
          pos: { arcIdx: mu.arcIdx, arcId: arcId ?? '', fracPermille: Math.floor(mu.frac), simTimeS: Math.floor(mu.simTimeS) },
        });
        if (cy && s.planVertices.length > 0) {
          const first = cy.getElementById(s.planVertices[0] ?? '');
          const last = cy.getElementById(s.planVertices[s.planVertices.length - 1] ?? '');
          if (first.length > 0 && flagSRef.current) {
            const p = first.renderedPosition();
            flagSRef.current.style.transform = `translate(${p.x}px, ${p.y - 30}px) translate(-50%,-50%)`;
          }
          if (last.length > 0 && flagFRef.current) {
            const p = last.renderedPosition();
            flagFRef.current.style.transform = `translate(${p.x}px, ${p.y - 30}px) translate(-50%,-50%)`;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    m.current.lastWall = performance.now();
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo.status, demo.speed]);

  const acceptRef = useRef<() => void>(() => {});
  // Explicit auto-demo choice: counts down, then accepts a recommended
  // diversion. Always labeled AUTO-DEMO; any manual click wins the race.
  useEffect(() => {
    if (demo.status !== 'awaiting_decision' || !autoChoice || !demo.banner) {
      setAutoIn(0);
      return;
    }
    if (demo.banner.decision.startsWith('STAY')) return;
    setAutoIn(5);
    const t = window.setInterval(() => {
      setAutoIn((n) => {
        if (n <= 1) {
          window.clearInterval(t);
          acceptRef.current();
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo.status, autoChoice]);

  async function accept() {
    const s = useDemo.getState();
    if (!s.banner) return;
    setAutoIn(0);
    const b = s.banner;
    try {
      const o = await engineClient.call('diversion.evaluate', {
        network: networkPayload(), overlay: overlayOf(),
        plan: { arcs: s.planArcs.slice(b.frozen.arcIdx) },
        position: { arc: b.frozen.arcId, fractionPermille: b.frozen.fracPermille },
        simTimeS: b.frozen.simTimeS, config: { thresholdS: DEMO_DIVERSION_THRESHOLD_S },
        action: 'accept', expectedVersion: b.overlayVersion,
        expectedPosition: { arc: b.frozen.arcId, fractionPermille: b.frozen.fracPermille },
        candidate: { arcs: b.candidateArcs }, policy: s.policy,
      }, { channel: 'demo-div' });
      if (o.stale) return;
      const a = AcceptSchema.parse(o.result);
      if (!a.accepted) {
        useDemo.getState().set({ error: 'Engine rejected stale accept; re-evaluating', banner: null, status: 'resumed' });
        return;
      }
      // Fresh durations under the CURRENT overlay (the old cache predates the closure).
      m.current.durCache.clear();
      m.current.distCache.clear();
      const durations: number[] = [];
      const distances: number[] = [];
      for (const arc of a.plan.arcs) {
        const e = await evalRef.current(arc.arcId, arc.from);
        durations.push(e.timeS);
        distances.push(e.distanceM);
      }
      m.current.arcIdx = 0;
      m.current.frac = b.frozen.fracPermille;
      m.current.simTimeS = b.frozen.simTimeS;
      m.current.accepts += 1;
      const legs = { ...useDemo.getState().legs };
      for (const arc of a.plan.arcs) legs[arc.arcId] = { from: arc.from, to: arc.to };
      const receipt: DecisionReceipt = {
        overlayVersion: b.overlayVersion,
        affectedRoads: s.injected ? [s.injected.road] : [],
        originalRemainingEtaS: b.currentEtaS,
        candidateRemainingEtaS: b.candidateEtaS,
        policyDecision: b.decision, policyReason: b.reason,
        savingEstimateS: b.savingS, userAction: 'accept',
        simTimeS: b.frozen.simTimeS, atArc: b.frozen.arcId,
      };
      useDemo.getState().set({
        planArcs: a.plan.arcs.map((x) => x.arcId), planVertices: a.plan.vertices,
        durations, distances, plannedTimeS: durations.reduce((x, y) => x + y, 0), legs,
        banner: null, receipt, status: 'resumed',
      });
      m.current.lastWall = performance.now();
      pushToast(`Diversion accepted, ETA ${b.candidateEtaS === null ? 'n/a' : formatSeconds(b.candidateEtaS)}`);
    } catch (e) {
      useDemo.getState().set({
        error: e instanceof EngineError ? `${e.code}: ${e.message}` : String(e),
        banner: null, status: 'resumed',
      });
    }
  }

  acceptRef.current = () => void accept();

  async function stay() {
    const s = useDemo.getState();
    if (!s.banner) return;
    setAutoIn(0);
    const b = s.banner;
    try {
      const o = await engineClient.call('diversion.evaluate', {
        network: networkPayload(), overlay: overlayOf(),
        plan: { arcs: s.planArcs.slice(b.frozen.arcIdx) },
        position: { arc: b.frozen.arcId, fractionPermille: b.frozen.fracPermille },
        simTimeS: b.frozen.simTimeS, config: { thresholdS: DEMO_DIVERSION_THRESHOLD_S },
        action: 'reject', policy: s.policy,
      }, { channel: 'demo-div' });
      if (!o.stale) {
        const d = DemoDivSchema.parse(o.result);
        useDemo.getState().set({ policy: d.policy as Record<string, unknown> });
      }
    } catch {
      /* failed reject still dismisses locally */
    }
    m.current.stays += 1;
    const receipt: DecisionReceipt = {
      overlayVersion: b.overlayVersion,
      affectedRoads: s.injected ? [s.injected.road] : [],
      originalRemainingEtaS: b.currentEtaS,
      candidateRemainingEtaS: b.candidateEtaS,
      policyDecision: b.decision, policyReason: b.reason,
      savingEstimateS: b.savingS, userAction: 'stay',
      simTimeS: b.frozen.simTimeS, atArc: b.frozen.arcId,
    };
    useDemo.getState().set({ banner: null, receipt, status: 'resumed' });
    m.current.lastWall = performance.now();
    pushToast('Stayed on route');
  }

  function replay() {
    cleanupInjection();
    useDemo.getState().reset();
    m.current = freshMutable();
    trail.current = [];
    setPaused(false);
    setAutoIn(0);
  }

  const progress = demo.planArcs.length === 0 ? 0
    : Math.min(1, (demo.pos.arcIdx + demo.pos.fracPermille / 1000) / demo.planArcs.length);
  const stage = stageOf(demo.status);
  const currentLeg = demo.legs[demo.pos.arcId];
  const running = demo.status === 'running' || demo.status === 'resumed';
  const showVehicle = running || demo.status === 'incident'
    || demo.status === 'evaluating' || demo.status === 'awaiting_decision';
  const [panelHidden, setPanelHidden] = useState(false);

  const narration = NARRATION[stage] ?? NARRATION[0]!;

  return (
    <div className={presenter ? 'pf-present' : undefined}>
      <button className="pf-btn small pf-panel-toggle" data-testid="panel-toggle"
        aria-expanded={!panelHidden} onClick={() => setPanelHidden(!panelHidden)}>
        {panelHidden ? 'Show panel' : 'Hide panel'}
      </button>
      <ol className="pf-stages" data-testid="demo-stages" aria-label="Demo stages">
        {STAGES.map((name, i) => (
          <li key={name} data-testid={`demo-stage-${i}`}
            aria-current={i === stage ? 'step' : undefined}
            className={i === stage ? 'active' : i < stage ? 'done' : ''}>
            {i + 1}. {name}
          </li>
        ))}
      </ol>
      <div className={`pf-workspace${panelHidden ? ' panel-hidden' : ''}`}>
        <div className="pf-map-wrap" style={{ position: 'relative' }}>
          <MapView routeArcIds={demo.planArcs} cyOut={cyOut}
            statsExtra={demo.planArcs.length > 0 ? `${demo.planArcs.length} segments` : undefined} />
          {(running || showVehicle) && (
            <div ref={trailRef} data-testid="demo-trail" aria-hidden="true"
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              {[0.5, 0.42, 0.34, 0.26, 0.18, 0.1].map((op, i) => (
                <div key={i} style={{
                  position: 'absolute', top: 0, left: 0, width: 10, height: 10,
                  borderRadius: '50%', background: 'var(--pf-accent)', opacity: op,
                  transform: 'translate(-100px,-100px)',
                }} />
              ))}
            </div>
          )}
          {(running || showVehicle) && (
            <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              <div ref={flagSRef} data-testid="demo-flag-start"
                style={{ position: 'absolute', top: 0, left: 0 }}>
                <span className="pf-chip ok">S</span>
              </div>
              <div ref={flagFRef} data-testid="demo-flag-finish"
                style={{ position: 'absolute', top: 0, left: 0 }}>
                <span className="pf-chip info">F</span>
              </div>
            </div>
          )}
          {showVehicle && (
            <div ref={vehicleRef} data-testid="demo-vehicle" data-arc={demo.pos.arcId}
              data-frac={demo.pos.fracPermille} aria-hidden="true"
              style={{
                position: 'absolute', top: 0, left: 0, width: 28, height: 28,
                borderRadius: '50%', background: 'var(--pf-accent)',
                border: '3px solid var(--pf-paper)', pointerEvents: 'none',
                boxShadow: 'var(--pf-shadow)',
              }}>
              <div ref={arrowRef} style={{
                position: 'absolute', top: '50%', left: '50%', width: 0, height: 0,
                borderLeft: '6px solid transparent', borderRight: '6px solid transparent',
                borderBottom: '10px solid var(--pf-paper)',
              }} />
            </div>
          )}
        </div>
        <div className="pf-panel">
          {demo.status === 'awaiting_decision' && demo.banner && (
            <section className="pf-card pf-decision" aria-label="Diversion decision" data-testid="demo-decision">
              <h2>SIMULATED incident ahead</h2>
              <p data-testid="demo-decision-text">
                {demo.banner.decision} — {demo.banner.reason}. Current remaining ETA{' '}
                {demo.banner.currentEtaS <= 0 ? 'blocked' : formatSeconds(demo.banner.currentEtaS)}
                {demo.banner.candidateEtaS !== null && (
                  <>, recommended {formatSeconds(demo.banner.candidateEtaS)}
                    {demo.banner.savingS !== null && <> (saves ~{formatSeconds(demo.banner.savingS)})</>}</>
                )}.
              </p>
              {autoIn > 0 && (
                <p className="pf-meta" data-testid="demo-autoin">
                  AUTO-DEMO choice in {autoIn} s (click either button to decide yourself)
                </p>
              )}
              <div className="pf-row">
                <button className="pf-btn primary" onClick={() => void accept()} data-testid="demo-accept">
                  Accept Diversion
                </button>
                <button className="pf-btn" onClick={() => void stay()} data-testid="demo-stay">
                  Stay on Route
                </button>
              </div>
            </section>
          )}
          <section className="pf-card" aria-label="Smart demo controls">
            <h2>Smart Journey Demo</h2>
            <p className="pf-meta" data-testid="engine-status">Engine: {engineStatus}</p>
            <p className="pf-meta" role="status" data-testid="demo-status">Status: {demo.status}</p>
            <div className="pf-row">
              <label className="pf-check">
                <input type="checkbox" checked={guided} onChange={(e) => setGuided(e.target.checked)}
                  data-testid="demo-guided" /> Guided mode
              </label>
              <label className="pf-check">
                <input type="checkbox" checked={presenter} onChange={(e) => setPresenter(e.target.checked)}
                  data-testid="demo-presenter" /> Presenter mode
              </label>
            </div>
            <label className="pf-check">
              <input type="checkbox" checked={autoChoice} onChange={(e) => setAutoChoice(e.target.checked)}
                data-testid="demo-autochoice" /> AUTO-DEMO choice: accept recommended diversions after 5 s
            </label>
            <blockquote className="pf-narrate" data-testid="demo-narrator">
              <strong>{narration.title}.</strong> {narration.say}
            </blockquote>
            <div data-testid="demo-progress" role="progressbar"
              aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}
              aria-label="Demo progress"
              style={{ height: 12, borderRadius: 6, background: 'var(--pf-paper-sink)', overflow: 'hidden' }}>
              <div style={{ width: `${(progress * 100).toFixed(1)}%`, height: '100%', background: 'var(--pf-accent)' }} />
            </div>
            {demo.scenario && (
              <p data-testid="demo-plan">
                {vertexName(demo.scenario.source)} → {vertexName(demo.scenario.target)} ·{' '}
                {formatSeconds(demo.scenario.route.timeS)} · {formatMetres(demo.scenario.route.distanceM)} ·{' '}
                {formatInr(demo.scenario.route.tollInr)} toll · {demo.scenario.algorithm}
              </p>
            )}
            {demo.scenario && demo.scenario.alternatives.length > 0 && (
              <ul data-testid="demo-alts">
                {demo.scenario.alternatives.map((a, i) => (
                  <li key={i} data-testid={`demo-alt-${i}`}>
                    Alt {i + 1}: {formatSeconds(a.timeS)} ({a.timeS >= demo.scenario!.route.timeS ? '+' : ''}
                    {formatSeconds(a.timeS - demo.scenario!.route.timeS)}) · {formatMetres(a.distanceM)} ·{' '}
                    {formatInr(a.tollInr)} toll
                  </li>
                ))}
              </ul>
            )}
            {demo.injected && (
              <p className="pf-alert warn" data-testid="demo-incident">
                SIMULATED incident: {demo.injected.road} closed ahead
                {demo.scenario?.candidate && (
                  <> ({vertexName(demo.scenario.candidate.targetFrom)} → {vertexName(demo.scenario.candidate.targetTo)})</>
                )}
              </p>
            )}
            {demo.scenario && !demo.scenario.candidate && (
              <p data-testid="demo-no-diversion">{demo.scenario.noDiversionDetail}</p>
            )}
            {demo.scenario && (
              <button className="pf-btn" onClick={() => setExplainOpen(true)} data-testid="demo-why">
                Why This Route?
              </button>
            )}
            {running && currentLeg && (
              <p data-testid="demo-leg">
                {vertexName(currentLeg.from)} → {vertexName(currentLeg.to)} · {formatSeconds(demo.pos.simTimeS)} elapsed
              </p>
            )}
            <div className="pf-row">
              {(demo.status === 'idle' || demo.status === 'completed' || demo.status === 'error') && (
                <button className="pf-btn primary" onClick={() => void start()} data-testid="demo-start">
                  {demo.status === 'idle' ? 'Start Smart Demo' : 'Replay Demo'}
                </button>
              )}
              {running && (
                <button className="pf-btn" onClick={() => setPaused((p) => !p)} data-testid="demo-pause">
                  {paused ? 'Play' : 'Pause'}
                </button>
              )}
              {demo.status !== 'idle' && demo.status !== 'preparing' && (
                <button className="pf-btn" onClick={replay} data-testid="demo-replay">Reset</button>
              )}
            </div>
            <div className="pf-field">
              <label htmlFor="demo-speed">Speed</label>
              <select id="demo-speed" value={demo.speed}
                onChange={(e) => demo.set({ speed: Number(e.target.value) })} data-testid="demo-speed">
                {DEMO_SPEEDS.map((v) => <option key={v} value={v}>{v}×</option>)}
              </select>
              <p className="pf-meta">{demo.speed}×: one wall-clock second advances {demo.speed} simulated seconds.</p>
            </div>
            {demo.error && <div className="pf-alert error" role="alert" data-testid="demo-error">{demo.error}</div>}
          </section>
          {demo.receipt && (
            <section className="pf-card" aria-label="Decision receipt" data-testid="demo-receipt">
              <h2>Decision receipt</h2>
              <dl className="pf-facts">
                <dt>Overlay</dt><dd data-testid="demo-receipt-overlay">v{demo.receipt.overlayVersion}</dd>
                <dt>Roads</dt><dd>{demo.receipt.affectedRoads.join(', ') || '—'}</dd>
                <dt>Original ETA</dt>
                <dd>{demo.receipt.originalRemainingEtaS <= 0 ? 'blocked' : formatSeconds(demo.receipt.originalRemainingEtaS)}</dd>
                <dt>Recommended ETA</dt>
                <dd>{demo.receipt.candidateRemainingEtaS === null ? 'n/a' : formatSeconds(demo.receipt.candidateRemainingEtaS)}</dd>
                <dt>Policy</dt><dd data-testid="demo-receipt-policy">{demo.receipt.policyDecision} — {demo.receipt.policyReason}</dd>
                <dt>Saved (est.)</dt>
                <dd>{demo.receipt.savingEstimateS === null ? 'n/a' : formatSeconds(demo.receipt.savingEstimateS)}</dd>
                <dt>Action</dt><dd data-testid="demo-receipt-action">{demo.receipt.userAction}</dd>
              </dl>
            </section>
          )}
          {demo.summary && (
            <section className="pf-card" aria-label="Demo summary" data-testid="demo-summary">
              <h2>Journey summary</h2>
              <p data-testid="demo-summary-text">
                {vertexName(demo.summary.origin)} → {vertexName(demo.summary.destination)} ·{' '}
                planned {formatSeconds(demo.summary.plannedTimeS)}, simulated {formatSeconds(demo.summary.actualSimTimeS)} ·{' '}
                {formatMetres(demo.summary.distanceM)} · {demo.summary.arcsTraversed} segments ·{' '}
                {demo.summary.diversionsAccepted} accepted, {demo.summary.stays} stays
              </p>
            </section>
          )}
          {demo.scenario && (
            <ExplainDrawer open={explainOpen} onClose={() => setExplainOpen(false)} testid="demo-why"
              source={demo.scenario.source} target={demo.scenario.target}
              objective={demo.scenario.objective} algorithm={demo.scenario.algorithm}
              arcs={demo.scenario.route.arcs} vertices={demo.scenario.route.vertices}
              totals={{
                timeS: demo.scenario.route.timeS, distanceM: demo.scenario.route.distanceM,
                tollInr: demo.scenario.route.tollInr,
              }}
              alternatives={demo.scenario.alternatives.map((a, i) => ({
                label: `alt${i}`, timeS: a.timeS, distanceM: a.distanceM, tollInr: a.tollInr,
                arcs: a.arcs.map((x) => x.arcId),
              }))} />
          )}
          <VivaCard page="demo" />
          <Confirm open={confirmOverwrite} title="Start demo?"
            body="This resets the demo and injects a SIMULATED incident into the shared traffic overlay. A journey or demo may be in progress."
            confirmLabel="Start anyway" testid="demo-overwrite"
            onCancel={() => setConfirmOverwrite(false)}
            onConfirm={() => void runPrepare()} />
        </div>
      </div>
    </div>
  );
}
