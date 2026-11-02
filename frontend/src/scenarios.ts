// Saved what-if traffic snapshots (M9). Snapshots are deep copies persisted
// to localStorage with validation; later traffic edits never mutate them.
import { create } from 'zustand';
import type { OverlayPayload } from './traffic';

export interface SavedScenario {
  id: string;
  name: string;
  savedAt: string;
  overlay: OverlayPayload;
}

const KEY = 'pf-scenarios';

function load(): SavedScenario[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter(
      (s): s is SavedScenario =>
        typeof s === 'object' && s !== null &&
        typeof (s as SavedScenario).id === 'string' &&
        typeof (s as SavedScenario).name === 'string' &&
        typeof (s as SavedScenario).overlay === 'object',
    );
  } catch {
    return [];
  }
}

function persist(scenarios: SavedScenario[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(scenarios));
  } catch {
    /* storage may be unavailable */
  }
}

interface ScenarioState {
  scenarios: SavedScenario[];
  save: (name: string, overlay: OverlayPayload) => string;
  remove: (id: string) => void;
}

export const useScenarios = create<ScenarioState>()((set) => ({
  scenarios: typeof localStorage === 'undefined' ? [] : load(),
  save: (name, overlay) => {
    const id = `scn${Date.now().toString(36)}`;
    const snap: SavedScenario = {
      id, name,
      savedAt: new Date().toISOString(),
      overlay: JSON.parse(JSON.stringify(overlay)) as OverlayPayload,
    };
    set((s) => {
      const scenarios = [...s.scenarios, snap];
      persist(scenarios);
      return { scenarios };
    });
    return id;
  },
  remove: (id) =>
    set((s) => {
      const scenarios = s.scenarios.filter((x) => x.id !== id);
      persist(scenarios);
      return { scenarios };
    }),
}));
