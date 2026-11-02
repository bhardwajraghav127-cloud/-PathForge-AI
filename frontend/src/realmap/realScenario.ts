// Real-road demo scenario (R4): fixed Connaught Place → Central Vista
// story with a deterministic first-actionable-closure search through the
// real diversion policy. Verified by hand at dev time (milestone arc 8,
// target r01105 → REROUTE_REQUIRED); the runtime search re-derives it.
import { engineClient } from '../engine/client';
import { DemoDivSchema, DemoRouteSchema } from '../demo/scenario';
import { realNetworkPayload } from './realData';
import type { RealOverlayPayload } from './realTraffic';

export const REAL_DEMO_SOURCE = 'n1191294765';
export const REAL_DEMO_TARGET = 'n6666318646';
export const REAL_DEMO_OBJECTIVE = 'FASTEST';
export const REAL_DEMO_ALGORITHM = 'DIJKSTRA';
export const REAL_DEMO_INJECT_IDX = 8;
export const REAL_DEMO_THRESHOLD_S = 60;

export interface RealDemoCandidate {
  injectAtArcIdx: number;
  targetRoad: string;
  targetArc: string;
  decision: string;
  reason: string;
  savingS: number | null;
}

export interface RealDemoScenario {
  route: { arcs: { arcId: string; from: string; to: string }[]; vertices: string[]; timeS: number; distanceM: number };
  candidate: RealDemoCandidate | null;
  noDiversionDetail: string;
  overlayVersion: number;
}

export async function prepareRealScenario(baseline: RealOverlayPayload): Promise<RealDemoScenario> {
  const network = realNetworkPayload();
  const base = {
    network, overlay: baseline,
    source: REAL_DEMO_SOURCE, target: REAL_DEMO_TARGET, objective: REAL_DEMO_OBJECTIVE,
  };
  const o = await engineClient.call('route.find', { ...base, algorithm: REAL_DEMO_ALGORITHM }, { channel: 'realdemo' });
  if (o.stale) throw new Error('stale route.find');
  const route = DemoRouteSchema.parse(o.result);
  if (!route.found || route.arcs.length < 12) {
    throw new Error(`real demo route unavailable: ${route.reason || 'too short'}`);
  }
  const milestoneArc = route.arcs[REAL_DEMO_INJECT_IDX];
  if (!milestoneArc) throw new Error('real demo route too short for milestone');
  const remaining = route.arcs.slice(REAL_DEMO_INJECT_IDX).map((a) => a.arcId);
  const tried: string[] = [];
  for (let i = REAL_DEMO_INJECT_IDX + 1; i < route.arcs.length; i++) {
    const arc = route.arcs[i];
    if (!arc) continue;
    const road = arc.arcId.split(':')[0] ?? arc.arcId;
    if (tried.includes(road)) continue;
    tried.push(road);
    const overlay = { ...baseline, closures: [...baseline.closures, road] };
    const d = await engineClient.call('diversion.evaluate', {
      network, overlay,
      plan: { arcs: remaining },
      position: { arc: milestoneArc.arcId, fractionPermille: 0 },
      simTimeS: 0,
      config: { thresholdS: REAL_DEMO_THRESHOLD_S },
    }, { channel: 'realdemo' });
    if (d.stale) throw new Error('stale diversion.evaluate');
    const div = DemoDivSchema.parse(d.result);
    if (div.notify) {
      return {
        route: {
          arcs: route.arcs.map((a) => ({ arcId: a.arcId, from: a.from, to: a.to })),
          vertices: route.vertices, timeS: route.timeS, distanceM: route.distanceM,
        },
        candidate: {
          injectAtArcIdx: REAL_DEMO_INJECT_IDX, targetRoad: road,
          targetArc: arc.arcId, decision: div.decision,
          reason: div.reason, savingS: div.savingS,
        },
        noDiversionDetail: '', overlayVersion: baseline.version,
      };
    }
  }
  return {
    route: {
      arcs: route.arcs.map((a) => ({ arcId: a.arcId, from: a.from, to: a.to })),
      vertices: route.vertices, timeS: route.timeS, distanceM: route.distanceM,
    },
    candidate: null,
    noDiversionDetail: `No single-road closure on the ${tried.length} future candidate(s)`
      + ` produced an actionable diversion (threshold ${REAL_DEMO_THRESHOLD_S}s).`,
    overlayVersion: baseline.version,
  };
}
