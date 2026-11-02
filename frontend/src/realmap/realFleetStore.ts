// Real fleet store (R5): per-vehicle snapshots + priority/SLA + receipts.
// Priority is real: high-priority vehicles run diversion checks every 60
// simulated seconds vs 180 for normal. SLA is in-simulation semantics:
// deadline = 1.5x engine-planned time; status from projected completion.
import { create } from 'zustand';

export type RealFleetStatus = 'idle' | 'starting' | 'running' | 'paused' | 'completed' | 'error';
export type RealVehicleStatus = 'planned' | 'enroute' | 'awaiting' | 'blocked' | 'completed' | 'error';
export type VehiclePriority = 'normal' | 'high';
export type SlaStatus = 'on-time' | 'at-risk' | 'met' | 'missed';

export interface RealVehicleDecision {
  decision: string;
  reason: string;
  savingS: number | null;
  currentEtaS: number;
  candidateEtaS: number | null;
  candidateArcs: string[];
}

export interface RealVehicleSnap {
  id: string;
  label: string;
  color: string;
  origin: string;
  originName: string;
  destination: string;
  destinationName: string;
  priority: VehiclePriority;
  status: RealVehicleStatus;
  planArcs: string[];
  planVertices: string[];
  distances: number[];
  durations: number[];
  arcIdx: number;
  fracPermille: number;
  simTimeS: number;
  remainingS: number;
  remainingM: number;
  progress: number;
  affected: string[];
  decision: RealVehicleDecision | null;
  reroutes: number;
  savedEstimateS: number;
  slaDeadlineS: number;
  sla: SlaStatus;
  error: string;
  lastReceipt: {
    overlayVersion: number;
    userAction: 'accept' | 'stay';
    policyDecision: string;
    policyReason: string;
    savingEstimateS: number | null;
    simTimeS: number;
  } | null;
}

export interface RealFleetEvent {
  seq: number;
  fleetSimS: number;
  vehicleId: string | null;
  text: string;
}

export interface RealFleetPair {
  label: string;
  origin: string;
  originName: string;
  destination: string;
  destinationName: string;
}

interface RealFleetState {
  status: RealFleetStatus;
  speed: number;
  order: string[];
  vehicles: Record<string, RealVehicleSnap>;
  selectedId: string | null;
  error: string;
  events: FleetEventAlias;
  seq: number;
  set: (p: Partial<RealFleetState>) => void;
  reset: () => void;
  upsertVehicle: (v: RealVehicleSnap) => void;
  patchVehicle: (id: string, p: Partial<RealVehicleSnap>) => void;
  removeVehicle: (id: string) => void;
  pushEvent: (fleetSimS: number, vehicleId: string | null, text: string) => void;
}

type FleetEventAlias = RealFleetEvent[];

export const REAL_FLEET_SPEEDS = [1, 5, 10, 30, 60];
export const REAL_COLORS = ['#0b5fff', '#b3540a', '#0f6b4a', '#7a1f1a', '#6a4d00', '#5b5bd6', '#0e7c86', '#a12178'];

export const REAL_DEFAULTS: RealFleetPair[] = [
  { label: 'CP → Central Vista', origin: 'n1191294765', originName: 'Connaught Place', destination: 'n6666318646', destinationName: 'Central Vista' },
  { label: 'Paharganj → Daryaganj', origin: 'n1349091990', originName: 'Paharganj', destination: 'n2722854281', destinationName: 'Daryaganj' },
  { label: 'Sunder Nagar → Daryaganj', origin: 'n1803593387', originName: 'Sunder Nagar', destination: 'n2722854281', destinationName: 'Daryaganj' },
  { label: 'Daryaganj → Paharganj', origin: 'n2722854281', originName: 'Daryaganj', destination: 'n1349091990', destinationName: 'Paharganj' },
  { label: 'Central Vista → CP', origin: 'n6666318646', originName: 'Central Vista', destination: 'n1191294765', destinationName: 'Connaught Place' },
];

export function blankRealVehicle(id: string, color: string, pair: RealFleetPair): RealVehicleSnap {
  return {
    id, label: pair.label, color,
    origin: pair.origin, originName: pair.originName,
    destination: pair.destination, destinationName: pair.destinationName,
    priority: 'normal', status: 'planned',
    planArcs: [], planVertices: [], distances: [], durations: [],
    arcIdx: 0, fracPermille: 0, simTimeS: 0,
    remainingS: 0, remainingM: 0, progress: 0,
    affected: [], decision: null, reroutes: 0, savedEstimateS: 0,
    slaDeadlineS: 0, sla: 'on-time', error: '', lastReceipt: null,
  };
}

export const useRealFleet = create<RealFleetState>()((set, get) => ({
  status: 'idle',
  speed: 10,
  order: [],
  vehicles: {},
  selectedId: null,
  error: '',
  events: [],
  seq: 1,
  set: (p) => set(p),
  reset: () => set({
    status: 'idle', order: [], vehicles: {}, selectedId: null,
    error: '', events: [], seq: 1, speed: get().speed,
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
