// Professor/Viva Mode card (V5). Static, truthful DSA notes tied to the
// current feature: what algorithm runs, where it lives in C++, and its
// complexity. Shown only when viva mode is enabled in Settings.
import { useSettings } from '../store';

const FACTS: Record<string, { title: string; points: string[]; sources: string[]; complexity: string }> = {
  demo: {
    title: 'Smart Demo DSA notes',
    points: [
      'Route planned by Dijkstra over directed arcs; weights are effective seconds under the traffic overlay.',
      'The incident response is the stateless diversion policy: same inputs always give the same decision.',
      'Accept adopts the engine-returned plan at the frozen position — continuity is structural, not animated.',
    ],
    sources: ['engine/src/dijkstra.cpp', 'engine/src/diversion.cpp', 'engine/src/objectives.cpp'],
    complexity: 'Dijkstra O((V+E) log V) with a binary heap; diversion is one Dijkstra + one plan evaluation.',
  },
  fleet: {
    title: 'Fleet DSA notes',
    points: [
      'Each vehicle is an independent Dijkstra query against one shared overlay; no cross-vehicle state.',
      'A closure affects only vehicles whose future plan contains that directed road — decided per vehicle.',
      'Fleet KPIs are sums over per-vehicle engine facts; reroute counts increment once per accept.',
    ],
    sources: ['engine/src/dijkstra.cpp', 'engine/src/diversion.cpp'],
    complexity: 'N vehicles cost N Dijkstra runs on events only — never per animation frame.',
  },
  route: {
    title: 'Route Planner DSA notes',
    points: [
      'Best route: Dijkstra. Ranked alternates: Yen K-shortest-paths over the same engine weights.',
      'Objectives (fastest/shortest/toll/…) only change arc weights; the search is identical.',
      'Closures remove arcs; congestion scales weights. Both are overlay inputs, not graph edits.',
    ],
    sources: ['engine/src/dijkstra.cpp', 'engine/src/yen.cpp', 'engine/src/objectives.cpp'],
    complexity: 'Dijkstra O((V+E) log V); Yen is K Dijkstra runs plus deviation handling.',
  },
  journey: {
    title: 'Journey DSA notes',
    points: [
      'Arc durations come from per-arc route.evaluate calls, not interpolation.',
      'Diversion checks reuse the stateless policy with cooldowns and dismissal signatures.',
      'Accept validates overlay version + position fingerprint; stale accepts fail safe.',
    ],
    sources: ['engine/src/diversion.cpp', 'engine/src/position.cpp'],
    complexity: 'Checks are O(plan) evaluation + one Dijkstra; motion itself is O(1) per frame.',
  },
  multistop: {
    title: 'Multi-Stop DSA notes',
    points: [
      'Legs are engine shortest paths; ordering is a heuristic over the leg matrix.',
      'Tours persist locally; optimization always re-queries the engine.',
    ],
    sources: ['engine/src/multistop.cpp', 'engine/src/dijkstra.cpp'],
    complexity: 'Leg matrix is O(stops²) Dijkstra runs; ordering heuristic is polynomial.',
  },
  scenarios: {
    title: 'Scenarios DSA notes',
    points: [
      'Each snapshot replays the identical route query under a different overlay version.',
      'Deltas are arithmetic on engine facts — the engine never sees the comparison.',
    ],
    sources: ['engine/src/engine.cpp'],
    complexity: 'One Dijkstra per snapshot; comparison is linear in plan length.',
  },
  lab: {
    title: 'Algorithm Lab DSA notes',
    points: [
      'BFS/DFS/Dijkstra/A* traces are authentic engine events: visit, discover, relax, select.',
      'A* needs an admissible heuristic to stay optimal; MST shows Prim vs Kruskal agreement.',
      'This is an algorithmic decision-support system — classical algorithms, no ML claims.',
    ],
    sources: ['engine/src/traversal.cpp', 'engine/src/astar.cpp', 'engine/src/lab.cpp', 'engine/src/prim.cpp', 'engine/src/kruskal.cpp'],
    complexity: 'BFS/DFS O(V+E); Dijkstra O((V+E) log V); Kruskal O(E log E).',
  },
};

export default function VivaCard({ page }: { page: keyof typeof FACTS }) {
  const viva = useSettings((s) => s.viva);
  if (!viva) return null;
  const f = FACTS[page];
  if (!f) return null;
  return (
    <section className="pf-card" aria-label="Viva notes" data-testid="viva-card">
      <h2>Professor notes: {f.title}</h2>
      <ul>
        {f.points.map((pt, i) => (
          <li key={i}>{pt}</li>
        ))}
      </ul>
      <p className="pf-meta" data-testid="viva-sources">Sources: {f.sources.join(', ')}</p>
      <p className="pf-meta" data-testid="viva-complexity">Complexity: {f.complexity}</p>
    </section>
  );
}
