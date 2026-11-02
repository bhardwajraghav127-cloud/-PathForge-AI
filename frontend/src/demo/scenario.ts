// Smart Demo scenario (V1): deterministic scripted incident selection.
//
// Fixed story: Chandigarh → Delhi, FASTEST, Dijkstra. The incident milestone
// is entering plan arc index 1; the closed road is the FIRST future arc
// (index >= 2, in plan order) whose closure makes the real C++ diversion
// policy notify from the milestone position. If no candidate notifies, the
// scenario reports honestly instead of forcing a narrative.
//
// Every number comes from the engine; this module only searches candidates.
import { z } from 'zod';
import { engineClient } from '../engine/client';
import { networkPayload } from '../data/dataset';
import type { OverlayPayload } from '../traffic';

export const DemoRouteSchema = z.object({
  found: z.boolean(), reason: z.string().catch(''),
  arcs: z.array(z.object({
    arcId: z.string(), roadId: z.string().catch(''), from: z.string(), to: z.string(),
  })).catch([]),
  vertices: z.array(z.string()).catch([]),
  distanceM: z.number().catch(0), baselineTimeS: z.number().catch(0),
  timeS: z.number().catch(0), delayS: z.number().catch(0),
  tollInr: z.number().catch(0), objectiveCost: z.number().catch(0),
  objectiveDescription: z.string().catch(''),
}).passthrough();

export type DemoRoute = z.infer<typeof DemoRouteSchema>;

export const DemoDivSchema = z.object({
  decision: z.string(), reason: z.string().catch(''),
  savingS: z.number().nullable().catch(null),
  currentEtaS: z.number().catch(0), candidateEtaS: z.number().nullable().catch(null),
  notify: z.boolean().catch(false),
  candidate: z.object({ arcs: z.array(z.object({ arcId: z.string() })).catch([]) }).nullable().catch(null),
  policy: z.record(z.string(), z.unknown()).catch({}),
}).passthrough();

export const DemoEvalSchema = z.object({
  valid: z.boolean(), blocked: z.boolean().catch(false),
  timeS: z.number().catch(0), distanceM: z.number().catch(0),
}).passthrough();

export interface DemoCandidate {
  injectAtArcIdx: number;
  targetRoad: string;
  targetArc: string;
  targetFrom: string;
  targetTo: string;
  decision: string;
  reason: string;
  savingS: number | null;
}

export interface DemoScenario {
  source: string;
  target: string;
  objective: string;
  algorithm: string;
  route: DemoRoute;
  alternatives: DemoRoute[];
  candidate: DemoCandidate | null;
  noDiversionDetail: string;
  overlayVersion: number;
}

export const DEMO_SOURCE = 'chandigarh';
export const DEMO_TARGET = 'delhi';
export const DEMO_OBJECTIVE = 'FASTEST';
export const DEMO_ALGORITHM = 'DIJKSTRA';
export const DEMO_INJECT_IDX = 1;
export const DEMO_DIVERSION_THRESHOLD_S = 600;

function roadOf(arcId: string): string {
  return arcId.split(':')[0] ?? arcId;
}

export async function prepareScenario(baseline: OverlayPayload): Promise<DemoScenario> {
  const network = networkPayload();
  const base = {
    network, overlay: baseline,
    source: DEMO_SOURCE, target: DEMO_TARGET, objective: DEMO_OBJECTIVE,
  };
  const o = await engineClient.call('route.find', { ...base, algorithm: DEMO_ALGORITHM }, { channel: 'demo' });
  if (o.stale) throw new Error('stale route.find');
  const route = DemoRouteSchema.parse(o.result);
  if (!route.found || route.arcs.length < 4) {
    throw new Error(`demo route unavailable: ${route.reason || 'too short'}`);
  }
  let alternatives: DemoRoute[] = [];
  const ao = await engineClient.call(
    'route.alternatives', { ...base, maxCandidates: 10, maxAlternatives: 3 }, { channel: 'demo' },
  );
  if (!ao.stale) {
    const parsed = z.object({ alternatives: z.array(DemoRouteSchema).catch([]) }).passthrough().parse(ao.result);
    alternatives = parsed.alternatives.filter((a) => a.found).slice(0, 2);
  }
  const milestoneArc = route.arcs[DEMO_INJECT_IDX];
  if (!milestoneArc) throw new Error('demo route too short for milestone');
  const remaining = route.arcs.slice(DEMO_INJECT_IDX).map((a) => a.arcId);
  const tried: string[] = [];
  for (let i = DEMO_INJECT_IDX + 1; i < route.arcs.length; i++) {
    const arc = route.arcs[i];
    if (!arc) continue;
    const road = arc.roadId || roadOf(arc.arcId);
    if (tried.includes(road)) continue;
    tried.push(road);
    const overlay = { ...baseline, closures: [...baseline.closures, road] };
    const d = await engineClient.call('diversion.evaluate', {
      network, overlay,
      plan: { arcs: remaining },
      position: { arc: milestoneArc.arcId, fractionPermille: 0 },
      simTimeS: 0,
      config: { thresholdS: DEMO_DIVERSION_THRESHOLD_S },
    }, { channel: 'demo' });
    if (d.stale) throw new Error('stale diversion.evaluate');
    const div = DemoDivSchema.parse(d.result);
    if (div.notify) {
      return {
        source: DEMO_SOURCE, target: DEMO_TARGET, objective: DEMO_OBJECTIVE,
        algorithm: DEMO_ALGORITHM, route, alternatives,
        candidate: {
          injectAtArcIdx: DEMO_INJECT_IDX, targetRoad: road,
          targetArc: arc.arcId, targetFrom: arc.from, targetTo: arc.to,
          decision: div.decision, reason: div.reason, savingS: div.savingS,
        },
        noDiversionDetail: '', overlayVersion: baseline.version,
      };
    }
  }
  return {
    source: DEMO_SOURCE, target: DEMO_TARGET, objective: DEMO_OBJECTIVE,
    algorithm: DEMO_ALGORITHM, route, alternatives, candidate: null,
    noDiversionDetail: `No single-road closure on the ${route.arcs.length - 2} future`
      + ` candidate(s) after the milestone produced an actionable diversion`
      + ` (threshold ${DEMO_DIVERSION_THRESHOLD_S}s).`,
    overlayVersion: baseline.version,
  };
}
