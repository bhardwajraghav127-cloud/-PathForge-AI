// Real demo FSM store (R4): same explicit states as the sim demo.
// idle → preparing → prepared → running → incident → evaluating →
// awaiting_decision → resumed → completed, plus error.
import { create } from 'zustand';
import type { DiversionBanner, JourneySummary, SimPosition } from '../simulation';
import type { DecisionReceipt } from '../demo/store';
import type { RealDemoScenario } from './realScenario';

export type RealDemoStatus =
  | 'idle' | 'preparing' | 'prepared' | 'running' | 'incident'
  | 'evaluating' | 'awaiting_decision' | 'resumed' | 'completed' | 'error';

interface RealDemoState {
  status: RealDemoStatus;
  scenario: RealDemoScenario | null;
  planArcs: string[];
  planVertices: string[];
  durations: number[];
  distances: number[];
  plannedTimeS: number;
  legs: Record<string, { from: string; to: string }>;
  pos: SimPosition;
  speed: number;
  banner: DiversionBanner | null;
  policy: Record<string, unknown>;
  receipt: DecisionReceipt | null;
  summary: JourneySummary | null;
  error: string;
  injected: { incidentId: string; road: string } | null;
  set: (p: Partial<RealDemoState>) => void;
  reset: () => void;
}

const INITIAL = {
  status: 'idle' as RealDemoStatus,
  scenario: null as RealDemoScenario | null,
  planArcs: [] as string[],
  planVertices: [] as string[],
  durations: [] as number[],
  distances: [] as number[],
  plannedTimeS: 0,
  legs: {} as Record<string, { from: string; to: string }>,
  pos: { arcIdx: 0, arcId: '', fracPermille: 0, simTimeS: 0 } as SimPosition,
  speed: 10,
  banner: null as DiversionBanner | null,
  policy: {} as Record<string, unknown>,
  receipt: null as DecisionReceipt | null,
  summary: null as JourneySummary | null,
  error: '',
  injected: null as { incidentId: string; road: string } | null,
};

export const useRealDemo = create<RealDemoState>()((set, get) => ({
  ...INITIAL,
  set: (p) => set(p),
  reset: () => set({ ...INITIAL, speed: get().speed }),
}));
