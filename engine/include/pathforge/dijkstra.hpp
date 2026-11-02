// Dijkstra over the directed multigraph.
// Purpose: single-source shortest path for FASTEST (timeS) or SHORTEST (distanceM).
// Invariants: nonnegative arc costs; settled vertices never reopened; parent
//   pointers give a full source path for global lexicographic tie-breaks.
// Pseudocode: dist[]=INF,hops[]=INF,parent=-1; heap{(0,src)}; pop u; for arcs
//   in canonical order: relax with (cost,hops+1,fullPath) lexicographic compare.
// Complexity: O((V+E) log V) + O(L) per equal-cost path compare (L = path length).
// Viva Q&A:
//   Q: Preconditions? A: nonnegative weights; unreachable => found=false.
//   Q: Why not stop at first pop of target? A: we do — min-heap guarantees optimality.
//   Q: Equal-cost ties? A: fewer hops wins, then globally smallest arc-ID sequence.
#pragma once

#include "pathforge/graph.hpp"

namespace pathforge {

struct DijkstraStats {
  std::int64_t visitedVertices = 0;
  std::int64_t relaxedEdges = 0;
  std::int64_t heapOps = 0;
};

// Returns parent-arc per vertex (-1 = none/unreached), with dist/hops filled.
std::vector<int> dijkstra(const Graph& g, int srcIdx, CostModel model,
                          std::vector<std::int64_t>& dist, std::vector<int>& hops,
                          DijkstraStats& stats);

RouteResult buildRoute(const Graph& g, int srcIdx, int dstIdx, CostModel model,
                       const std::vector<int>& parentArc, const std::vector<std::int64_t>& dist,
                       const DijkstraStats& stats, const std::string& objectiveDescription);

}  // namespace pathforge
