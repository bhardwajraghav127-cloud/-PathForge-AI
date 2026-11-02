// Saved tours (U6): stop lists with start/end pins, validated localStorage.
import { create } from 'zustand';

export interface Tour { id: string; name: string; stops: string[]; start: string; end: string }

const KEY = 'pf-tours';

function load(): Tour[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter(
      (t): t is Tour =>
        typeof t === 'object' && t !== null &&
        typeof (t as Tour).id === 'string' &&
        typeof (t as Tour).name === 'string' &&
        Array.isArray((t as Tour).stops) &&
        typeof (t as Tour).start === 'string' &&
        typeof (t as Tour).end === 'string',
    );
  } catch {
    return [];
  }
}

interface TourState {
  tours: Tour[];
  save: (name: string, stops: string[], start: string, end: string) => void;
  remove: (id: string) => void;
}

export const useTours = create<TourState>()((set) => ({
  tours: typeof localStorage === 'undefined' ? [] : load(),
  save: (name, stops, start, end) =>
    set((s) => {
      const tours = [...s.tours, { id: `t${Date.now().toString(36)}`, name, stops, start, end }];
      try {
        localStorage.setItem(KEY, JSON.stringify(tours));
      } catch {
        /* storage may be unavailable */
      }
      return { tours };
    }),
  remove: (id) =>
    set((s) => {
      const tours = s.tours.filter((t) => t.id !== id);
      try {
        localStorage.setItem(KEY, JSON.stringify(tours));
      } catch {
        /* ignore */
      }
      return { tours };
    }),
}));
