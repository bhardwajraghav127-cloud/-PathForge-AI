// Yen's K shortest loopless paths on the directed multigraph.
// Purpose: genuinely distinct alternative routes (route.alternatives).
// Method: classic Yen with spur Dijkstra on banned-arc/vertex subgraphs;
//   identity and dedup by FULL arc-ID sequence (parallel roads stay distinct).
//   Root-path bans guarantee loop-free totals.
// Scalar models: cost = per-arc scalar cost; diversity = shared arc length
//   (by distanceM) <80% with every accepted path AND cost <= 1.6x best.
// LOWEST_TOLL: tuple cost; accept when toll <= 1.1x best toll AND time <= 1.6x
//   best time AND diversity (documented separate policy).
// Complexity bound: O(K * L * S) where K = candidates, L = path length,
//   S = shortest-path cost; NOT a single exact formula (spec requirement).
// Viva Q&A:
//   Q: Why ban root vertices? A: prevents cycles between root and spur.
//   Q: Why arc IDs not vertex IDs? A: parallel roads give distinct alternatives.
//   Q: K vs returned count? A: K bounds the search; diversity decides returns.
#pragma once

#include <cstdint>
#include <functional>
#include <string>
#include <vector>

#include "pathforge/graph.hpp"

namespace pathforge {

struct YenConfig {
  int maxCandidates = 10;    // internal search bound (K), hard cap 20
  int maxAlternatives = 3;   // returned distinct paths, clamped to 0..3
};

struct YenPath {
  std::vector<int> arcIdx;  // arc indices into the ORIGINAL graph
  std::int64_t scalarCost = 0;
  TollLabel tollCost{0, 0, 0};
};

// K shortest loopless paths from src to dst under costFn (scalar models).
// Returns up to K paths ordered by (cost, hops, arc-ID sequence).
std::vector<YenPath> yenKShortest(const Graph& g, int srcIdx, int dstIdx,
                                  const std::function<std::int64_t(int)>& arcCost, int K,
                                  DijkstraStats& stats);

// Tuple variant for LOWEST_TOLL.
std::vector<YenPath> yenKShortestToll(const Graph& g, int srcIdx, int dstIdx, int K,
                                      DijkstraStats& stats);

// Shared arc length (distanceM) of candidate vs accepted, over candidate total.
double sharedArcFraction(const Graph& g, const YenPath& cand, const YenPath& accepted);

}  // namespace pathforge
