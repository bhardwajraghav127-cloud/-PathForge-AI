// Real-roads traffic overlay (R4). Same shape as the sim overlay but a
// SEPARATE store: real road ids (r00001…) live in a different namespace
// from sim roads (ex06…), so sharing one overlay would poison engine calls
// with unknown ids. Own localStorage key, own incident sequence.
import { create } from 'zustand';

export type RealIncidentDir = 'both' | 'forward' | 'reverse';
export interface RealTrafficIncident {
  id: string;
  road: string;
  dir: RealIncidentDir;
  kind: 'jam' | 'accident' | 'construction' | 'partial';
}
export interface RealOverlayPayload {
  version: number;
  closures: string[];
  incidents: RealTrafficIncident[];
  factors: Record<string, number>;
}

interface RealTrafficState {
  version: number;
  incidents: RealTrafficIncident[];
  factors: Record<string, number>;
  closures: string[];
  seq: number;
  overlay: () => RealOverlayPayload;
  addIncident: (road: string, dir: RealIncidentDir, kind: RealTrafficIncident['kind']) => string;
  removeIncident: (id: string) => void;
  setFactor: (road: string, permille: number) => void;
  clearFactor: (road: string) => void;
  toggleClosure: (road: string) => void;
  loadSnapshot: (overlay: RealOverlayPayload) => void;
  clearAll: () => void;
}

function load(): Pick<RealTrafficState, 'incidents' | 'factors' | 'closures' | 'seq'> | null {
  try {
    const raw = localStorage.getItem('pf-real-traffic');
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<RealTrafficState>;
    if (!Array.isArray(p.incidents) || typeof p.factors !== 'object' || !Array.isArray(p.closures)) return null;
    return { incidents: p.incidents, factors: p.factors ?? {}, closures: p.closures, seq: p.seq ?? 1 };
  } catch {
    return null;
  }
}

function save(s: RealTrafficState) {
  try {
    localStorage.setItem('pf-real-traffic', JSON.stringify({
      incidents: s.incidents, factors: s.factors, closures: s.closures, seq: s.seq,
    }));
  } catch {
    /* storage may be unavailable */
  }
}

const initial = load() ?? { incidents: [], factors: {}, closures: [], seq: 1 };

export const useRealTraffic = create<RealTrafficState>()((set, get) => ({
  version: 1,
  ...initial,
  overlay: () => {
    const s = get();
    return { version: s.version, closures: [...s.closures], incidents: [...s.incidents], factors: { ...s.factors } };
  },
  addIncident: (road, dir, kind) => {
    const id = `ri${get().seq}`;
    set((s) => ({ incidents: [...s.incidents, { id, road, dir, kind }], seq: s.seq + 1, version: s.version + 1 }));
    save(get());
    return id;
  },
  removeIncident: (id) => {
    set((s) => ({ incidents: s.incidents.filter((i) => i.id !== id), version: s.version + 1 }));
    save(get());
  },
  setFactor: (road, permille) => {
    set((s) => ({ factors: { ...s.factors, [road]: permille }, version: s.version + 1 }));
    save(get());
  },
  clearFactor: (road) => {
    set((s) => {
      const factors = { ...s.factors };
      delete factors[road];
      return { factors, version: s.version + 1 };
    });
    save(get());
  },
  toggleClosure: (road) => {
    set((s) => ({
      closures: s.closures.includes(road) ? s.closures.filter((c) => c !== road) : [...s.closures, road],
      version: s.version + 1,
    }));
    save(get());
  },
  loadSnapshot: (overlay) =>
    set((s) => ({
      incidents: overlay.incidents, factors: overlay.factors, closures: overlay.closures,
      version: s.version + 1,
    })),
  clearAll: () => set((s) => ({ incidents: [], factors: {}, closures: [], version: s.version + 1 })),
}));
