// Zustand stores: settings, network, route (M6).
// Stores hold engine-returned facts only; no pathfinding lives here.
import { create } from 'zustand';
import { DATASET } from './data/dataset';

export type Theme = 'light' | 'dark';
export type RoutePhase = 'idle' | 'calculating' | 'found' | 'unreachable' | 'error';

export interface RouteArc {
  arcId: string;
  roadId: string;
  from: string;
  to: string;
}
export interface RouteFacts {
  found: boolean;
  reason: string;
  arcs: RouteArc[];
  vertices: string[];
  distanceM: number;
  baselineTimeS: number;
  timeS: number;
  delayS: number;
  tollInr: number;
  objectiveCost: number;
  objectiveDescription: string;
}

interface SettingsState {
  theme: Theme;
  toggleTheme: () => void;
}
function loadTheme(): Theme {
  try {
    const v = localStorage.getItem('pf-theme');
    return v === 'dark' || v === 'light' ? v : 'light';
  } catch {
    return 'light';
  }
}
export const useSettings = create<SettingsState>()((set) => ({
  theme: typeof localStorage === 'undefined' ? 'light' : loadTheme(),
  toggleTheme: () =>
    set((s) => {
      const theme: Theme = s.theme === 'light' ? 'dark' : 'light';
      try {
        localStorage.setItem('pf-theme', theme);
      } catch {
        /* storage may be unavailable; theme still applies */
      }
      return { theme };
    }),
}));

interface NetworkState {
  vertexCount: number;
  roadCount: number;
}
export const useNetwork = create<NetworkState>()(() => ({
  vertexCount: DATASET.vertices.length,
  roadCount: DATASET.roads.length,
}));

export interface AltRoute extends RouteFacts {
  altId: string;
}
export interface CompareDelta {
  id: string;
  timeDeltaS: number | null;
  distanceDeltaM: number | null;
  tollDeltaInr: number | null;
  uniqueArcs: string[];
  incidentIds: string[];
}

export interface PlannerInputs { source: string; target: string; objective: string }

interface RouteState {
  phase: RoutePhase;
  params: { source: string; target: string; objective: string } | null;
  planner: PlannerInputs;
  setPlanner: (p: Partial<PlannerInputs>) => void;
  facts: RouteFacts | null;
  error: string;
  alternatives: AltRoute[];
  comparison: CompareDelta[];
  sharedArcs: string[];
  selectedAlt: string | null;
  begin: (params: { source: string; target: string; objective: string }) => void;
  succeed: (facts: RouteFacts) => void;
  fail: (error: string) => void;
  setExtras: (alts: AltRoute[], comparison: CompareDelta[], sharedArcs: string[]) => void;
  selectAlt: (altId: string | null) => void;
  reset: () => void;
}
export const useRoute = create<RouteState>()((set) => ({
  phase: 'idle',
  params: null,
  planner: { source: 'chandigarh', target: 'delhi', objective: 'FASTEST' },
  setPlanner: (p) => set((s) => ({ planner: { ...s.planner, ...p } })),
  facts: null,
  error: '',
  alternatives: [],
  comparison: [],
  sharedArcs: [],
  selectedAlt: null,
  begin: (params) =>
    set({ phase: 'calculating', params, facts: null, error: '', alternatives: [], comparison: [], sharedArcs: [], selectedAlt: null }),
  succeed: (facts) =>
    set({ phase: facts.found ? 'found' : 'unreachable', facts, error: facts.reason }),
  fail: (error) => set({ phase: 'error', facts: null, error }),
  setExtras: (alternatives, comparison, sharedArcs) => set({ alternatives, comparison, sharedArcs }),
  selectAlt: (selectedAlt) => set({ selectedAlt }),
  reset: () =>
    set({ phase: 'idle', params: null, facts: null, error: '', alternatives: [], comparison: [], sharedArcs: [], selectedAlt: null }),
}));
