// Typed dataset access (M6). The JSON is vendored from
// datasets/sample-networks/north-india-sim-v1.json. No routing math here.
import raw from '../data/north-india-sim-v1.json';

export interface DatasetVertex {
  id: string;
  name: string;
  lat: number;
  lon: number;
}
export interface DatasetRoad {
  id: string;
  from: string;
  to: string;
  oneWay: boolean;
  distanceM: number;
  baselineTimeS: number;
  refSpeedKph: number;
  tollInr: number;
  roadType: string;
  name: string;
  available: boolean;
}
export interface Dataset {
  schemaVersion: number;
  vertices: DatasetVertex[];
  roads: DatasetRoad[];
}

const data = raw as unknown as Dataset;
if (data.schemaVersion !== 1 || !Array.isArray(data.vertices) || !Array.isArray(data.roads)) {
  throw new Error('DATASET_SCHEMA: vendored network failed validation');
}

export const DATASET: Dataset = data;
export const VERTICES: DatasetVertex[] = data.vertices;
export const ROADS: DatasetRoad[] = data.roads;

export function vertexName(id: string): string {
  return VERTICES.find((v) => v.id === id)?.name ?? id;
}

/** Payload the engine accepts as `network` for route commands. */
export function networkPayload(): Dataset {
  return DATASET;
}

export function formatMetres(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}
export function formatSeconds(s: number): string {
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
export function formatInr(n: number): string {
  return `₹${n}`;
}
