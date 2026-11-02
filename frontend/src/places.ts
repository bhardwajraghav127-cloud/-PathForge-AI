// My Places: saved origin/destination pairs (U4), validated localStorage.
import { create } from 'zustand';

export interface Place { id: string; name: string; source: string; target: string }

const KEY = 'pf-places';

function load(): Place[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter(
      (p): p is Place =>
        typeof p === 'object' && p !== null &&
        typeof (p as Place).id === 'string' &&
        typeof (p as Place).name === 'string' &&
        typeof (p as Place).source === 'string' &&
        typeof (p as Place).target === 'string',
    );
  } catch {
    return [];
  }
}

interface PlaceState {
  places: Place[];
  save: (name: string, source: string, target: string) => void;
  remove: (id: string) => void;
}

export const usePlaces = create<PlaceState>()((set) => ({
  places: typeof localStorage === 'undefined' ? [] : load(),
  save: (name, source, target) =>
    set((s) => {
      const places = [...s.places, { id: `pl${Date.now().toString(36)}`, name, source, target }];
      try {
        localStorage.setItem(KEY, JSON.stringify(places));
      } catch {
        /* storage may be unavailable */
      }
      return { places };
    }),
  remove: (id) =>
    set((s) => {
      const places = s.places.filter((p) => p.id !== id);
      try {
        localStorage.setItem(KEY, JSON.stringify(places));
      } catch {
        /* ignore */
      }
      return { places };
    }),
}));
