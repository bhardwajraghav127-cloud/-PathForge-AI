// Traffic store: user-applied overlay state (M7). Version bumps on every
// mutation; the engine treats version as opaque and recomputes weights from
// the incident/factor/closure sets each call.
import { create } from 'zustand';

export type IncidentKind = 'jam' | 'accident' | 'construction' | 'partial' | 'closure';
export type IncidentDir = 'both' | 'forward' | 'reverse';

export interface TrafficIncident {
  id: string;
  road: string;
  dir: IncidentDir;
  kind: Exclude<IncidentKind, 'closure'>;
}

export interface OverlayPayload {
  version: number;
  incidents: { id: string; road: string; dir: string; kind: string }[];
  factors: Record<string, number>;
  closures: string[];
}

interface TrafficState {
  version: number;
  incidents: TrafficIncident[];
  factors: Record<string, number>;
  closures: string[];
  seq: number;
  addIncident: (road: string, dir: IncidentDir, kind: TrafficIncident['kind']) => string;
  removeIncident: (id: string) => void;
  setFactor: (road: string, permille: number) => void;
  clearFactor: (road: string) => void;
  toggleClosure: (road: string) => void;
  overlay: () => OverlayPayload;
}

export const useTraffic = create<TrafficState>()((set, get) => ({
  version: 1,
  incidents: [],
  factors: {},
  closures: [],
  seq: 1,
  addIncident: (road, dir, kind) => {
    const id = `i${get().seq}`;
    set((s) => ({
      incidents: [...s.incidents, { id, road, dir, kind }],
      seq: s.seq + 1,
      version: s.version + 1,
    }));
    return id;
  },
  removeIncident: (id) =>
    set((s) => ({
      incidents: s.incidents.filter((i) => i.id !== id),
      version: s.version + 1,
    })),
  setFactor: (road, permille) =>
    set((s) => ({
      factors: { ...s.factors, [road]: Math.max(1, Math.min(1000, Math.round(permille))) },
      version: s.version + 1,
    })),
  clearFactor: (road) =>
    set((s) => {
      const factors = { ...s.factors };
      delete factors[road];
      return { factors, version: s.version + 1 };
    }),
  toggleClosure: (road) =>
    set((s) => ({
      closures: s.closures.includes(road)
        ? s.closures.filter((c) => c !== road)
        : [...s.closures, road],
      version: s.version + 1,
    })),
  overlay: () => {
    const s = get();
    return {
      version: s.version,
      incidents: s.incidents.map((i) => ({ id: i.id, road: i.road, dir: i.dir, kind: i.kind })),
      factors: s.factors,
      closures: s.closures,
    };
  },
}));
