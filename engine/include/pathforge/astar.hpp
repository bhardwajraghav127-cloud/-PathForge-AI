// A* with admissible haversine heuristics.
// Purpose: optimal shortest path with fewer expansions than Dijkstra when the
//   geographic bound is informative.
// Heuristics (integer floors = lower bounds):
//   SHORTEST: h = floor(haversineM(u,target)).
//   FASTEST:  h = floor(havM * minMsPerM / 1000), minMsPerM = min over usable
//     arcs with distanceM>0 of floor(baselineTimeS*1000/distanceM). If any usable
//     arc has distanceM>0 with baselineTimeS==0, physical speed is unbounded
//     and h=0 for all vertices (documented, warned).
//   Other objectives: h=0 (Dijkstra-equivalent), warning HEURISTIC_ZERO.
// Admissibility gate: every usable arc must satisfy distanceM >= haversine - tol
//   (tol = max(100m, 1% of hav)); else HEURISTIC_INADMISSIBLE and no route.
//   h is consistent (haversine obeys triangle inequality; scaling preserves it),
//   so first pop of target is optimal. Pop order (f, g, vertexIdx) + global
//   path tie-break on equal (f, g, hops) keeps determinism.
// Pseudocode: g[]=INF; open={(h(s),s)}; pop u; if u==t done; for arcs:
//   relax g with f-ordered lazy heap; equal (f,g,hops) => path compare.
// Complexity: O((V+E) log V) worst case; best case explores toward target.
// Viva Q&A:
//   Q: When does A* equal Dijkstra? A: h=0 everywhere (non-geographic costs).
//   Q: Why floor? A: ceil could overestimate => inadmissible.
//   Q: What breaks admissibility? A: road shorter than straight-line distance.
#pragma once

#include <string>
#include <vector>

#include "pathforge/graph.hpp"

namespace pathforge {

struct AStarOutcome {
  bool ok = false;  // false => inadmissible (HEURISTIC_INADMISSIBLE)
  std::string detail;
  std::vector<int> parent;
  std::vector<std::int64_t> dist;  // g-scores
  std::vector<int> hops;
  DijkstraStats stats;
  bool heuristicZero = false;
  std::int64_t expandedVertices = 0;
  std::vector<TraceEvent> trace;
};

AStarOutcome astar(const Graph& g, int srcIdx, int dstIdx, CostModel model,
                   std::int64_t maxEvents = 20000, std::int64_t initialG = 0);

// Haversine great-circle metres between coordinates.
double haversineM(double lat1, double lon1, double lat2, double lon2);

}  // namespace pathforge
