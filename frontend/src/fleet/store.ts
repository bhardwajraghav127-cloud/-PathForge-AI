// Fleet Command Center store (V3). Render snapshots only; per-frame motion
// lives in page-local mutable state and mirrors here at ~5 Hz. Each vehicle
// keeps an independent clock/route/policy; the traffic overlay is shared.
import { create } from 'zustand';

export type FleetStatus = 'idle' | 'starting' | 'running' | 'paused' | 'completed' | 'error';
export type VehicleStatus = 'planned' | 'enroute' | 'awaiting' | 'blocked' | 'completed' | 'error';

export interface VehicleDecision {
  decision: string;
  reason: string;
  savingS: number | null;
  currentEtaS: number;
  candidateEtaS: number | null;
  candidateArcs: string[];
}

export interface VehicleHistoryEntry {
  t: number;
  kind: 'plan' | 'incident' | 'accept' | 'stay' | 'blocked' | 'done' | 'error';
  text: string;
}

export interface FleetVehicleSnap {
  id: string;
  label: string;
  color: string;
  origin: string;
  destination: string;
  objective: string;
  status: VehicleStatus;
  planArcs: string[];
  planVertices: string[];
  distances: number[];
  durations: number[];
  arcIdx: number;
  fracPermille: number;
  simTimeS: number;
  currentRoad: string | null;
  remainingS: number;
  remainingM: number;
  progress: number;
  affected: string[];
  decision: VehicleDecision | null;
  history: VehicleHistoryEntry[];
  reroutes: number;
  savedEstimateS: number;
  error: string;
}

export interface FleetEvent {
  seq: number;
  fleetSimS: number;
  vehicleId: string | null;
  text: string;
}

export interface FleetPair {
  origin: string;
  destination: string;
  objective: string;
}

interface FleetState {
  status: FleetStatus;
  speed: number;
  order: string[];
  vehicles: Record<string, FleetVehicleSnap>;
  selectedId: string | null;
  showMode: 'selected' | 'all';
  error: string;
  events: FleetEvent[];
  seq: number;
  set: (p: Partial<FleetState>) => void;
  reset: () => void;
  upsertVehicle: (v: FleetVehicleSnap) => void;
  patchVehicle: (id: string, p: Partial<FleetVehicleSnap>) => void;
  removeVehicle: (id: string) => void;
  pushEvent: (fleetSimS: number, vehicleId: string | null, text: string) => void;
}

export const FLEET_SPEEDS = [60, 600, 1800, 3600];

export const VEHICLE_COLORS = ['#0b5fff', '#b3540a', '#0f6b4a', '#7a1f1a', '#6a4d00', '#5b5bd6', '#0e7c86', '#a12178', '#3f6212', '#44403c'];

export function blankVehicle(id: string, label: string, color: string, pair: FleetPair): FleetVehicleSnap {
  return {
    id, label, color, origin: pair.origin, destination: pair.destination,
    objective: pair.objective, status: 'planned',
    planArcs: [], planVertices: [], distances: [], durations: [],
    arcIdx: 0, fracPermille: 0, simTimeS: 0,
    currentRoad: null, remainingS: 0, remainingM: 0, progress: 0,
    affected: [], decision: null, history: [], reroutes: 0, savedEstimateS: 0, error: '',
  };
}

export const useFleet = create<FleetState>()((set, get) => ({
  status: 'idle',
  speed: 600,
  order: [],
  vehicles: {},
  selectedId: null,
  showMode: 'selected',
  error: '',
  events: [],
  seq: 1,
  set: (p) => set(p),
  reset: () => set({
    status: 'idle', order: [], vehicles: {}, selectedId: null,
    showMode: 'selected', error: '', events: [], seq: 1, speed: get().speed,
  }),
  upsertVehicle: (v) =>
    set((s) => ({
      vehicles: { ...s.vehicles, [v.id]: v },
      order: s.order.includes(v.id) ? s.order : [...s.order, v.id],
      selectedId: s.selectedId ?? v.id,
    })),
  patchVehicle: (id, p) =>
    set((s) => (s.vehicles[id] ? { vehicles: { ...s.vehicles, [id]: { ...s.vehicles[id]!, ...p } } } : {})),
  removeVehicle: (id) =>
    set((s) => {
      const vehicles = { ...s.vehicles };
      delete vehicles[id];
      const order = s.order.filter((x) => x !== id);
      return {
        vehicles, order,
        selectedId: s.selectedId === id ? (order[0] ?? null) : s.selectedId,
      };
    }),
  pushEvent: (fleetSimS, vehicleId, text) =>
    set((s) => ({
      events: [...s.events.slice(-199), { seq: s.seq, fleetSimS: Math.floor(fleetSimS), vehicleId, text }],
      seq: s.seq + 1,
    })),
}));
