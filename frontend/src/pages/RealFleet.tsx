// Real Fleet Command Center (R5): 5 verified vehicles on genuine OSM
// streets. Independent clocks/routes/policies, shared real overlay,
// per-vehicle diversion decisions, priority (check cadence), in-simulation
// SLA, traffic sandbox (click-a-road closures/factors), emergency drill,
// and an honest replay timeline from recorded positions.
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
import { useDemo } from '../demo/store';
import { useFleet } from '../fleet/store';
import { useRealDemo } from '../realmap/realDemoStore';
import { DemoDivSchema, DemoEvalSchema, DemoRouteSchema } from '../demo/scenario';
import { useRealTraffic } from '../realmap/realTraffic';
import {
  REAL_COLORS, REAL_DEFAULTS, REAL_FLEET_SPEEDS, blankRealVehicle,
  useRealFleet, type VehiclePriority,
} from '../realmap/realFleetStore';
import {
  REAL_BOUNDS, REAL_CENTER, REAL_ROADS, joinArcs,
  nearestRoad, pointAt, realLabels, realNetworkPayload, realRoadsGeo,
} from '../realmap/realData';
import { REAL_META } from '../realmap/realMeta';

const AcceptSchema = z.object({
  accepted: z.boolean(),
  plan: z.object({
    arcs: z.array(z.object({ arcId: z.string(), from: z.string(), to: z.string() })).catch([]),
    vertices: z.array(z.string()).catch([]),
  }),
}).passthrough();

const DIVERSION_THRESHOLD_S = 60;
const CHECK_NORMAL_S = 180;
const CHECK_HIGH_S = 60;

function roadOf(arcId: string): string {
  return arcId.split(':')[0] ?? arcId;
}

interface VMutable {
  arcIdx: number; frac: number; simTimeS: number;
  durations: number[]; distances: number[];
  checking: boolean; lastCheckSim: number; lastVersion: number;
  policy: Record<string, unknown>;
  banner: {
    decision: string; reason: string; savingS: number | null;
    currentEtaS: number; candidateEtaS: number | null; candidateArcs: string[];
    frozenArcIdx: number; frozenArc: string; frozenFrac: number; frozenSim: number;
    overlayVersion: number;
  } | null;
  durCache: Map<string, number>; distCache: Map<string, number>;
}

function freshVMutable(): VMutable {
  return {
    arcIdx: 0, frac: 0, simTimeS: 0, durations: [], distances: [],
    checking: false, lastCheckSim: -100000, lastVersion: 1, policy: {}, banner: null,
    durCache: new Map(), distCache: new Map(),
  };
}

interface SandboxRoad {
  roadId: string;
  name: string;
  roadClass: string;
  oneWay: boolean;
  lengthM: number;
  distM: number;
}

export default function RealFleet() {
  const engineStatus = useEngineStatus();
  const fleet = useRealFleet();
  const trafficVersion = useRealTraffic((s) => s.version);
  const closures = useRealTraffic((s) => s.closures);
  const factors = useRealTraffic((s) => s.factors);
  const overlayOf = useRealTraffic((s) => s.overlay);
  const pushToast = useToasts((s) => s.push);
  const mapOut = useRef<MLMap | null>(null);
  const mut = useRef(new Map<string, VMutable>());
  const markers = useRef(new Map<string, Marker>());
  const fleetSim = useRef(0);
  const lastWall = useRef(0);
  const lastMirror = useRef(0);
  const lastSeenVersion = useRef(1);
  const [confirmStart, setConfirmStart] = useState(false);
  const [panelHidden, setPanelHidden] = useState(false);
  const [sandbox, setSandbox] = useState<SandboxRoad | null>(null);
  const [factorPct, setFactorPct] = useState(30);
  const [replay, setReplay] = useState(false);
  const [replayIdx, setReplayIdx] = useState(0);
  const [replayLen, setReplayLen] = useState(0);
  const rec = useRef(new Map<string, { t: number; lng: number; lat: number }[]>());
  const injected = useRef<{ incidents: string[]; closures: string[]; factors: string[] }>({
    incidents: [], closures: [], factors: [],
  });
  const replayRef = useRef(replay);
  replayRef.current = replay;

  const roads = useMemo(() => realRoadsGeo(), []);
  const labels = useMemo(() => realLabels(), []);

  function otherActive(): boolean {
    const js = useSim.getState().status;
    const ds = useDemo.getState().status;
    const fs = useFleet.getState().status;
    const rd = useRealDemo.getState().status;
    return js === 'running' || js === 'paused' || js === 'starting'
      || (ds !== 'idle' && ds !== 'completed' && ds !== 'error')
      || fs === 'running' || fs === 'paused' || fs === 'starting'
      || (rd !== 'idle' && rd !== 'completed' && rd !== 'error');
  }

  async function evalArc(id: string, arcId: string, from: string): Promise<{ timeS: number; distanceM: number }> {
    const m = mut.current.get(id);
    if (!m) throw new Error(`unknown vehicle ${id}`);
    const t = m.durCache.get(arcId);
    const d = m.distCache.get(arcId);
    if (t !== undefined && d !== undefined) return { timeS: t, distanceM: d };
    const o = await engineClient.call('route.evaluate', {
      network: realNetworkPayload(), overlay: overlayOf(), objective: 'FASTEST',
      plan: { arcs: [arcId], source: from },
    }, { channel: `realfleet-plan-${id}` });
    if (o.stale) throw new Error('stale evaluate');
    const ev = DemoEvalSchema.parse(o.result);
    if (!ev.valid || ev.blocked) throw new Error(`arc ${arcId} not traversable`);
    m.durCache.set(arcId, ev.timeS);
    m.distCache.set(arcId, ev.distanceM);
    return { timeS: ev.timeS, distanceM: ev.distanceM };
  }

  async function planVehicle(id: string): Promise<boolean> {
    const v = useRealFleet.getState().vehicles[id];
    const m = mut.current.get(id);
    if (!v || !m) return false;
    const o = await engineClient.call('route.find', {
      network: realNetworkPayload(), overlay: overlayOf(),
      source: v.origin, target: v.destination,
      objective: 'FASTEST', algorithm: 'DIJKSTRA',
    }, { channel: `realfleet-plan-${id}` });
    if (o.stale) throw new Error('stale route.find');
    const route = DemoRouteSchema.parse(o.result);
    if (!route.found) {
      useRealFleet.getState().patchVehicle(id, { status: 'error', error: route.reason || 'unreachable' });
      useRealFleet.getState().pushEvent(fleetSim.current, id, `${id} has no route (${route.reason || 'unreachable'})`);
      return false;
    }
    const durations: number[] = [];
    const distances: number[] = [];
    for (const a of route.arcs) {
      const e = await evalArc(id, a.arcId, a.from);
      durations.push(e.timeS);
      distances.push(e.distanceM);
    }
    m.durations = durations;
    m.distances = distances;
    const planned = durations.reduce((x, y) => x + y, 0);
    useRealFleet.getState().patchVehicle(id, {
      status: 'enroute', planArcs: route.arcs.map((a) => a.arcId),
      planVertices: route.vertices, durations, distances,
      remainingS: planned, remainingM: distances.reduce((x, y) => x + y, 0),
      slaDeadlineS: Math.ceil(planned * 1.5), sla: 'on-time',
    });
    useRealFleet.getState().pushEvent(fleetSim.current, id, `${id} ${v.label} planned ${route.arcs.length} segments`);
    return true;
  }

  function ensureMarkers() {
    const map = mapOut.current;
    if (!map) return;
    for (const id of useRealFleet.getState().order) {
      if (markers.current.has(id)) continue;
      const v = useRealFleet.getState().vehicles[id];
      if (!v) continue;
      const el = document.createElement('div');
      el.className = 'pf-mappin';
      el.textContent = id;
      el.style.background = v.color;
      el.setAttribute('data-testid', `realfleet-marker-${id}`);
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', `${id} ${v.label}`);
      const start = v.planArcs[0] ? pointAt(v.planArcs[0], 0) : null;
      markers.current.set(id, new Marker({ element: el, anchor: 'center' })
        .setLngLat(start ?? REAL_CENTER).addTo(map));
    }
  }

  async function start() {
    const st = useRealFleet.getState().status;
    if (st === 'starting' || st === 'running' || st === 'paused') return;
    if (otherActive()) {
      setConfirmStart(true);
      return;
    }
    await runStart();
  }

  async function runStart() {
    setConfirmStart(false);
    clearFleetTraffic();
    useRealFleet.getState().reset();
    mut.current = new Map();
    rec.current = new Map();
    for (const mk of markers.current.values()) mk.remove();
    markers.current = new Map();
    fleetSim.current = 0;
    setReplay(false);
    setReplayLen(0);
    lastSeenVersion.current = useRealTraffic.getState().version;
    useRealFleet.getState().set({ status: 'starting', error: '' });
    try {
      for (let i = 0; i < REAL_DEFAULTS.length; i++) {
        const pair = REAL_DEFAULTS[i]!;
        const id = `F${i + 1}`;
        useRealFleet.getState().upsertVehicle(blankRealVehicle(id, REAL_COLORS[i] ?? '#44403c', pair));
        mut.current.set(id, { ...freshVMutable(), lastVersion: lastSeenVersion.current });
        rec.current.set(id, []);
        await planVehicle(id);
      }
      ensureMarkers();
      useRealFleet.getState().set({ status: 'running' });
      lastWall.current = performance.now();
      pushToast(`Real fleet started: ${REAL_DEFAULTS.length} vehicles en route`);
    } catch (e) {
      useRealFleet.getState().set({
        status: 'error',
        error: e instanceof EngineError ? `${e.code}: ${e.message}` : String(e),
      });
    }
  }

  async function checkVehicle(id: string) {
    const v = useRealFleet.getState().vehicles[id];
    const m = mut.current.get(id);
    if (!v || !m || v.status !== 'enroute' || m.checking) return;
    const tv = useRealTraffic.getState().version;
    const cadence = v.priority === 'high' ? CHECK_HIGH_S : CHECK_NORMAL_S;
    if (m.simTimeS - m.lastCheckSim < cadence && m.lastVersion === tv) return;
    // Freeze the request-time position BEFORE the roundtrip: at high sim
    // speeds the vehicle moves while the engine call is in flight, and the
    // candidate is only valid from the position it was computed for.
    const reqArcIdx = m.arcIdx;
    const reqSim = Math.floor(m.simTimeS);
    m.checking = true;
    try {
      const remaining = v.planArcs.slice(reqArcIdx);
      if (remaining.length === 0) return;
      const arc = remaining[0] as string;
      const frac = Math.max(0, Math.min(1000, Math.floor(m.frac)));
      const o = await engineClient.call('diversion.evaluate', {
        network: realNetworkPayload(), overlay: overlayOf(),
        plan: { arcs: remaining },
        position: { arc, fractionPermille: frac },
        simTimeS: reqSim,
        config: { thresholdS: DIVERSION_THRESHOLD_S }, policy: m.policy,
      }, { channel: `realfleet-div-${id}` });
      if (o.stale) return;
      const d = DemoDivSchema.parse(o.result);
      m.lastCheckSim = m.simTimeS;
      m.lastVersion = tv;
      m.policy = d.policy as Record<string, unknown>;
      // Drop late responses: the vehicle may have completed while in flight.
      const live = useRealFleet.getState().vehicles[id];
      if (!live || live.status !== 'enroute') return;
      if (d.decision === 'NO_ROUTE_AVAILABLE') {
        useRealFleet.getState().patchVehicle(id, { status: 'blocked' });
        useRealFleet.getState().pushEvent(fleetSim.current, id, `${id} BLOCKED (${d.reason})`);
        return;
      }
      if (d.notify) {
        m.banner = {
          decision: d.decision, reason: d.reason, savingS: d.savingS,
          currentEtaS: d.currentEtaS, candidateEtaS: d.candidateEtaS,
          candidateArcs: (d.candidate?.arcs ?? []).map((a) => a.arcId),
          frozenArcIdx: reqArcIdx, frozenArc: arc, frozenFrac: frac,
          frozenSim: reqSim, overlayVersion: tv,
        };
        useRealFleet.getState().patchVehicle(id, {
          status: 'awaiting',
          decision: {
            decision: d.decision, reason: d.reason, savingS: d.savingS,
            currentEtaS: d.currentEtaS, candidateEtaS: d.candidateEtaS,
            candidateArcs: (d.candidate?.arcs ?? []).map((a) => a.arcId),
          },
        });
        useRealFleet.getState().pushEvent(fleetSim.current, id, `${id} decision: ${d.decision} (${d.reason})`);
      }
    } catch (e) {
      // Back off to a normal cadence instead of retrying every frame: a
      // failing check must not flood the worker with full-network calls.
      m.lastCheckSim = m.simTimeS;
      m.lastVersion = tv;
      useRealFleet.getState().pushEvent(
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
    const v = useRealFleet.getState().vehicles[id];
    const m = mut.current.get(id);
    if (!v || !m || !m.banner) return;
    const b = m.banner;
    try {
      const o = await engineClient.call('diversion.evaluate', {
        network: realNetworkPayload(), overlay: overlayOf(),
        plan: { arcs: v.planArcs.slice(b.frozenArcIdx) },
        position: { arc: b.frozenArc, fractionPermille: b.frozenFrac },
        simTimeS: b.frozenSim, config: { thresholdS: DIVERSION_THRESHOLD_S },
        action: 'accept', expectedVersion: b.overlayVersion,
        expectedPosition: { arc: b.frozenArc, fractionPermille: b.frozenFrac },
        candidate: { arcs: b.candidateArcs }, policy: m.policy,
      }, { channel: `realfleet-div-${id}` });
      if (o.stale) return;
      const a = AcceptSchema.parse(o.result);
      if (!a.accepted) {
        m.banner = null;
        useRealFleet.getState().patchVehicle(id, { status: 'enroute', decision: null });
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
      }
      m.arcIdx = 0;
      m.frac = b.frozenFrac;
      m.simTimeS = b.frozenSim;
      m.durations = durations;
      m.distances = distances;
      m.banner = null;
      const saved = b.savingS ?? 0;
      useRealFleet.getState().patchVehicle(id, {
        status: 'enroute', decision: null,
        planArcs: a.plan.arcs.map((x) => x.arcId), planVertices: a.plan.vertices,
        durations, distances, arcIdx: 0, fracPermille: b.frozenFrac, simTimeS: b.frozenSim,
        reroutes: v.reroutes + 1, savedEstimateS: v.savedEstimateS + saved,
        lastReceipt: {
          overlayVersion: b.overlayVersion, userAction: 'accept',
          policyDecision: b.decision, policyReason: b.reason,
          savingEstimateS: b.savingS, simTimeS: b.frozenSim,
        },
      });
      useRealFleet.getState().pushEvent(fleetSim.current, id, `${id} accepted diversion (${a.plan.arcs.length} segments)`);
      pushToast(`${id} rerouted on ${a.plan.arcs.length} segments`);
    } catch (e) {
      useRealFleet.getState().patchVehicle(id, {
        error: e instanceof EngineError ? `${e.code}: ${e.message}` : String(e),
      });
    }
  }

  async function stayVehicle(id: string) {
    const v = useRealFleet.getState().vehicles[id];
    const m = mut.current.get(id);
    if (!v || !m || !m.banner) return;
    const b = m.banner;
    try {
      const o = await engineClient.call('diversion.evaluate', {
        network: realNetworkPayload(), overlay: overlayOf(),
        plan: { arcs: v.planArcs.slice(b.frozenArcIdx) },
        position: { arc: b.frozenArc, fractionPermille: b.frozenFrac },
        simTimeS: b.frozenSim, config: { thresholdS: DIVERSION_THRESHOLD_S },
        action: 'reject', policy: m.policy,
      }, { channel: `realfleet-div-${id}` });
      if (!o.stale) {
        const d = DemoDivSchema.parse(o.result);
        m.policy = d.policy as Record<string, unknown>;
      }
    } catch {
      /* failed reject still dismisses locally */
    }
    m.banner = null;
    useRealFleet.getState().patchVehicle(id, {
      status: 'enroute', decision: null,
      lastReceipt: {
        overlayVersion: b.overlayVersion, userAction: 'stay',
        policyDecision: b.decision, policyReason: b.reason,
        savingEstimateS: b.savingS, simTimeS: b.frozenSim,
      },
    });
    useRealFleet.getState().pushEvent(fleetSim.current, id, `${id} stayed on route`);
  }

  function closeRoadTrack(road: string, kind: 'accident' | 'construction' | 'jam' = 'accident'): boolean {
    const t = useRealTraffic.getState();
    if (!road || t.closures.includes(road)) return false;
    injected.current.incidents.push(t.addIncident(road, 'both', kind));
    useRealTraffic.getState().toggleClosure(road);
    injected.current.closures.push(road);
    return true;
  }

  function clearFleetTraffic() {
    const t = useRealTraffic.getState();
    for (const id of injected.current.incidents) t.removeIncident(id);
    for (const road of injected.current.closures) {
      if (useRealTraffic.getState().closures.includes(road)) useRealTraffic.getState().toggleClosure(road);
    }
    for (const road of injected.current.factors) t.clearFactor(road);
    injected.current = { incidents: [], closures: [], factors: [] };
  }

  function simulateIncident() {
    const s = useRealFleet.getState();
    if (s.status !== 'running' && s.status !== 'paused') return;
    const target = (s.selectedId && s.vehicles[s.selectedId]?.status === 'enroute'
      ? s.vehicles[s.selectedId]! : undefined)
      ?? s.order.map((id) => s.vehicles[id]!).find((v) => v && v.status === 'enroute');
    const m = target ? mut.current.get(target.id) : undefined;
    if (!target || !m) {
      pushToast('No en-route vehicle to disrupt', 'error');
      return;
    }
    const t = useRealTraffic.getState();
    const future = target.planArcs.slice(m.arcIdx + 1);
    const road = future.map(roadOf).find((r) => !t.closures.includes(r))
      ?? roadOf(target.planArcs[m.arcIdx] ?? '');
    if (!road || !closeRoadTrack(road)) {
      pushToast('No eligible road ahead', 'error');
      return;
    }
    useRealFleet.getState().pushEvent(fleetSim.current, target.id, `SIMULATED incident: ${road} closed (affects ${target.id} route)`);
    pushToast(`SIMULATED incident: ${road} closed`, 'error');
  }

  function emergencyDrill() {
    const s = useRealFleet.getState();
    if (s.status !== 'running' && s.status !== 'paused') return;
    const target = s.order.map((id) => s.vehicles[id]!).find((v) => v && v.status === 'enroute');
    const m = target ? mut.current.get(target.id) : undefined;
    if (!target || !m) {
      pushToast('No en-route vehicle for the drill', 'error');
      return;
    }
    useRealFleet.getState().patchVehicle(target.id, { priority: 'high' });
    const t = useRealTraffic.getState();
    const future = target.planArcs.slice(m.arcIdx + 1);
    const road = future.map(roadOf).find((r) => !t.closures.includes(r));
    if (road) closeRoadTrack(road, 'accident');
    useRealFleet.getState().pushEvent(
      fleetSim.current, target.id,
      `SIMULATED emergency drill: ${target.id} priority HIGH${road ? `, ${road} closed ahead` : ''}`,
    );
    pushToast(`SIMULATED emergency drill on ${target.id} (priority HIGH). Not real dispatch.`, 'error');
  }

  function onMapClick(ll: { lng: number; lat: number }) {
    const hit = nearestRoad(ll.lng, ll.lat);
    if (!hit) {
      setSandbox(null);
      pushToast('No road within 100 m of that click', 'error');
      return;
    }
    const r = REAL_ROADS.find((x) => x.id === hit.roadId);
    if (!r) {
      setSandbox(null);
      return;
    }
    setSandbox({
      roadId: r.id, name: r.name || '(unnamed way)', roadClass: r.roadType,
      oneWay: r.oneWay, lengthM: r.distanceM, distM: hit.distM,
    });
  }

  // Single fleet loop; per-vehicle clocks advance together.
  useEffect(() => {
    if (fleet.status !== 'running') return;
    let raf = 0;
    const tick = (now: number) => {
      const s = useRealFleet.getState();
      const dt = Math.max(0, (now - lastWall.current) / 1000);
      lastWall.current = now;
      if (!replayRef.current) fleetSim.current += dt * s.speed;
      const tv = useRealTraffic.getState().version;
      const versionChanged = tv !== lastSeenVersion.current;
      if (versionChanged) lastSeenVersion.current = tv;
      let allTerminal = s.order.length > 0;
      for (const id of s.order) {
        const v = s.vehicles[id];
        const m = mut.current.get(id);
        if (!v || !m) continue;
        if (v.status === 'enroute' && !replayRef.current) {
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
                const met = Math.floor(m.simTimeS) <= v.slaDeadlineS;
                useRealFleet.getState().patchVehicle(id, {
                  status: 'completed', progress: 1,
                  arcIdx: m.arcIdx, fracPermille: 1000, simTimeS: Math.floor(m.simTimeS),
                  remainingS: 0, remainingM: 0, sla: met ? 'met' : 'missed',
                });
                useRealFleet.getState().pushEvent(
                  fleetSim.current, id, `${id} completed delivery (SLA ${met ? 'met' : 'missed'})`,
                );
                continue;
              }
            }
          }
          if (versionChanged || m.simTimeS - m.lastCheckSim >= (v.priority === 'high' ? CHECK_HIGH_S : CHECK_NORMAL_S)) {
            void checkRef.current(id);
          }
        } else if (v.status === 'awaiting') {
          allTerminal = false;
        }
        const mk = markers.current.get(id);
        if (mk) {
          if (replayRef.current) {
            // Replay positions come from the recording in the replay effect.
          } else {
            const arcId = v.planArcs[m.arcIdx];
            const p = arcId ? pointAt(arcId, m.frac) : null;
            if (p) mk.setLngLat(p);
          }
        }
      }
      if (allTerminal && !replayRef.current) {
        useRealFleet.getState().set({ status: 'completed' });
        useRealFleet.getState().pushEvent(fleetSim.current, null, 'Fleet run completed');
        return;
      }
      if (now - lastMirror.current >= 200) {
        lastMirror.current = now;
        const ts = useRealTraffic.getState();
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
          const sla: typeof v.sla = m.simTimeS + Math.max(0, remS) <= v.slaDeadlineS ? 'on-time' : 'at-risk';
          useRealFleet.getState().patchVehicle(id, {
            arcIdx: m.arcIdx, fracPermille: Math.floor(m.frac), simTimeS: Math.floor(m.simTimeS),
            remainingS: Math.max(0, Math.round(remS)), remainingM: Math.max(0, Math.round(remM)),
            progress: v.planArcs.length === 0 ? 0 : Math.min(1, (m.arcIdx + m.frac / 1000) / v.planArcs.length),
            affected, sla,
          });
          // Replay recording: 5 Hz true positions per vehicle.
          if (!replayRef.current && v.status === 'enroute') {
            const arcId = v.planArcs[m.arcIdx];
            const p = arcId ? pointAt(arcId, m.frac) : null;
            if (p) {
              const buf = rec.current.get(id) ?? [];
              buf.push({ t: Math.floor(fleetSim.current), lng: p[0], lat: p[1] });
              if (buf.length > 1200) buf.splice(0, buf.length - 1200);
              rec.current.set(id, buf);
              setReplayLen((n) => Math.max(n, buf.length));
            }
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    lastWall.current = performance.now();
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleet.status, fleet.speed]);

  // Replay scrub positions markers from the recording (sim frozen meanwhile).
  useEffect(() => {
    if (!replay) return;
    for (const [id, mk] of markers.current) {
      const buf = rec.current.get(id) ?? [];
      const p = buf[Math.min(replayIdx, buf.length - 1)];
      if (p) mk.setLngLat([p.lng, p.lat]);
    }
  }, [replay, replayIdx]);

  function reset() {
    clearFleetTraffic();
    for (const mk of markers.current.values()) mk.remove();
    markers.current = new Map();
    mut.current = new Map();
    rec.current = new Map();
    fleetSim.current = 0;
    setReplay(false);
    setReplayLen(0);
    setSandbox(null);
    useRealFleet.getState().reset();
  }

  const selected = fleet.selectedId ? fleet.vehicles[fleet.selectedId] : undefined;
  const routeCoords = useMemo(
    () => (selected && selected.planArcs.length > 0 ? joinArcs(selected.planArcs) : null),
    [selected],
  );
  const candidateCoords = useMemo(
    () => fleet.order.flatMap((id) => {
      const d = fleet.vehicles[id]?.decision;
      return d ? [joinArcs(d.candidateArcs)] : [];
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fleet.vehicles],
  );
  const counts = { active: 0, completed: 0, awaiting: 0, blocked: 0, met: 0, missed: 0 };
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
    if (v.sla === 'met') counts.met += 1;
    if (v.sla === 'missed') counts.missed += 1;
    if (v.status === 'enroute' || v.status === 'awaiting') totalRemaining += v.remainingS;
    reroutes += v.reroutes;
    saved += v.savedEstimateS;
  }
  const affectedCount = fleet.order.filter((id) => (fleet.vehicles[id]?.affected.length ?? 0) > 0).length;
  const sandboxClosed = sandbox ? closures.includes(sandbox.roadId) : false;

  return (
    <div>
      <button className="pf-btn small pf-panel-toggle" data-testid="panel-toggle"
        aria-expanded={!panelHidden} onClick={() => setPanelHidden(!panelHidden)}>
        {panelHidden ? 'Show panel' : 'Hide panel'}
      </button>
      <div className={`pf-workspace${panelHidden ? ' panel-hidden' : ''}`}>
        <div className="pf-map-wrap pf-map-tall">
          <RealMap testid="realmap" initialCenter={REAL_CENTER} initialZoom={13}
            fitBounds={REAL_BOUNDS} roads={roads} labels={labels} mapOut={mapOut}
            route={routeCoords} altRoutes={candidateCoords} onMapClick={onMapClick} />
        </div>
        <div className="pf-panel">
          <section className="pf-card" aria-label="Real fleet controls">
            <h2>Real Fleet Command</h2>
            <p className="pf-meta" data-testid="engine-status">Engine: {engineStatus}</p>
            <p className="pf-meta" role="status" data-testid="realfleet-status">Status: {fleet.status}</p>
            <p className="pf-meta" data-testid="realfleet-overlay">Real overlay v{trafficVersion}</p>
            <p className="pf-meta" data-testid="realfleet-counts">
              Active {counts.active} · Completed {counts.completed} · Awaiting {counts.awaiting} · Blocked {counts.blocked}
            </p>
            <div className="pf-row">
              {(fleet.status === 'idle' || fleet.status === 'completed' || fleet.status === 'error') && (
                <button className="pf-btn primary" onClick={() => void start()} data-testid="realfleet-start">
                  Start Real Fleet
                </button>
              )}
              {fleet.status === 'running' && !replay && (
                <button className="pf-btn" onClick={() => fleet.set({ status: 'paused' })} data-testid="realfleet-pause">
                  Pause
                </button>
              )}
              {fleet.status === 'paused' && (
                <button className="pf-btn" onClick={() => { lastWall.current = performance.now(); fleet.set({ status: 'running' }); }} data-testid="realfleet-resume">
                  Resume
                </button>
              )}
              {(fleet.status === 'running' || fleet.status === 'paused') && !replay && (
                <button className="pf-btn" onClick={simulateIncident} data-testid="realfleet-incident">
                  Simulate Incident
                </button>
              )}
              {(fleet.status === 'running' || fleet.status === 'paused') && !replay && (
                <button className="pf-btn" onClick={emergencyDrill} data-testid="realfleet-emergency">
                  Emergency Drill
                </button>
              )}
              {(fleet.status === 'running' || fleet.status === 'paused') && (
                <button className="pf-btn" onClick={() => { setReplay((r) => !r); setReplayIdx(0); }}
                  data-testid="realfleet-replay" disabled={replayLen === 0}>
                  {replay ? 'Back to Live' : 'Replay'}
                </button>
              )}
              {fleet.status !== 'idle' && fleet.status !== 'starting' && (
                <button className="pf-btn" onClick={reset} data-testid="realfleet-reset">Reset</button>
              )}
            </div>
            {replay && (
              <div className="pf-field">
                <label htmlFor="realfleet-scrub">Replay timeline ({replayLen} samples @ 5 Hz)</label>
                <input id="realfleet-scrub" type="range" min={0} max={Math.max(0, replayLen - 1)} value={replayIdx}
                  onChange={(e) => setReplayIdx(Number(e.target.value))} data-testid="realfleet-scrub" />
              </div>
            )}
            <div className="pf-field">
              <label htmlFor="realfleet-speed">Speed</label>
              <select id="realfleet-speed" value={fleet.speed}
                onChange={(e) => fleet.set({ speed: Number(e.target.value) })} data-testid="realfleet-speed">
                {REAL_FLEET_SPEEDS.map((v) => <option key={v} value={v}>{v}×</option>)}
              </select>
              <p className="pf-meta">{fleet.speed}×: one wall-clock second advances {fleet.speed} simulated seconds.</p>
            </div>
            {fleet.error && <div className="pf-alert error" role="alert" data-testid="realfleet-error">{fleet.error}</div>}
          </section>
          <section className="pf-card" aria-label="Dispatch board" data-testid="realfleet-board">
            <h2>Dispatch board</h2>
            {fleet.order.length === 0 && <p className="pf-meta">Start the fleet to dispatch vehicles.</p>}
            <ul>
              {fleet.order.map((id) => {
                const v = fleet.vehicles[id];
                if (!v) return null;
                return (
                  <li key={id} data-testid={`realfleet-vehicle-${id}`}>
                    <button className="pf-btn small" data-testid={`realfleet-select-${id}`}
                      aria-pressed={fleet.selectedId === id}
                      onClick={() => fleet.set({ selectedId: id })}>
                      {id}
                    </button>{' '}
                    <span data-testid={`realfleet-vstatus-${id}`}>{v.status}</span>{' '}
                    {v.originName} → {v.destinationName} ·{' '}
                    <span data-testid={`realfleet-vprogress-${id}`}>{Math.round(v.progress * 100)}%</span> ·{' '}
                    ETA {formatSeconds(v.remainingS)} (est.) ·{' '}
                    <span data-testid={`realfleet-vsla-${id}`}>SLA {v.sla}</span> ·{' '}
                    <label>Priority{' '}
                      <select value={v.priority} data-testid={`realfleet-vprio-${id}`}
                        onChange={(e) => fleet.patchVehicle(id, { priority: e.target.value as VehiclePriority })}>
                        <option value="normal">normal</option>
                        <option value="high">high</option>
                      </select>
                    </label>
                    {v.affected.length > 0 && <> · <span data-testid={`realfleet-vaffected-${id}`}>affected: {v.affected.join(', ')}</span></>}
                    {v.status === 'awaiting' && v.decision && (
                      <span data-testid={`realfleet-vdecision-${id}`}>
                        {' '}· {v.decision.decision} ({v.decision.reason})
                        <span className="pf-row">
                          <button className="pf-btn small" data-testid={`realfleet-accept-${id}`}
                            onClick={() => void acceptVehicle(id)}>Accept</button>
                          <button className="pf-btn small" data-testid={`realfleet-stay-${id}`}
                            onClick={() => void stayVehicle(id)}>Stay</button>
                        </span>
                      </span>
                    )}
                    {v.error && <> · <span role="alert">{v.error}</span></>}
                  </li>
                );
              })}
            </ul>
            <p className="pf-meta">High priority runs diversion checks every 60 simulated seconds instead of 180.</p>
            {selected?.lastReceipt && (
              <div data-testid="realfleet-receipt">
                <h3>{selected.id} decision receipt</h3>
                <dl className="pf-facts">
                  <dt>Overlay</dt><dd data-testid="realfleet-receipt-overlay">v{selected.lastReceipt.overlayVersion}</dd>
                  <dt>Policy</dt><dd>{selected.lastReceipt.policyDecision} — {selected.lastReceipt.policyReason}</dd>
                  <dt>Action</dt><dd data-testid="realfleet-receipt-action">{selected.lastReceipt.userAction}</dd>
                </dl>
              </div>
            )}
          </section>
          <section className="pf-card" aria-label="Fleet KPIs" data-testid="realfleet-kpis">
            <h2>Operations KPIs</h2>
            <dl className="pf-facts">
              <dt>Remaining (est.)</dt><dd data-testid="realfleet-kpi-remaining">{formatSeconds(totalRemaining)}</dd>
              <dt>Completed</dt><dd data-testid="realfleet-kpi-completed">{counts.completed}</dd>
              <dt>Affected</dt><dd data-testid="realfleet-kpi-affected">{affectedCount}</dd>
              <dt>Reroutes</dt><dd data-testid="realfleet-kpi-reroutes">{reroutes}</dd>
              <dt>Saved (est.)</dt><dd data-testid="realfleet-kpi-saved">{formatSeconds(saved)}</dd>
              <dt>SLA met/missed</dt><dd data-testid="realfleet-kpi-sla">{counts.met}/{counts.missed}</dd>
            </dl>
          </section>
          <section className="pf-card" aria-label="Traffic sandbox" data-testid="realfleet-sandbox">
            <h2>Traffic sandbox</h2>
            {!sandbox && <p className="pf-meta">Click any road on the map to close it, throttle it, or report an incident. SIMULATED.</p>}
            {sandbox && (
              <div data-testid="realfleet-road">
                <p>
                  <strong data-testid="realfleet-road-id">{sandbox.roadId}</strong> · {sandbox.name} ·{' '}
                  {sandbox.roadClass}{sandbox.oneWay ? ' · one-way' : ''} · {formatMetres(sandbox.lengthM)} ·{' '}
                  {sandbox.distM} m from click
                </p>
                <p data-testid="realfleet-road-state">
                  State: {sandboxClosed ? 'CLOSED' : 'open'}
                  {factors[sandbox.roadId] !== undefined
                    ? ` · factor ${(factors[sandbox.roadId] ?? 0) / 10}%` : ''}
                </p>
                <div className="pf-row">
                  <button className="pf-btn small" data-testid="realfleet-road-close"
                    onClick={() => {
                      const t = useRealTraffic.getState();
                      if (!t.closures.includes(sandbox.roadId)) {
                        injected.current.incidents.push(t.addIncident(sandbox.roadId, 'both', 'accident'));
                        t.toggleClosure(sandbox.roadId);
                        injected.current.closures.push(sandbox.roadId);
                        pushToast(`SIMULATED: ${sandbox.roadId} closed`, 'error');
                      }
                    }}>
                    Close road
                  </button>
                  <button className="pf-btn small" data-testid="realfleet-road-open"
                    onClick={() => {
                      const t = useRealTraffic.getState();
                      if (t.closures.includes(sandbox.roadId)) {
                        t.toggleClosure(sandbox.roadId);
                        pushToast(`${sandbox.roadId} reopened`);
                      }
                    }}>
                    Reopen
                  </button>
                </div>
                <div className="pf-field">
                  <label htmlFor="realfleet-factor">Congestion factor: {factorPct}% speed</label>
                  <input id="realfleet-factor" type="range" min={10} max={100} value={factorPct}
                    onChange={(e) => setFactorPct(Number(e.target.value))} data-testid="realfleet-factor" />
                </div>
                <div className="pf-row">
                  <button className="pf-btn small" data-testid="realfleet-factor-apply"
                    onClick={() => {
                      useRealTraffic.getState().setFactor(sandbox.roadId, factorPct * 10);
                      if (!injected.current.factors.includes(sandbox.roadId)) {
                        injected.current.factors.push(sandbox.roadId);
                      }
                      pushToast(`SIMULATED: ${sandbox.roadId} at ${factorPct}% speed`, 'error');
                    }}>
                    Apply factor
                  </button>
                  <button className="pf-btn small" data-testid="realfleet-factor-clear"
                    onClick={() => {
                      useRealTraffic.getState().clearFactor(sandbox.roadId);
                      pushToast(`Factor cleared on ${sandbox.roadId}`);
                    }}>
                    Clear factor
                  </button>
                </div>
              </div>
            )}
          </section>
          <section className="pf-card" aria-label="Event feed" data-testid="realfleet-events">
            <h2>Event feed</h2>
            {fleet.events.length === 0 && <p className="pf-meta">No simulated events yet.</p>}
            <ol>
              {[...fleet.events].reverse().slice(0, 30).map((e) => (
                <li key={e.seq} data-testid={`realfleet-event-${e.seq}`}>
                  [{formatSeconds(e.fleetSimS)}] {e.text}
                </li>
              ))}
            </ol>
          </section>
          <SourceBadge meta={REAL_META} />
          <Confirm open={confirmStart} title="Start real fleet?"
            body="This starts a new simulated real-roads fleet run. Another simulation may be in progress."
            confirmLabel="Start anyway" testid="realfleet-overwrite"
            onCancel={() => setConfirmStart(false)}
            onConfirm={() => void runStart()} />
        </div>
      </div>
    </div>
  );
}
