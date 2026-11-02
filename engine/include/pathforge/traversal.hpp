// BFS (queue) and iterative DFS (explicit stack) with C++-owned traces.
// Purpose: unweighted traversal + reachability oracle; traces feed lab.run.
// Invariants: canonical adjacency order; DFS pushes neighbors in reverse so
//   pop order matches canonical order; parents form a traversal tree.
// Pseudocode BFS: dist[]=INF; q={s}; while q: u=pop; emit visit; for arcs:
//   undiscovered v => dist+1, parent, emit discover, push.
// Pseudocode DFS: stack={s}; while stack: u=pop; if seen skip; emit visit;
//   push undiscovered neighbors reversed, each emit discover.
// Complexity: O(V+E) time, O(V) memory; trace O(events) capped by caller.
// Viva Q&A:
//   Q: Queue vs stack effect? A: queue = level order (shortest hops); stack = depth-first.
//   Q: Why iterative DFS? A: no recursion-depth risk on large graphs.
//   Q: BFS vs Dijkstra relationship? A: BFS = Dijkstra with unit weights (tested).
#pragma once

#include <string>
#include <vector>

#include "pathforge/graph.hpp"

namespace pathforge {

struct TraversalResult {
  std::vector<std::string> order;  // visit order (vertex ids)
  std::vector<int> parent;         // parent vertex idx (-1 root/unreached)
  std::vector<std::int64_t> dist;  // BFS: hops; DFS: -1 (no distances)
  std::vector<TraceEvent> trace;
  bool truncated = false;
};

TraversalResult bfs(const Graph& g, int srcIdx, std::int64_t maxEvents = 20000);
TraversalResult dfs(const Graph& g, int srcIdx, std::int64_t maxEvents = 20000);

}  // namespace pathforge
