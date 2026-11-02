// Multi-stop optimizer: exact Held-Karp (≤10, ≤12 opt-in) + NN/2-opt heuristic.
// Purpose: visit order over directed asymmetric closure costs (engine Dijkstra
//   per stop pair), with per-leg genuine routes.
// Rules: start fixed (default stops[0]); end fixed when given, else free;
//   exactUpTo default 10, hard cap 12 (explicit opt-in); beyond that the
//   deterministic NN + first-improvement 2-opt heuristic (no RNG);
//   exactUpTo > 12, empty stops, duplicates, or unknown stops are rejected;
//   stops > 64 are rejected (heuristic bound).
// Held-Karp ties break toward the lexicographically smallest stop-id sequence
//   (documented, tested). 2-opt moves apply in canonical (i,j) order.
// Complexity: closure O(S·(E log V)); exact O(S²·2^S); heuristic O(S³) bounded.
// Viva Q&A:
//   Q: Why asymmetric? A: one-ways and traffic make s→t differ from t→s.
//   Q: Exact vs heuristic flag? A: every response states optimal + method.
//   Q: Why NN then 2-opt? A: fast construction + local repair, deterministic.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "pathforge/graph.hpp"

namespace pathforge {

struct MultistopLeg {
  std::string from;
  std::string to;
  RouteResult route;
};

struct MultistopResult {
  bool ok = false;  // false => unreachable pair (UNREACHABLE), not a bug
  std::string reason;
  std::vector<std::string> order;  // stop ids in visit order
  std::vector<MultistopLeg> legs;
  std::int64_t totalTimeS = 0;
  std::int64_t totalDistanceM = 0;
  std::int64_t totalTollInr = 0;
  bool optimal = false;
  std::string method;  // "held-karp" | "nn-2opt"
  std::string error;   // envelope-level error code when invalid input
  std::string errorDetail;
};

// stopIdx: vertex indices in user-given order. startPos/endPos index into
// stopIdx (endPos -1 = free end).
MultistopResult multistop(const Graph& g, const std::vector<int>& stopIdx, int startPos,
                          int endPos, int exactUpTo, bool allowHeuristic);

}  // namespace pathforge
