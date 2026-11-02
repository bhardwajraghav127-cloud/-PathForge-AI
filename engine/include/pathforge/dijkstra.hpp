// Dijkstra over the directed multigraph.
// Purpose: single-source shortest path for scalar objectives (FASTEST timeS,
//   SHORTEST distanceM, AVOID_CONGESTION penalized time, BALANCED fixed-point).
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

#include <functional>
#include <vector>

#include "pathforge/graph.hpp"

namespace pathforge {

// (DijkstraStats lives in types.hpp; includes traceTruncated for lab traces.)

// Returns parent-arc per vertex (-1 = none/unreached), with dist/hops filled.
std::vector<int> dijkstra(const Graph& g, int srcIdx, CostModel model,
                          std::vector<std::int64_t>& dist, std::vector<int>& hops,
                          DijkstraStats& stats);

// Shared full-path tie-break (source-first arc-ID lexicographic). Used by
// Dijkstra, lexicographic Dijkstra and A* so all agree on equal-cost paths.
bool pathLess(const Graph& g, const std::vector<int>& parent, int u, int candArc);

// Generic scalar variant: arcCost(ai) gives the nonnegative per-arc cost,
// kInf64 bars the arc. Same ordering guarantees as dijkstra().
// Optional trace sink records real settle/relax events (capped at maxEvents).
std::vector<int> dijkstraScalar(const Graph& g, int srcIdx,
                                const std::function<std::int64_t(int)>& arcCost,
                                std::vector<std::int64_t>& dist, std::vector<int>& hops,
                                DijkstraStats& stats, std::vector<TraceEvent>* trace = nullptr,
                                std::int64_t maxEvents = 20000, std::int64_t initialDist = 0);

// Lexicographic Dijkstra for LOWEST_TOLL labels (toll, time, distance).
// Label-setting is valid: lex order is preserved under componentwise-nonnegative
// addition. Lazy heap (no indexed decrease-key); stale entries skipped.
std::vector<int> dijkstraToll(const Graph& g, int srcIdx, std::vector<TollLabel>& dist,
                              std::vector<int>& hops, DijkstraStats& stats,
                              TollLabel initial = {0, 0, 0});

RouteResult buildRoute(const Graph& g, int srcIdx, int dstIdx, CostModel model,
                       const std::vector<int>& parentArc, const std::vector<std::int64_t>& dist,
                       const DijkstraStats& stats, const std::string& objectiveDescription);

// Tuple variant for LOWEST_TOLL (fills objectiveTuple).
RouteResult buildRouteToll(const Graph& g, int srcIdx, int dstIdx,
                           const std::vector<int>& parentArc, const std::vector<TollLabel>& dist,
                           const DijkstraStats& stats, const std::string& objectiveDescription);

}  // namespace pathforge
