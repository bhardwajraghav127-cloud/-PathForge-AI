// Fleet Command Center (V3): two-vehicle vertical slice. One rAF loop
// advances independent per-vehicle clocks; engine routing happens only on
// events (plan, traffic change, periodic check, accept/stay). A closure
// affects only vehicles whose future plan uses that directed road — the
// diversion policy decides per vehicle, never the script.
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import type { Core } from 'cytoscape';
import MapView from '../components/MapView';
import { Confirm, useToasts } from '../components/ui';
import { engineClient, useEngineStatus } from '../engine/client';
import { EngineError } from '../engine/EngineClient';
import { ROADS, formatMetres, formatSeconds, networkPayload, vertexName } from '../data/dataset';
import { useTraffic } from '../traffic';
import { useSim } from '../simulation';
import { useDemo } from '../demo/store';
import { DemoDivSchema, DemoEvalSchema, DemoRouteSchema } from '../demo/scenario';
import ExplainDrawer from '../explain/ExplainDrawer';
import VivaCard from '../components/VivaCard';
import {
  FLEET_SPEEDS, VEHICLE_COLORS, blankVehicle, useFleet, type FleetPair, type VehicleDecision,
} from '../fleet/store';

const AcceptSchema = z.object({
  accepted: z.boolean(),
  plan: z.object({
    arcs: z.array(z.object({ arcId: z.string(), from: z.string(), to: z.string() })).catch([]),
    vertices: z.array(z.string()).catch([]),
  }),
}).passthrough();

// Engine-verified reachable pairs (native pf_contract_runner, V3/V4).
// V3 Gamma (rohtak→jind) has a single inbound road (wr10): closing it
// mid-run yields a genuine engine NO_ROUTE_AVAILABLE for blocked testing.
const DEFAULTS: FleetPair[] = [
  { origin: 'chandigarh', destination: 'delhi', objective: 'FASTEST' },
  { origin: 'patiala', destination: 'rohtak', objective: 'FASTEST' },
  { origin: 'rohtak', destination: 'jind', objective: 'FASTEST' },
  { origin: 'ambala', destination: 'sonipat', objective: 'FASTEST' },
  { origin: 'karnal', destination: 'gurugram', objective: 'FASTEST' },
];
const ADDABLES: FleetPair[] = [
  { origin: 'panipat', destination: 'meerut', objective: 'FASTEST' },
  { origin: 'zirakpur', destination: 'meerut', objective: 'FASTEST' },
  { origin: 'chandigarh', destination: 'rohtak', objective: 'FASTEST' },
  { origin: 'delhi', destination: 'chandigarh', objective: 'FASTEST' },
  { origin: 'ambala', destination: 'delhi', objective: 'FASTEST' },
  { origin: 'sonipat', destination: 'panipat', objective: 'FASTEST' },
];
const LABELS = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa'];
const MAX_VEHICLES = 10;

const DIVERSION_THRESHOLD_S = 600;
const CHECK_EVERY_SIM_S = 180;

function roadOf(arcId: string): string {
  return arcId.split(':')[0] ?? arcId;
}

interface VMutable {
  arcIdx: number; frac: number; simTimeS: number;
  durations: number[]; distances: number[];
  legs: Record<string, { from: string; to: string }>;
  checking: boolean; lastCheckSim: number; lastVersion: number;
  policy: Record<string, unknown>;
  banner: {
    decision: string; reason: string; savingS: number | null;
    currentEtaS: number; candidateEtaS: number | null; candidateArcs: string[];
    frozenArcIdx: number; frozenArc: string; frozenFrac: number; frozenSim: number;
    overlayVersion: number;
  } | null;
  durCache: Map<string, number>; distCache: Map<string, number>;
  x: number; y: number;
}

function freshVMutable(): VMutable {
  return {
    arcIdx: 0, frac: 0, simTimeS: 0, durations: [], distances: [], legs: {},
    checking: false, lastCheckSim: -100000, lastVersion: 1, policy: {}, banner: null,
    durCache: new Map(), distCache: new Map(), x: -100, y: -100,
  };
}

export default function Fleet() {
  const engineStatus = useEngineStatus();
  const fleet = useFleet();
  const trafficVersion = useTraffic((s) => s.version);
  const overlayOf = useTraffic((s) => s.overlay);
  const pushToast = useToasts((s) => s.push);
  const cyOut = useRef<Core | null>(null);
  const mut = useRef(new Map<string, VMutable>());
  const fleetSim = useRef(0);
  const lastWall = useRef(0);
  const lastMirror = useRef(0);
  const lastSeenVersion = useRef(1);
  const markerRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [confirmStart, setConfirmStart] = useState(false);
  const [panelHidden, setPanelHidden] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  // Traffic the fleet injected (cleaned on reset; never touches user entries).
  const injected = useRef<{ incidents: string[]; closures: { road: string; weClosed: boolean }[]; factors: string[] }>({
    incidents: [], closures: [], factors: [],
  });

  function otherSimActive(): boolean {
    const js = useSim.getState().status;
    const ds = useDemo.getState().status;
    return js === 'running' || js === 'paused' || js === 'starting'
      || (ds !== 'idle' && ds !== 'completed' && ds !== 'error');
  }

  async function evalArc(id: string, arcId: string, from: string): Promise<{ timeS: number; distanceM: number }> {
    const m = mut.current.get(id);
    if (!m) throw new Error(`unknown vehicle ${id}`);
    const t = m.durCache.get(arcId);
    const d = m.distCache.get(arcId);
    if (t !== undefined && d !== undefined) return { timeS: t, distanceM: d };
    const o = await engineClient.call('route.evaluate', {
      network: networkPayload(), overlay: overlayOf(), objective: 'FASTEST',
      plan: { arcs: [arcId], source: from },
    }, { channel: `fleet-plan-${id}` });
    if (o.stale) throw new Error('stale evaluate');
    const ev = DemoEvalSchema.parse(o.result);
    if (!ev.valid || ev.blocked) throw new Error(`arc ${arcId} not traversable`);
    m.durCache.set(arcId, ev.timeS);
    m.distCache.set(arcId, ev.distanceM);
    return { timeS: ev.timeS, distanceM: ev.distanceM };
  }

  async function start() {
    const st = useFleet.getState().status;
    if (st === 'starting' || st === 'running' || st === 'paused') return;
    if (otherSimActive()) {
      setConfirmStart(true);
      return;
    }
    await runStart();
  }

  async function planVehicle(id: string): Promise<boolean> {
    const v = useFleet.getState().vehicles[id];
    const m = mut.current.get(id);
    if (!v || !m) return false;
    const o = await engineClient.call('route.find', {
      network: networkPayload(), overlay: overlayOf(),
      source: v.origin, target: v.destination,
      objective: v.objective, algorithm: 'DIJKSTRA',
    }, { channel: `fleet-plan-${id}` });
    if (o.stale) throw new Error('stale route.find');
    const route = DemoRouteSchema.parse(o.result);
    if (!route.found) {
      useFleet.getState().patchVehicle(id, {
        status: 'error', error: route.reason || 'unreachable',
        history: [...v.history, { t: Math.floor(m.simTimeS), kind: 'error', text: `no route: ${route.reason || 'unreachable'}` }],
      });
      useFleet.getState().pushEvent(fleetSim.current, id, `${id} has no route (${route.reason || 'unreachable'})`);
      return false;
    }
    const durations: number[] = [];
    const distances: number[] = [];
    for (const a of route.arcs) {
      const e = await evalArc(id, a.arcId, a.from);
      durations.push(e.timeS);
      distances.push(e.distanceM);
      m.legs[a.arcId] = { from: a.from, to: a.to };
    }
    m.durations = durations;
    m.distances = distances;
    useFleet.getState().patchVehicle(id, {
      status: 'enroute', planArcs: route.arcs.map((a) => a.arcId),
      planVertices: route.vertices, durations, distances,
      remainingS: durations.reduce((x, y) => x + y, 0),
      remainingM: distances.reduce((x, y) => x + y, 0),
      history: [...v.history, { t: Math.floor(m.simTimeS), kind: 'plan', text: `planned ${route.arcs.length} segments, ${formatSeconds(route.timeS)}` }],
    });
    useFleet.getState().pushEvent(fleetSim.current, id, `${id} ${v.label} planned ${route.arcs.length} segments`);
    return true;
  }

  function nextFreeId(): string | null {
    const used = new Set(useFleet.getState().order);
    for (let i = 1; i <= MAX_VEHICLES; i++) {
      if (!used.has(`V${i}`)) return `V${i}`;
    }
    return null;
  }

  function nextPair(): FleetPair | null {
    const used = new Set(
      useFleet.getState().order.map((id) => {
        const v = useFleet.getState().vehicles[id];
        return v ? `${v.origin}|${v.destination}` : '';
      }),
    );
    return [...DEFAULTS, ...ADDABLES].find((p) => !used.has(`${p.origin}|${p.destination}`)) ?? null;
  }

  async function addVehicle() {
    const s = useFleet.getState();
    if (s.status === 'starting') return;
    const id = nextFreeId();
    const pair = nextPair();
    if (!id || !pair) {
      pushToast(`Fleet is full (${MAX_VEHICLES} vehicles)`, 'error');
      return;
    }
    const n = Number(id.slice(1));
    const v = blankVehicle(id, LABELS[n - 1] ?? id, VEHICLE_COLORS[n - 1] ?? '#44403c', pair);
    useFleet.getState().upsertVehicle(v);
    mut.current.set(id, { ...freshVMutable(), lastVersion: useTraffic.getState().version });
    if (s.status === 'running' || s.status === 'paused') {
      try {
        await planVehicle(id);
      } catch (e) {
        useFleet.getState().patchVehicle(id, {
          status: 'error', error: e instanceof EngineError ? `${e.code}: ${e.message}` : String(e),
        });
      }
    } else {
      pushToast(`${id} queued for next start`);
    }
  }

  function removeVehicle(id: string) {
    const s = useFleet.getState();
    if (s.status === 'starting') return;
    mut.current.delete(id);
    delete markerRefs.current[id];
    useFleet.getState().removeVehicle(id);
    useFleet.getState().pushEvent(fleetSim.current, null, `${id} removed from fleet`);
  }

  async function runStart() {
    setConfirmStart(false);
    clearFleetTraffic();
    // Preserve pre-start queued vehicles alongside the defaults.
    const queued: FleetPair[] = useFleet.getState().order
      .map((id) => useFleet.getState().vehicles[id])
      .filter((v) => v && v.status === 'planned' && !DEFAULTS.some((d) => d.origin === v.origin && d.destination === v.destination))
      .map((v) => ({ origin: v!.origin, destination: v!.destination, objective: v!.objective }));
    const roster = [...DEFAULTS, ...queued].slice(0, MAX_VEHICLES);
    useFleet.getState().reset();
    mut.current = new Map();
    fleetSim.current = 0;
    lastSeenVersion.current = useTraffic.getState().version;
    useFleet.getState().set({ status: 'starting', error: '' });
    try {
      for (let i = 0; i < roster.length; i++) {
        const pair = roster[i]!;
        const id = `V${i + 1}`;
        const v = blankVehicle(id, LABELS[i] ?? id, VEHICLE_COLORS[i] ?? '#44403c', pair);
        useFleet.getState().upsertVehicle(v);
        mut.current.set(id, { ...freshVMutable(), lastVersion: lastSeenVersion.current });
        await planVehicle(id);
      }
      useFleet.getState().set({ status: 'running' });
      lastWall.current = performance.now();
      pushToast(`Fleet started: ${roster.length} vehicles en route`);
    } catch (e) {
      useFleet.getState().set({
        status: 'error',
        error: e instanceof EngineError ? `${e.code}: ${e.message}` : String(e),
      });
    }
  }

  async function checkVehicle(id: string) {
    const v = useFleet.getState().vehicles[id];
    const m = mut.current.get(id);
    if (!v || !m || v.status !== 'enroute' || m.checking) return;
    const tv = useTraffic.getState().version;
    if (m.simTimeS - m.lastCheckSim < CHECK_EVERY_SIM_S && m.lastVersion === tv) return;
    m.checking = true;
    try {
      const remaining = v.planArcs.slice(m.arcIdx);
      if (remaining.length === 0) return;
      const arc = remaining[0] as string;
      const frac = Math.max(0, Math.min(1000, Math.floor(m.frac)));
      const o = await engineClient.call('diversion.evaluate', {
        network: networkPayload(), overlay: overlayOf(),
        plan: { arcs: remaining },
        position: { arc, fractionPermille: frac },
        simTimeS: Math.floor(m.simTimeS),
        config: { thresholdS: DIVERSION_THRESHOLD_S }, policy: m.policy,
      }, { channel: `fleet-div-${id}` });
      if (o.stale) return;
      const d = DemoDivSchema.parse(o.result);
      m.lastCheckSim = m.simTimeS;
      m.lastVersion = tv;
      m.policy = d.policy as Record<string, unknown>;
      if (d.decision === 'NO_ROUTE_AVAILABLE') {
        useFleet.getState().patchVehicle(id, {
          status: 'blocked',
          history: [...v.history, { t: Math.floor(m.simTimeS), kind: 'blocked', text: `blocked: ${d.reason}` }],
        });
        useFleet.getState().pushEvent(fleetSim.current, id, `${id} BLOCKED (${d.reason})`);
        return;
      }
      if (d.notify) {
        m.banner = {
          decision: d.decision, reason: d.reason, savingS: d.savingS,
          currentEtaS: d.currentEtaS, candidateEtaS: d.candidateEtaS,
          candidateArcs: (d.candidate?.arcs ?? []).map((a) => a.arcId),
          frozenArcIdx: m.arcIdx, frozenArc: arc, frozenFrac: frac,
          frozenSim: Math.floor(m.simTimeS), overlayVersion: tv,
        };
        const decision: VehicleDecision = {
          decision: d.decision, reason: d.reason, savingS: d.savingS,
          currentEtaS: d.currentEtaS, candidateEtaS: d.candidateEtaS,
          candidateArcs: (d.candidate?.arcs ?? []).map((a) => a.arcId),
        };
        useFleet.getState().patchVehicle(id, {
          status: 'awaiting', decision,
          history: [...v.history, { t: Math.floor(m.simTimeS), kind: 'incident', text: `${d.decision} — ${d.reason}` }],
        });
        useFleet.getState().pushEvent(fleetSim.current, id, `${id} decision: ${d.decision} (${d.reason})`);
      }
    } catch (e) {
      useFleet.getState().pushEvent(
        fleetSim.current, id,
        `${id} check failed: ${e instanceof EngineError ? e.code : String(e)}`,
      );
    } finally {
      m.checking = false;
    }
  }
  const checkRef = useRef(checkVehicle);
  checkRef.current = checkVehicle;

  async function acceptVehicle(id: string) {
    const v = useFleet.getState().vehicles[id];
    const m = mut.current.get(id);
    if (!v || !m || !m.banner) return;
    const b = m.banner;
    try {
      const o = await engineClient.call('diversion.evaluate', {
        network: networkPayload(), overlay: overlayOf(),
        plan: { arcs: v.planArcs.slice(b.frozenArcIdx) },
        position: { arc: b.frozenArc, fractionPermille: b.frozenFrac },
        simTimeS: b.frozenSim, config: { thresholdS: DIVERSION_THRESHOLD_S },
        action: 'accept', expectedVersion: b.overlayVersion,
        expectedPosition: { arc: b.frozenArc, fractionPermille: b.frozenFrac },
        candidate: { arcs: b.candidateArcs }, policy: m.policy,
      }, { channel: `fleet-div-${id}` });
      if (o.stale) return;
      const a = AcceptSchema.parse(o.result);
      if (!a.accepted) {
        m.banner = null;
        useFleet.getState().patchVehicle(id, { status: 'enroute', decision: null });
        return;
      }
      m.durCache.clear();
      m.distCache.clear();
      const durations: number[] = [];
      const distances: number[] = [];
      for (const arc of a.plan.arcs) {
        const e = await evalArc(id, arc.arcId, arc.from);
        durations.push(e.timeS);
        distances.push(e.distanceM);
        m.legs[arc.arcId] = { from: arc.from, to: arc.to };
      }
      m.arcIdx = 0;
      m.frac = b.frozenFrac;
      m.simTimeS = b.frozenSim;
      m.durations = durations;
      m.distances = distances;
      m.banner = null;
      const saved = b.savingS ?? 0;
      const affectedRoads = [...new Set(v.planArcs.slice(b.frozenArcIdx).map(roadOf)
        .filter((r) => {
          const ov = overlayOf();
          return ov.closures.includes(r) || ov.incidents.some((i) => i.road === r);
        }))];
      useFleet.getState().patchVehicle(id, {
        status: 'enroute', decision: null,
        planArcs: a.plan.arcs.map((x) => x.arcId), planVertices: a.plan.vertices,
        durations, distances, arcIdx: 0, fracPermille: b.frozenFrac, simTimeS: b.frozenSim,
        reroutes: v.reroutes + 1, savedEstimateS: v.savedEstimateS + saved,
        lastReceipt: {
          overlayVersion: b.overlayVersion, affectedRoads,
          originalRemainingEtaS: b.currentEtaS, candidateRemainingEtaS: b.candidateEtaS,
          policyDecision: b.decision, policyReason: b.reason,
          savingEstimateS: b.savingS, userAction: 'accept',
          simTimeS: b.frozenSim, atArc: b.frozenArc,
        },
        history: [...v.history, {
          t: b.frozenSim, kind: 'accept',
          text: `accepted ${b.decision}, est. save ${b.savingS === null ? 'n/a' : formatSeconds(b.savingS)}`,
        }],
      });
      useFleet.getState().pushEvent(fleetSim.current, id, `${id} accepted diversion (${a.plan.arcs.length} segments)`);
      pushToast(`${id} rerouted on ${a.plan.arcs.length} segments`);
    } catch (e) {
      useFleet.getState().patchVehicle(id, {
        error: e instanceof EngineError ? `${e.code}: ${e.message}` : String(e),
      });
    }
  }

  async function stayVehicle(id: string) {
    const v = useFleet.getState().vehicles[id];
    const m = mut.current.get(id);
    if (!v || !m || !m.banner) return;
    const b = m.banner;
    try {
      const o = await engineClient.call('diversion.evaluate', {
        network: networkPayload(), overlay: overlayOf(),
        plan: { arcs: v.planArcs.slice(b.frozenArcIdx) },
        position: { arc: b.frozenArc, fractionPermille: b.frozenFrac },
        simTimeS: b.frozenSim, config: { thresholdS: DIVERSION_THRESHOLD_S },
        action: 'reject', policy: m.policy,
      }, { channel: `fleet-div-${id}` });
      if (!o.stale) {
        const d = DemoDivSchema.parse(o.result);
        m.policy = d.policy as Record<string, unknown>;
      }
    } catch {
      /* failed reject still dismisses locally */
    }
    m.banner = null;
    const affectedRoads = [...new Set(v.planArcs.slice(b.frozenArcIdx).map(roadOf)
      .filter((r) => {
        const ov = overlayOf();
        return ov.closures.includes(r) || ov.incidents.some((i) => i.road === r);
      }))];
    useFleet.getState().patchVehicle(id, {
      status: 'enroute', decision: null,
      history: [...v.history, { t: b.frozenSim, kind: 'stay', text: `stayed despite ${b.decision}` }],
      lastReceipt: {
        overlayVersion: b.overlayVersion, affectedRoads,
        originalRemainingEtaS: b.currentEtaS, candidateRemainingEtaS: b.candidateEtaS,
        policyDecision: b.decision, policyReason: b.reason,
        savingEstimateS: b.savingS, userAction: 'stay',
        simTimeS: b.frozenSim, atArc: b.frozenArc,
      },
    });
    useFleet.getState().pushEvent(fleetSim.current, id, `${id} stayed on route`);
  }

  function closeRoad(road: string, kind: 'accident' | 'construction' | 'jam' = 'accident'): string | null {
    const t = useTraffic.getState();
    if (!road || t.closures.includes(road)) return null;
    const incidentId = t.addIncident(road, 'both', kind);
    useTraffic.getState().toggleClosure(road);
    injected.current.incidents.push(incidentId);
    injected.current.closures.push({ road, weClosed: true });
    return incidentId;
  }

  function clearFleetTraffic() {
    const t = useTraffic.getState();
    for (const id of injected.current.incidents) t.removeIncident(id);
    for (const c of injected.current.closures) {
      if (c.weClosed && useTraffic.getState().closures.includes(c.road)) {
        useTraffic.getState().toggleClosure(c.road);
      }
    }
    for (const road of injected.current.factors) t.clearFactor(road);
    injected.current = { incidents: [], closures: [], factors: [] };
  }

  function simulateIncident() {
    const s = useFleet.getState();
    if (s.status !== 'running' && s.status !== 'paused') return;
    const target = (s.selectedId && s.vehicles[s.selectedId]?.status === 'enroute'
      ? s.vehicles[s.selectedId]! : undefined)
      ?? s.order.map((id) => s.vehicles[id]!).find((v) => v && v.status === 'enroute');
    const m = target ? mut.current.get(target.id) : undefined;
    if (!target || !m) {
      pushToast('No en-route vehicle to disrupt', 'error');
      return;
    }
    const future = target.planArcs.slice(m.arcIdx + 1);
    const t = useTraffic.getState();
    const road = future.map(roadOf).find((r) => !t.closures.includes(r))
      ?? roadOf(target.planArcs[m.arcIdx] ?? '');
    if (!road) {
      pushToast('No eligible road ahead', 'error');
      return;
    }
    const incidentId = closeRoad(road);
    if (!incidentId) {
      pushToast('No eligible road ahead', 'error');
      return;
    }
    useFleet.getState().pushEvent(
      fleetSim.current, target.id,
      `SIMULATED incident ${incidentId}: ${road} closed (affects ${target.id} route)`,
    );
    pushToast(`SIMULATED incident: ${road} closed`, 'error');
  }

  // Deterministic disruption presets over fixed road sets. Effects are
  // computed by the engine per vehicle; the preset only edits the overlay.
  function presetMajorClosure() {
    const s = useFleet.getState();
    if (s.status !== 'running' && s.status !== 'paused') return;
    const id = closeRoad('ex04', 'construction');
    useFleet.getState().pushEvent(
      fleetSim.current, null,
      id ? `SIMULATED preset: major closure ex04 (${id})` : 'Preset: ex04 already closed',
    );
    pushToast(id ? 'SIMULATED preset: ex04 closed' : 'ex04 already closed', 'error');
  }

  function presetCongestion() {
    const s = useFleet.getState();
    if (s.status !== 'running' && s.status !== 'paused') return;
    const t = useTraffic.getState();
    for (const road of ['ex04', 'ex05', 'ex06', 'ex07']) {
      if (!injected.current.factors.includes(road)) {
        t.setFactor(road, 300);
        injected.current.factors.push(road);
      }
    }
    useFleet.getState().pushEvent(fleetSim.current, null, 'SIMULATED preset: corridor congestion 30% speed');
    pushToast('SIMULATED preset: corridor congestion', 'error');
  }

  // Single loop for the whole fleet; per-vehicle clocks advance together.
  useEffect(() => {
    if (fleet.status !== 'running') return;
    let raf = 0;
    const tick = (now: number) => {
      const s = useFleet.getState();
      const dt = Math.max(0, (now - lastWall.current) / 1000);
      lastWall.current = now;
      fleetSim.current += dt * s.speed;
      const tv = useTraffic.getState().version;
      const versionChanged = tv !== lastSeenVersion.current;
      if (versionChanged) lastSeenVersion.current = tv;
      let allTerminal = s.order.length > 0;
      for (const id of s.order) {
        const v = s.vehicles[id];
        const m = mut.current.get(id);
        if (!v || !m) continue;
        if (v.status === 'enroute') {
          allTerminal = false;
          m.simTimeS += dt * s.speed;
          const dur = m.durations[m.arcIdx];
          if (dur !== undefined && dur > 0) {
            m.frac += ((dt * s.speed) / dur) * 1000;
            if (m.frac >= 1000) {
              m.arcIdx += 1;
              m.frac = 0;
              if (m.arcIdx >= v.planArcs.length) {
                m.simTimeS = Math.round(m.simTimeS);
                useFleet.getState().patchVehicle(id, {
                  status: 'completed', progress: 1,
                  arcIdx: m.arcIdx, fracPermille: 1000, simTimeS: Math.floor(m.simTimeS),
                  remainingS: 0, remainingM: 0, currentRoad: null,
                  history: [...useFleet.getState().vehicles[id]!.history,
                    { t: Math.floor(m.simTimeS), kind: 'done', text: `completed in ${formatSeconds(m.simTimeS)}` }],
                });
                useFleet.getState().pushEvent(fleetSim.current, id, `${id} completed delivery`);
                continue;
              }
            }
          }
          if (versionChanged || m.simTimeS - m.lastCheckSim >= CHECK_EVERY_SIM_S) {
            void checkRef.current(id);
          }
        } else if (v.status === 'awaiting') {
          allTerminal = false;
        }
        // Imperative marker positioning (no react re-render per frame).
        const cy = cyOut.current;
        const el = markerRefs.current[id];
        if (cy && el) {
          let vx = -100;
          let vy = -100;
          if (v.status === 'planned') {
            const n = cy.getElementById(v.origin);
            if (n.length > 0) {
              const p = n.renderedPosition();
              vx = p.x; vy = p.y;
            }
          } else if (v.status === 'completed') {
            const n = cy.getElementById(v.destination);
            if (n.length > 0) {
              const p = n.renderedPosition();
              vx = p.x; vy = p.y;
            }
          } else {
            const arcId = v.planArcs[m.arcIdx];
            const leg = arcId ? m.legs[arcId] : undefined;
            if (leg) {
              const a = cy.getElementById(leg.from).renderedPosition();
              const b = cy.getElementById(leg.to).renderedPosition();
              const f = Math.min(1, Math.max(0, m.frac / 1000));
              vx = a.x + (b.x - a.x) * f;
              vy = a.y + (b.y - a.y) * f;
            }
          }
          m.x = vx; m.y = vy;
          el.style.transform = `translate(${vx}px, ${vy}px) translate(-50%,-50%)`;
        }
      }
      if (allTerminal) {
        useFleet.getState().set({ status: 'completed' });
        useFleet.getState().pushEvent(fleetSim.current, null, 'Fleet run completed');
        return;
      }
      if (now - lastMirror.current >= 200) {
        lastMirror.current = now;
        const ts = useTraffic.getState();
        const bad = new Set<string>([...ts.closures, ...ts.incidents.map((i) => i.road)]);
        for (const [k, permille] of Object.entries(ts.factors)) {
          if (permille < 1000) bad.add(k);
        }
        for (const id of s.order) {
          const v = s.vehicles[id];
          const m = mut.current.get(id);
          if (!v || !m || (v.status !== 'enroute' && v.status !== 'awaiting')) continue;
          const future = v.planArcs.slice(m.arcIdx);
          const affected = [...new Set(future.map(roadOf).filter((r) => bad.has(r)))];
          const remS = m.durations.slice(m.arcIdx).reduce((x, y) => x + y, 0)
            - (m.durations[m.arcIdx] ?? 0) * (m.frac / 1000);
          const remM = m.distances.slice(m.arcIdx).reduce((x, y) => x + y, 0)
            - (m.distances[m.arcIdx] ?? 0) * (m.frac / 1000);
          useFleet.getState().patchVehicle(id, {
            arcIdx: m.arcIdx, fracPermille: Math.floor(m.frac), simTimeS: Math.floor(m.simTimeS),
            currentRoad: v.planArcs[m.arcIdx] ? roadOf(v.planArcs[m.arcIdx] as string) : null,
            remainingS: Math.max(0, Math.round(remS)), remainingM: Math.max(0, Math.round(remM)),
            progress: v.planArcs.length === 0 ? 0 : Math.min(1, (m.arcIdx + m.frac / 1000) / v.planArcs.length),
            affected,
          });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    lastWall.current = performance.now();
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleet.status, fleet.speed]);

  // NOTE: no effect syncs lastSeenVersion — the loop owns version-change
  // detection (an effect here would swallow the bump before the loop sees it).

  function reset() {
    clearFleetTraffic();
    mut.current = new Map();
    fleetSim.current = 0;
    useFleet.getState().reset();
  }

  const selected = fleet.selectedId ? fleet.vehicles[fleet.selectedId] : undefined;
  const routeArcs = fleet.showMode === 'all'
    ? [...new Set(fleet.order.flatMap((id) => fleet.vehicles[id]?.planArcs ?? []))]
    : (selected?.planArcs ?? []);
  const awaitingAlts = fleet.order.flatMap((id) => fleet.vehicles[id]?.decision?.candidateArcs ?? []);
  const counts = {
    active: 0, completed: 0, awaiting: 0, blocked: 0,
  };
  let totalRemaining = 0;
  let reroutes = 0;
  let saved = 0;
  for (const id of fleet.order) {
    const v = fleet.vehicles[id];
    if (!v) continue;
    if (v.status === 'enroute') counts.active += 1;
    if (v.status === 'completed') counts.completed += 1;
    if (v.status === 'awaiting') counts.awaiting += 1;
    if (v.status === 'blocked' || v.status === 'error') counts.blocked += 1;
    if (v.status === 'enroute' || v.status === 'awaiting') totalRemaining += v.remainingS;
    reroutes += v.reroutes;
    saved += v.savedEstimateS;
  }
  const affectedCount = fleet.order.filter((id) => (fleet.vehicles[id]?.affected.length ?? 0) > 0).length;

  return (
    <div>
      <button className="pf-btn small pf-panel-toggle" data-testid="panel-toggle"
        aria-expanded={!panelHidden} onClick={() => setPanelHidden(!panelHidden)}>
        {panelHidden ? 'Show panel' : 'Hide panel'}
      </button>
      <div className={`pf-workspace${panelHidden ? ' panel-hidden' : ''}`}>
        <div className="pf-map-wrap" style={{ position: 'relative' }}>
          <MapView routeArcIds={routeArcs} altArcIds={awaitingAlts} cyOut={cyOut}
            statsExtra={`${fleet.order.length} vehicles`} />
          <div data-testid="fleet-markers" aria-hidden="true"
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {fleet.order.map((id) => {
              const v = fleet.vehicles[id];
              if (!v) return null;
              return (
                <div key={id}
                  ref={(el) => {
                    markerRefs.current[id] = el;
                  }}
                  data-testid={`fleet-marker-${id}`}
                  title={`${id} ${v.label}`}
                  style={{
                    position: 'absolute', top: 0, left: 0, minWidth: 30, height: 30,
                    borderRadius: 15, background: v.color, color: '#fff',
                    fontSize: 13, fontWeight: 700, textAlign: 'center', lineHeight: '30px',
                    padding: '0 8px', border: '3px solid var(--pf-paper)',
                    boxShadow: 'var(--pf-shadow)',
                    outline: fleet.selectedId === id ? '3px solid var(--pf-focus)' : 'none',
                    transform: 'translate(-100px,-100px)',
                  }}>
                  {id}
                </div>
              );
            })}
          </div>
        </div>
        <div className="pf-panel">
          <section className="pf-card" aria-label="Fleet controls">
            <h2>Fleet Command Center</h2>
            <p className="pf-meta" data-testid="engine-status">Engine: {engineStatus}</p>
            <p className="pf-meta" role="status" data-testid="fleet-status">Status: {fleet.status}</p>
            <p className="pf-meta" data-testid="fleet-overlay">Shared overlay v{trafficVersion}</p>
            <p className="pf-meta" data-testid="fleet-traffic">
              Fleet traffic: {injected.current.incidents.length} incident(s),{' '}
              {injected.current.closures.length} closure(s), {injected.current.factors.length} factor(s){' '}
              <button className="pf-btn small" onClick={() => { clearFleetTraffic(); pushToast('Fleet traffic cleared'); }}
                data-testid="fleet-clear-traffic">
                Clear fleet traffic
              </button>
            </p>
            <p className="pf-meta" data-testid="fleet-counts">
              Active {counts.active} · Completed {counts.completed} · Awaiting {counts.awaiting} · Blocked {counts.blocked}
            </p>
            <div className="pf-row">
              {(fleet.status === 'idle' || fleet.status === 'completed' || fleet.status === 'error') && (
                <button className="pf-btn primary" onClick={() => void start()} data-testid="fleet-start">
                  Start Fleet
                </button>
              )}
              {fleet.status === 'running' && (
                <button className="pf-btn" onClick={() => fleet.set({ status: 'paused' })} data-testid="fleet-pause">
                  Pause
                </button>
              )}
              {fleet.status === 'paused' && (
                <button className="pf-btn" onClick={() => { lastWall.current = performance.now(); fleet.set({ status: 'running' }); }} data-testid="fleet-resume">
                  Resume
                </button>
              )}
              {(fleet.status === 'running' || fleet.status === 'paused') && (
                <button className="pf-btn" onClick={simulateIncident} data-testid="fleet-incident">
                  Simulate Incident
                </button>
              )}
              {(fleet.status === 'running' || fleet.status === 'paused') && (
                <button className="pf-btn" onClick={presetMajorClosure} data-testid="fleet-preset-closure">
                  Major Closure
                </button>
              )}
              {(fleet.status === 'running' || fleet.status === 'paused') && (
                <button className="pf-btn" onClick={presetCongestion} data-testid="fleet-preset-congestion">
                  Congestion
                </button>
              )}
              {fleet.status !== 'starting' && (
                <button className="pf-btn" onClick={() => void addVehicle()} data-testid="fleet-add"
                  disabled={fleet.order.length >= MAX_VEHICLES}>
                  Add Vehicle ({fleet.order.length}/{MAX_VEHICLES})
                </button>
              )}
              {fleet.status !== 'idle' && fleet.status !== 'starting' && (
                <button className="pf-btn" onClick={reset} data-testid="fleet-reset">Reset</button>
              )}
            </div>
            <div className="pf-row">
              <div className="pf-field">
                <label htmlFor="fleet-speed">Speed</label>
                <select id="fleet-speed" value={fleet.speed}
                  onChange={(e) => fleet.set({ speed: Number(e.target.value) })} data-testid="fleet-speed">
                  {FLEET_SPEEDS.map((v) => <option key={v} value={v}>{v}×</option>)}
                </select>
              </div>
              <div className="pf-field">
                <label htmlFor="fleet-show">Routes on map</label>
                <select id="fleet-show" value={fleet.showMode}
                  onChange={(e) => fleet.set({ showMode: e.target.value as 'selected' | 'all' })}
                  data-testid="fleet-show">
                  <option value="selected">Selected vehicle</option>
                  <option value="all">All vehicles</option>
                </select>
              </div>
            </div>
            {fleet.error && <div className="pf-alert error" role="alert" data-testid="fleet-error">{fleet.error}</div>}
          </section>
          <section className="pf-card" aria-label="Fleet KPIs" data-testid="fleet-kpis">
            <h2>Operations KPIs</h2>
            <dl className="pf-facts">
              <dt>Remaining (est.)</dt><dd data-testid="fleet-kpi-remaining">{formatSeconds(totalRemaining)}</dd>
              <dt>Completed</dt><dd data-testid="fleet-kpi-completed">{counts.completed}</dd>
              <dt>Affected</dt><dd data-testid="fleet-kpi-affected">{affectedCount}</dd>
              <dt>Reroutes</dt><dd data-testid="fleet-kpi-reroutes">{reroutes}</dd>
              <dt>Saved (est.)</dt><dd data-testid="fleet-kpi-saved">{formatSeconds(saved)}</dd>
            </dl>
            <p className="pf-meta">Remaining = engine-evaluated arc time ahead per vehicle. Saved = sum of
              accepted diversion estimates, never realized time.</p>
          </section>
          <section className="pf-card" aria-label="Vehicles" data-testid="fleet-vehicles">
            <h2>Vehicles</h2>
            {fleet.order.length === 0 && <p className="pf-meta">Start the fleet to dispatch vehicles.</p>}
            <ul>
              {fleet.order.map((id) => {
                const v = fleet.vehicles[id];
                if (!v) return null;
                return (
                  <li key={id} data-testid={`fleet-vehicle-${id}`}>
                    <button className="pf-btn small" data-testid={`fleet-select-${id}`}
                      aria-pressed={fleet.selectedId === id}
                      onClick={() => fleet.set({ selectedId: id })}>
                      {id} {v.label}
                    </button>{' '}
                    <span data-testid={`fleet-vstatus-${id}`}>{v.status}</span>{' '}
                    {vertexName(v.origin)} → {vertexName(v.destination)} ·{' '}
                    <span data-testid={`fleet-vprogress-${id}`}>{Math.round(v.progress * 100)}%</span> ·{' '}
                    ETA {formatSeconds(v.remainingS)}
                    {v.currentRoad && <> · <span data-testid={`fleet-vroad-${id}`}>on {v.currentRoad}</span></>}{' '}
                    <button className="pf-btn small" data-testid={`fleet-remove-${id}`}
                      onClick={() => removeVehicle(id)} aria-label={`Remove ${id}`}>
                      Remove
                    </button>
                    <div data-testid={`fleet-vbar-${id}`} role="progressbar"
                      aria-valuenow={Math.round(v.progress * 100)} aria-valuemin={0} aria-valuemax={100}
                      aria-label={`${id} progress`}
                      style={{ height: 8, borderRadius: 4, background: 'var(--pf-paper-sink)', overflow: 'hidden' }}>
                      <div style={{ width: `${(v.progress * 100).toFixed(1)}%`, height: '100%', background: v.color }} />
                    </div>
                    {v.affected.length > 0 && <> · <span data-testid={`fleet-vaffected-${id}`}>affected: {v.affected.join(', ')}</span></>}
                    {v.status === 'awaiting' && v.decision && (
                      <span data-testid={`fleet-vdecision-${id}`}>
                        {' '}· {v.decision.decision} ({v.decision.reason})
                        <span className="pf-row">
                          <button className="pf-btn small" data-testid={`fleet-accept-${id}`}
                            onClick={() => void acceptVehicle(id)}>Accept</button>
                          <button className="pf-btn small" data-testid={`fleet-stay-${id}`}
                            onClick={() => void stayVehicle(id)}>Stay</button>
                        </span>
                      </span>
                    )}
                    {v.error && <> · <span role="alert">{v.error}</span></>}
                  </li>
                );
              })}
            </ul>
            {selected && selected.history.length > 0 && (
              <div data-testid="fleet-history">
                <h3>{selected.id} history</h3>
                <ul>
                  {selected.history.map((h, i) => (
                    <li key={i}>[{formatSeconds(h.t)}] {h.text}</li>
                  ))}
                </ul>
              </div>
            )}
            {selected && selected.planArcs.length > 0 && (
              <button className="pf-btn" onClick={() => setExplainOpen(true)} data-testid="fleet-why">
                Why This Route? ({selected.id})
              </button>
            )}
            {selected?.lastReceipt && (
              <div data-testid="fleet-receipt">
                <h3>{selected.id} decision receipt</h3>
                <dl className="pf-facts">
                  <dt>Overlay</dt><dd data-testid="fleet-receipt-overlay">v{selected.lastReceipt.overlayVersion}</dd>
                  <dt>Roads</dt><dd>{selected.lastReceipt.affectedRoads.join(', ') || '—'}</dd>
                  <dt>Original ETA</dt>
                  <dd>{selected.lastReceipt.originalRemainingEtaS <= 0 ? 'blocked' : formatSeconds(selected.lastReceipt.originalRemainingEtaS)}</dd>
                  <dt>Recommended ETA</dt>
                  <dd>{selected.lastReceipt.candidateRemainingEtaS === null ? 'n/a' : formatSeconds(selected.lastReceipt.candidateRemainingEtaS)}</dd>
                  <dt>Policy</dt><dd data-testid="fleet-receipt-policy">{selected.lastReceipt.policyDecision} — {selected.lastReceipt.policyReason}</dd>
                  <dt>Saved (est.)</dt>
                  <dd>{selected.lastReceipt.savingEstimateS === null ? 'n/a' : formatSeconds(selected.lastReceipt.savingEstimateS)}</dd>
                  <dt>Action</dt><dd data-testid="fleet-receipt-action">{selected.lastReceipt.userAction}</dd>
                </dl>
              </div>
            )}
            {selected && selected.planArcs.length > 0 && (
              <ExplainDrawer open={explainOpen} onClose={() => setExplainOpen(false)} testid="fleet-why"
                source={selected.origin} target={selected.destination}
                objective={selected.objective} algorithm="DIJKSTRA"
                arcs={selected.planArcs.map((arcId) => {
                  const leg = mut.current.get(selected.id)?.legs[arcId];
                  return { arcId, from: leg?.from ?? '', to: leg?.to ?? '' };
                })}
                vertices={selected.planVertices}
                totals={{
                  timeS: selected.durations.reduce((x, y) => x + y, 0),
                  distanceM: selected.distances.reduce((x, y) => x + y, 0),
                  tollInr: selected.planArcs.reduce((x, arcId) => {
                    const road = ROADS.find((r) => r.id === (arcId.split(':')[0] ?? ''));
                    return x + (road?.tollInr ?? 0);
                  }, 0),
                }}
                alternatives={[]} />
            )}
          </section>
          <section className="pf-card" aria-label="Event feed" data-testid="fleet-events">
            <h2>Event feed</h2>
            {fleet.events.length === 0 && <p className="pf-meta">No simulated events yet.</p>}
            <ol>
              {[...fleet.events].reverse().slice(0, 30).map((e) => (
                <li key={e.seq} data-testid={`fleet-event-${e.seq}`}>
                  [{formatSeconds(e.fleetSimS)}] {e.text}
                </li>
              ))}
            </ol>
          </section>
          <VivaCard page="fleet" />
          <Confirm open={confirmStart} title="Start fleet?"
            body="This starts a new simulated fleet run. A journey or demo may be in progress on the shared overlay."
            confirmLabel="Start anyway" testid="fleet-overwrite"
            onCancel={() => setConfirmStart(false)}
            onConfirm={() => void runStart()} />
        </div>
      </div>
    </div>
  );
}
