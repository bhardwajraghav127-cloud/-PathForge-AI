// Journey simulation store (M8). The engine decides (diversion.evaluate,
// route.evaluate); this store holds simulator state plus the stateless-engine
// policy object and the persisted decision history. No ETA math lives here.
import { create } from 'zustand';

export type JourneyStatus = 'idle' | 'starting' | 'running' | 'paused' | 'completed' | 'error';

export interface SimPosition {
  arcIdx: number;
  arcId: string;
  fracPermille: number;
  simTimeS: number;
}

export interface DiversionBanner {
  decision: string;
  reason: string;
  savingS: number | null;
  currentEtaS: number;
  candidateEtaS: number | null;
  candidateArcs: string[];
  frozen: SimPosition;
  overlayVersion: number;
}

export interface DecisionRecord {
  kind: 'stay' | 'accept';
  simTimeS: number;
  detail: string;
  arcId?: string;
  fracPermille?: number;
}

export interface JourneySummary {
  origin: string;
  destination: string;
  objective: string;
  plannedTimeS: number;
  actualSimTimeS: number;
  distanceM: number;
  arcsTraversed: number;
  diversionsAccepted: number;
  stays: number;
  status: string;
}

const HISTORY_KEY = 'pf-decision-history';

function loadHistory(): DecisionRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter(
      (r): r is DecisionRecord =>
        typeof r === 'object' && r !== null &&
        ((r as DecisionRecord).kind === 'stay' || (r as DecisionRecord).kind === 'accept') &&
        typeof (r as DecisionRecord).simTimeS === 'number' &&
        typeof (r as DecisionRecord).detail === 'string',
    );
  } catch {
    return [];
  }
}

interface SimState {
  status: JourneyStatus;
  planArcs: string[];
  planVertices: string[];
  objective: string;
  durations: number[];
  distances: number[];
  plannedTimeS: number;
  pos: SimPosition;
  speed: number;
  banner: DiversionBanner | null;
  guidance: string;
  policy: Record<string, unknown>;
  history: DecisionRecord[];
  summary: JourneySummary | null;
  error: string;
  legs: Record<string, { from: string; to: string }>;
  set: (p: Partial<SimState>) => void;
  record: (d: DecisionRecord) => void;
  clearHistory: () => void;
}

export const SPEEDS = [1, 10, 60, 600];

export const useSim = create<SimState>()((set) => ({
  status: 'idle',
  planArcs: [],
  planVertices: [],
  objective: 'FASTEST',
  durations: [],
  plannedTimeS: 0,
  pos: { arcIdx: 0, arcId: '', fracPermille: 0, simTimeS: 0 },
  distances: [],
  speed: 60,
  banner: null,
  guidance: '',
  policy: {},
  history: typeof localStorage === 'undefined' ? [] : loadHistory(),
  summary: null,
  error: '',
  legs: {},
  set: (p) => set(p),
  record: (d) =>
    set((s) => {
      const history = [...s.history, d];
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      } catch {
        /* storage may be unavailable */
      }
      return { history };
    }),
  clearHistory: () => {
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      /* ignore */
    }
    set({ history: [] });
  },
}));
