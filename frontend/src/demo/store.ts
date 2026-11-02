// Smart Demo FSM store (V1). Explicit states:
// idle → preparing → prepared → running → incident → evaluating →
// awaiting_decision → resumed → completed, plus error. Reset returns to idle.
// Engine orchestration lives in the page; this store holds facts + receipts.
import { create } from 'zustand';
import type { DiversionBanner, JourneySummary, SimPosition } from '../simulation';
import type { DemoScenario } from './scenario';

export type DemoStatus =
  | 'idle' | 'preparing' | 'prepared' | 'running' | 'incident'
  | 'evaluating' | 'awaiting_decision' | 'resumed' | 'completed' | 'error';

export interface DecisionReceipt {
  overlayVersion: number;
  affectedRoads: string[];
  originalRemainingEtaS: number;
  candidateRemainingEtaS: number | null;
  policyDecision: string;
  policyReason: string;
  savingEstimateS: number | null;
  userAction: 'accept' | 'stay';
  simTimeS: number;
  atArc: string;
}

interface DemoState {
  status: DemoStatus;
  scenario: DemoScenario | null;
  planArcs: string[];
  planVertices: string[];
  objective: string;
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
  set: (p: Partial<DemoState>) => void;
  reset: () => void;
}

const INITIAL = {
  status: 'idle' as DemoStatus,
  scenario: null as DemoScenario | null,
  planArcs: [] as string[],
  planVertices: [] as string[],
  objective: 'FASTEST',
  durations: [] as number[],
  distances: [] as number[],
  plannedTimeS: 0,
  legs: {} as Record<string, { from: string; to: string }>,
  pos: { arcIdx: 0, arcId: '', fracPermille: 0, simTimeS: 0 } as SimPosition,
  speed: 60,
  banner: null as DiversionBanner | null,
  policy: {} as Record<string, unknown>,
  receipt: null as DecisionReceipt | null,
  summary: null as JourneySummary | null,
  error: '',
  injected: null as { incidentId: string; road: string } | null,
};

export const useDemo = create<DemoState>()((set, get) => ({
  ...INITIAL,
  set: (p) => set(p),
  reset: () => set({ ...INITIAL, speed: get().speed }),
}));
