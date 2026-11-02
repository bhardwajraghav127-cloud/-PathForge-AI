// Real-road Smart Demo (R4): the proven demo FSM over genuine OSM streets.
// Connaught Place → Central Vista, deterministic SIMULATED closure from a
// policy search, real diversion evaluation, accept/stay without teleports.
// The vehicle marker interpolates along TRUE edge geometry (pointAt).
import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { Marker, type Map as MLMap } from 'maplibre-gl';
import RealMap from '../realmap/RealMap';
import SourceBadge from '../realmap/SourceBadge';
import { Confirm, useToasts } from '../components/ui';
import { engineClient, useEngineStatus } from '../engine/client';
import { EngineError } from '../engine/EngineClient';
import { formatMetres, formatSeconds } from '../data/dataset';
import { useSim } from '../simulation';
import { useDemo, type DecisionReceipt } from '../demo/store';
import { useFleet } from '../fleet/store';
import { DemoDivSchema, DemoEvalSchema } from '../demo/scenario';
import { useRealTraffic } from '../realmap/realTraffic';
import { useRealDemo } from '../realmap/realDemoStore';
import { REAL_DEMO_THRESHOLD_S, prepareRealScenario } from '../realmap/realScenario';
import {
  REAL_BOUNDS, REAL_CENTER, joinArcs, pointAt, realLabels,
  realNetworkPayload, realRoadsGeo,
} from '../realmap/realData';
import { REAL_META } from '../realmap/realMeta';

const AcceptSchema = z.object({
  accepted: z.boolean(),
  plan: z.object({
    arcs: z.array(z.object({ arcId: z.string(), from: z.string(), to: z.string() })).catch([]),
    vertices: z.array(z.string()).catch([]),
  }),
}).passthrough();

const SPEEDS = [1, 5, 10, 30, 60];
const STAGES = ['Prepare', 'Plan', 'Depart', 'Disrupt', 'Analyze', 'Decide', 'Continue', 'Finish'];

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

export default function RealDemo() {
  const engineStatus = useEngineStatus();
  const demo = useRealDemo();
  const overlayOf = useRealTraffic((s) => s.overlay);
  const pushToast = useToasts((s) => s.push);
  const mapOut = useRef<MLMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const m = useRef<Mutable>(freshMutable());
  const [paused, setPaused] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const roads = useMemo(() => realRoadsGeo(), []);
  const labels = useMemo(() => realLabels(), []);

  async function evalArc(arcId: string, from: string): Promise<{ timeS: number; distanceM: number }> {
    const t = m.current.durCache.get(arcId);
    const d = m.current.distCache.get(arcId);
    if (t !== undefined && d !== undefined) return { timeS: t, distanceM: d };
    const o = await engineClient.call(
      'route.evaluate',
      { network: realNetworkPayload(), overlay: overlayOf(), objective: 'FASTEST', plan: { arcs: [arcId], source: from } },
      { channel: 'realdemo' },
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
    const inj = useRealDemo.getState().injected;
    if (!inj) return;
    const t = useRealTraffic.getState();
    t.removeIncident(inj.incidentId);
    if (t.closures.includes(inj.road)) t.toggleClosure(inj.road);
    useRealDemo.getState().set({ injected: null });
  }

  function otherActive(): boolean {
    const js = useSim.getState().status;
    const ds = useDemo.getState().status;
    const fs = useFleet.getState().status;
    return js === 'running' || js === 'paused' || js === 'starting'
      || (ds !== 'idle' && ds !== 'completed' && ds !== 'error')
      || fs === 'running' || fs === 'paused' || fs === 'starting';
  }

  async function start() {
    const st = useRealDemo.getState().status;
    if (st === 'preparing' || st === 'running' || st === 'resumed') return;
    if (otherActive() || (st !== 'idle' && st !== 'completed' && st !== 'error')) {
      setConfirmOverwrite(true);
      return;
    }
    await runPrepare();
  }

  async function runPrepare() {
    setConfirmOverwrite(false);
    cleanupInjection();
    useRealDemo.getState().reset();
    useRealDemo.getState().set({ status: 'preparing', error: '' });
    m.current = freshMutable();
    try {
      const scenario = await prepareRealScenario(overlayOf());
      const durations: number[] = [];
      const distances: number[] = [];
      for (const a of scenario.route.arcs) {
        const e = await evalRef.current(a.arcId, a.from);
        durations.push(e.timeS);
        distances.push(e.distanceM);
      }
      const legs: Record<string, { from: string; to: string }> = {};
      for (const a of scenario.route.arcs) legs[a.arcId] = { from: a.from, to: a.to };
      useRealDemo.getState().set({
        status: 'prepared', scenario,
        planArcs: scenario.route.arcs.map((a) => a.arcId),
        planVertices: scenario.route.vertices,
        durations, distances, plannedTimeS: durations.reduce((x, y) => x + y, 0), legs,
        pos: { arcIdx: 0, arcId: scenario.route.arcs[0]?.arcId ?? '', fracPermille: 0, simTimeS: 0 },
        policy: {},
      });
      pushToast(scenario.candidate
        ? `Real demo ready: ${scenario.route.arcs.length} segments, incident planned on ${scenario.candidate.targetRoad}`
        : 'Real demo ready: no beneficial diversion found, drive-through mode');
      useRealDemo.getState().set({ status: 'running' });
      m.current.lastWall = performance.now();
    } catch (e) {
      useRealDemo.getState().set({
        status: 'error',
        error: e instanceof EngineError ? `${e.code}: ${e.message}` : String(e),
      });
    }
  }

  async function injectAndEvaluate() {
    const s = useRealDemo.getState();
    const c = s.scenario?.candidate;
    if (!c || s.injected || m.current.checking) return;
    m.current.checking = true;
    useRealDemo.getState().set({ status: 'incident' });
    try {
      const t = useRealTraffic.getState();
      const incidentId = t.addIncident(c.targetRoad, 'both', 'accident');
      if (!useRealTraffic.getState().closures.includes(c.targetRoad)) {
        useRealTraffic.getState().toggleClosure(c.targetRoad);
      }
      const overlayVersion = useRealTraffic.getState().version;
      useRealDemo.getState().set({ injected: { incidentId, road: c.targetRoad }, status: 'evaluating' });
      pushToast(`SIMULATED incident: ${c.targetRoad} closed ahead`, 'error');
      const mu = m.current;
      const remaining = s.planArcs.slice(mu.arcIdx);
      const arc = remaining[0];
      if (!arc) throw new Error('no remaining plan at incident');
      const frac = Math.max(0, Math.min(1000, Math.floor(mu.frac)));
      const o = await engineClient.call('diversion.evaluate', {
        network: realNetworkPayload(), overlay: overlayOf(),
        plan: { arcs: remaining },
        position: { arc, fractionPermille: frac },
        simTimeS: Math.floor(mu.simTimeS),
        config: { thresholdS: REAL_DEMO_THRESHOLD_S }, policy: s.policy,
      }, { channel: 'realdemo-div' });
      if (o.stale) return;
      const d = DemoDivSchema.parse(o.result);
      useRealDemo.getState().set({ policy: d.policy as Record<string, unknown> });
      if (d.notify) {
        useRealDemo.getState().set({
          banner: {
            decision: d.decision, reason: d.reason, savingS: d.savingS,
            currentEtaS: d.currentEtaS, candidateEtaS: d.candidateEtaS,
            candidateArcs: (d.candidate?.arcs ?? []).map((a) => a.arcId),
            frozen: { arcIdx: mu.arcIdx, arcId: arc, fracPermille: frac, simTimeS: Math.floor(mu.simTimeS) },
            overlayVersion,
          },
          status: 'awaiting_decision',
        });
      } else {
        useRealDemo.getState().set({ status: 'resumed' });
        pushToast(`Engine: stay on route (${d.decision} — ${d.reason})`);
      }
    } catch (e) {
      useRealDemo.getState().set({
        status: 'error',
        error: e instanceof EngineError ? `${e.code}: ${e.message}` : String(e),
      });
    } finally {
      m.current.checking = false;
    }
  }
  const injectRef = useRef(injectAndEvaluate);
  injectRef.current = injectAndEvaluate;

  // Vehicle marker lifecycle: created when driving, removed on reset/done.
  useEffect(() => {
    const show = demo.status === 'running' || demo.status === 'resumed'
      || demo.status === 'incident' || demo.status === 'evaluating'
      || demo.status === 'awaiting_decision';
    if (show && mapOut.current && !markerRef.current) {
      const el = document.createElement('div');
      el.className = 'pf-mappin';
      el.textContent = '▶';
      el.style.background = 'var(--pf-accent)';
      el.setAttribute('data-testid', 'realdemo-vehicle');
      const first = useRealDemo.getState().planArcs[0];
      const start = first ? pointAt(first, 0) : null;
      markerRef.current = new Marker({ element: el, anchor: 'center' })
        .setLngLat(start ?? REAL_CENTER)
        .addTo(mapOut.current);
    } else if (!show && markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }
  }, [demo.status]);

  useEffect(() => {
    if (demo.status !== 'running' && demo.status !== 'resumed') return;
    let raf = 0;
    const tick = (now: number) => {
      const s = useRealDemo.getState();
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
            useRealDemo.getState().set({
              status: 'completed',
              pos: { arcIdx: mu.arcIdx, arcId: '', fracPermille: 1000, simTimeS: Math.floor(mu.simTimeS) },
              summary: {
                origin: s.planVertices[0] ?? '', destination: s.planVertices[s.planVertices.length - 1] ?? '',
                objective: 'FASTEST', plannedTimeS: s.plannedTimeS,
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
      const arcId = s.planArcs[mu.arcIdx];
      if (arcId && markerRef.current) {
        const p = pointAt(arcId, mu.frac);
        if (p) markerRef.current.setLngLat(p);
      }
      if (now - mu.lastMirror >= 100) {
        mu.lastMirror = now;
        useRealDemo.getState().set({
          pos: { arcIdx: mu.arcIdx, arcId: arcId ?? '', fracPermille: Math.floor(mu.frac), simTimeS: Math.floor(mu.simTimeS) },
        });
      }
      raf = requestAnimationFrame(tick);
    };
    m.current.lastWall = performance.now();
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo.status, demo.speed]);

  async function accept() {
    const s = useRealDemo.getState();
    if (!s.banner) return;
    const b = s.banner;
    try {
      const o = await engineClient.call('diversion.evaluate', {
        network: realNetworkPayload(), overlay: overlayOf(),
        plan: { arcs: s.planArcs.slice(b.frozen.arcIdx) },
        position: { arc: b.frozen.arcId, fractionPermille: b.frozen.fracPermille },
        simTimeS: b.frozen.simTimeS, config: { thresholdS: REAL_DEMO_THRESHOLD_S },
        action: 'accept', expectedVersion: b.overlayVersion,
        expectedPosition: { arc: b.frozen.arcId, fractionPermille: b.frozen.fracPermille },
        candidate: { arcs: b.candidateArcs }, policy: s.policy,
      }, { channel: 'realdemo-div' });
      if (o.stale) return;
      const a = AcceptSchema.parse(o.result);
      if (!a.accepted) {
        useRealDemo.getState().set({ error: 'Engine rejected stale accept', banner: null, status: 'resumed' });
        return;
      }
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
      const legs = { ...useRealDemo.getState().legs };
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
      useRealDemo.getState().set({
        planArcs: a.plan.arcs.map((x) => x.arcId), planVertices: a.plan.vertices,
        durations, distances, plannedTimeS: durations.reduce((x, y) => x + y, 0), legs,
        banner: null, receipt, status: 'resumed',
      });
      m.current.lastWall = performance.now();
      pushToast(`Diversion accepted, ETA ${b.candidateEtaS === null ? 'n/a' : formatSeconds(b.candidateEtaS)} (est.)`);
    } catch (e) {
      useRealDemo.getState().set({
        error: e instanceof EngineError ? `${e.code}: ${e.message}` : String(e),
        banner: null, status: 'resumed',
      });
    }
  }

  async function stay() {
    const s = useRealDemo.getState();
    if (!s.banner) return;
    const b = s.banner;
    try {
      const o = await engineClient.call('diversion.evaluate', {
        network: realNetworkPayload(), overlay: overlayOf(),
        plan: { arcs: s.planArcs.slice(b.frozen.arcIdx) },
        position: { arc: b.frozen.arcId, fractionPermille: b.frozen.fracPermille },
        simTimeS: b.frozen.simTimeS, config: { thresholdS: REAL_DEMO_THRESHOLD_S },
        action: 'reject', policy: s.policy,
      }, { channel: 'realdemo-div' });
      if (!o.stale) {
        const d = DemoDivSchema.parse(o.result);
        useRealDemo.getState().set({ policy: d.policy as Record<string, unknown> });
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
    useRealDemo.getState().set({ banner: null, receipt, status: 'resumed' });
    m.current.lastWall = performance.now();
    pushToast('Stayed on route');
  }

  function replay() {
    cleanupInjection();
    useRealDemo.getState().reset();
    m.current = freshMutable();
    setPaused(false);
  }

  const progress = demo.planArcs.length === 0 ? 0
    : Math.min(1, (demo.pos.arcIdx + demo.pos.fracPermille / 1000) / demo.planArcs.length);
  const stage = stageOf(demo.status);
  const running = demo.status === 'running' || demo.status === 'resumed';
  const [panelHidden, setPanelHidden] = useState(false);

  return (
    <div>
      <button className="pf-btn small pf-panel-toggle" data-testid="panel-toggle"
        aria-expanded={!panelHidden} onClick={() => setPanelHidden(!panelHidden)}>
        {panelHidden ? 'Show panel' : 'Hide panel'}
      </button>
      <ol className="pf-stages" data-testid="realdemo-stages" aria-label="Demo stages">
        {STAGES.map((name, i) => (
          <li key={name} data-testid={`realdemo-stage-${i}`}
            aria-current={i === stage ? 'step' : undefined}
            className={i === stage ? 'active' : i < stage ? 'done' : ''}>
            {i + 1}. {name}
          </li>
        ))}
      </ol>
      <div className={`pf-workspace${panelHidden ? ' panel-hidden' : ''}`}>
        <div className="pf-map-wrap pf-map-tall">
          <RealMap testid="realmap" initialCenter={REAL_CENTER} initialZoom={13}
            fitBounds={REAL_BOUNDS} roads={roads} labels={labels} mapOut={mapOut}
            route={demo.planArcs.length > 0 ? joinArcs(demo.planArcs) : null} />
        </div>
        <div className="pf-panel">
          {demo.status === 'awaiting_decision' && demo.banner && (
            <section className="pf-card pf-decision" aria-label="Diversion decision" data-testid="realdemo-decision">
              <h2>SIMULATED incident ahead</h2>
              <p data-testid="realdemo-decision-text">
                {demo.banner.decision} — {demo.banner.reason}. Current remaining ETA{' '}
                {demo.banner.currentEtaS <= 0 ? 'blocked' : formatSeconds(demo.banner.currentEtaS)}
                {demo.banner.candidateEtaS !== null && (
                  <>, recommended {formatSeconds(demo.banner.candidateEtaS)}
                    {demo.banner.savingS !== null && <> (saves ~{formatSeconds(demo.banner.savingS)})</>}</>
                )}.
              </p>
              <div className="pf-row">
                <button className="pf-btn primary" onClick={() => void accept()} data-testid="realdemo-accept">
                  Accept Diversion
                </button>
                <button className="pf-btn" onClick={() => void stay()} data-testid="realdemo-stay">
                  Stay on Route
                </button>
              </div>
            </section>
          )}
          <section className="pf-card" aria-label="Real demo controls">
            <h2>Real Smart Demo</h2>
            <p className="pf-meta" data-testid="engine-status">Engine: {engineStatus}</p>
            <p className="pf-meta" role="status" data-testid="realdemo-status">Status: {demo.status}</p>
            <div data-testid="realdemo-progress" role="progressbar"
              aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}
              aria-label="Demo progress"
              style={{ height: 12, borderRadius: 6, background: 'var(--pf-paper-sink)', overflow: 'hidden' }}>
              <div style={{ width: `${(progress * 100).toFixed(1)}%`, height: '100%', background: 'var(--pf-accent)' }} />
            </div>
            {demo.scenario && (
              <p data-testid="realdemo-plan">
                Connaught Place → Central Vista · {formatSeconds(demo.scenario.route.timeS)} (est.) ·{' '}
                {formatMetres(demo.scenario.route.distanceM)} · {demo.scenario.route.arcs.length} segments
              </p>
            )}
            {demo.scenario && !demo.scenario.candidate && (
              <p data-testid="realdemo-no-diversion">{demo.scenario.noDiversionDetail}</p>
            )}
            {demo.injected && (
              <p className="pf-alert warn" data-testid="realdemo-incident">
                SIMULATED incident: {demo.injected.road} closed ahead
              </p>
            )}
            {running && (
              <p data-testid="realdemo-leg">
                Segment {demo.pos.arcIdx + 1}/{demo.planArcs.length} · {formatSeconds(demo.pos.simTimeS)} elapsed
              </p>
            )}
            <div className="pf-row">
              {(demo.status === 'idle' || demo.status === 'completed' || demo.status === 'error') && (
                <button className="pf-btn primary" onClick={() => void start()} data-testid="realdemo-start">
                  {demo.status === 'idle' ? 'Start Real Demo' : 'Replay Real Demo'}
                </button>
              )}
              {running && (
                <button className="pf-btn" onClick={() => setPaused((p) => !p)} data-testid="realdemo-pause">
                  {paused ? 'Play' : 'Pause'}
                </button>
              )}
              {demo.status !== 'idle' && demo.status !== 'preparing' && (
                <button className="pf-btn" onClick={replay} data-testid="realdemo-replay">Reset</button>
              )}
            </div>
            <div className="pf-field">
              <label htmlFor="realdemo-speed">Speed</label>
              <select id="realdemo-speed" value={demo.speed}
                onChange={(e) => demo.set({ speed: Number(e.target.value) })} data-testid="realdemo-speed">
                {SPEEDS.map((v) => <option key={v} value={v}>{v}×</option>)}
              </select>
              <p className="pf-meta">{demo.speed}×: one wall-clock second advances {demo.speed} simulated seconds.</p>
            </div>
            {demo.error && <div className="pf-alert error" role="alert" data-testid="realdemo-error">{demo.error}</div>}
          </section>
          {demo.receipt && (
            <section className="pf-card" aria-label="Decision receipt" data-testid="realdemo-receipt">
              <h2>Decision receipt</h2>
              <dl className="pf-facts">
                <dt>Overlay</dt><dd data-testid="realdemo-receipt-overlay">v{demo.receipt.overlayVersion}</dd>
                <dt>Roads</dt><dd>{demo.receipt.affectedRoads.join(', ') || '—'}</dd>
                <dt>Original ETA</dt>
                <dd>{demo.receipt.originalRemainingEtaS <= 0 ? 'blocked' : formatSeconds(demo.receipt.originalRemainingEtaS)}</dd>
                <dt>Recommended ETA</dt>
                <dd>{demo.receipt.candidateRemainingEtaS === null ? 'n/a' : formatSeconds(demo.receipt.candidateRemainingEtaS)}</dd>
                <dt>Policy</dt><dd data-testid="realdemo-receipt-policy">{demo.receipt.policyDecision} — {demo.receipt.policyReason}</dd>
                <dt>Saved (est.)</dt>
                <dd>{demo.receipt.savingEstimateS === null ? 'n/a' : formatSeconds(demo.receipt.savingEstimateS)}</dd>
                <dt>Action</dt><dd data-testid="realdemo-receipt-action">{demo.receipt.userAction}</dd>
              </dl>
            </section>
          )}
          {demo.summary && (
            <section className="pf-card" aria-label="Demo summary" data-testid="realdemo-summary">
              <h2>Journey summary</h2>
              <p data-testid="realdemo-summary-text">
                Connaught Place → Central Vista · planned {formatSeconds(demo.summary.plannedTimeS)} (est.),{' '}
                simulated {formatSeconds(demo.summary.actualSimTimeS)} · {formatMetres(demo.summary.distanceM)} ·{' '}
                {demo.summary.arcsTraversed} segments · {demo.summary.diversionsAccepted} accepted,{' '}
                {demo.summary.stays} stays
              </p>
            </section>
          )}
          <SourceBadge meta={REAL_META} />
          <Confirm open={confirmOverwrite} title="Start real demo?"
            body="This resets the real demo and injects a SIMULATED incident into the real-roads overlay. Another simulation may be in progress."
            confirmLabel="Start anyway" testid="realdemo-overwrite"
            onCancel={() => setConfirmOverwrite(false)}
            onConfirm={() => void runPrepare()} />
        </div>
      </div>
    </div>
  );
}
