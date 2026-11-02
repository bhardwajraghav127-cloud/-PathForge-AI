// Objective cost models over arc effective costs.
// Purpose: scalar per-arc costs for FASTEST/SHORTEST/AVOID_CONGESTION/BALANCED,
//   plus the 3-tuple label for LOWEST_TOLL (toll, time, distance).
// Traffic classes from speed factor permille: free>=900, moderate>=600,
//   heavy>=300, otherwise severe. Penalties: 1000/1500/2500/4000.
// BALANCED: weights normalized to sum 1e6; scales = network baseline sums
//   (positive entries; safe default 1); fixed-point cost with 1e-6 resolution.
// Viva Q&A:
//   Q: Why lexicographic for toll? A: toll dominates; time breaks toll ties.
//   Q: What if avoidSevere disconnects? A: documented UNREACHABLE fallback.
//   Q: Precision of BALANCED? A: 1e-6 relative per-edge fixed point; no float.
#pragma once

#include <cstdint>

#include "pathforge/graph.hpp"

namespace pathforge {

enum class CongestionClass { Free, Moderate, Heavy, Severe };

CongestionClass classify(int factorPermille);
int classPenaltyPermille(CongestionClass c);

struct BalancedParams {
  std::int64_t wTime = 0;  // user weights, nonnegative, not all zero
  std::int64_t wDist = 0;
  std::int64_t wToll = 0;
  bool avoidSevere = false;  // hard-avoid severe arcs (drop them)
};

struct BalancedScales {
  std::int64_t sTime = 1;
  std::int64_t sDist = 1;
  std::int64_t sToll = 1;
};

// Resolved per-request model. Scalar models use cost(); LOWEST_TOLL uses label().
struct ResolvedObjective {
  CostModel model = CostModel::Fastest;
  BalancedParams params;
  BalancedScales scales;
  std::int64_t normWTime = 0;  // weights normalized to sum 1e6
  std::int64_t normWDist = 0;
  std::int64_t normWToll = 0;
  std::string error;  // non-empty when params invalid
  std::string description;
};

ResolvedObjective resolveObjective(const Graph& g, const std::string& name,
                                   const BalancedParams& params);

// Scalar cost of one usable arc (undefined for LOWEST_TOLL).
std::int64_t scalarArcCost(const Graph& g, int arcIdx, const ResolvedObjective& ro,
                           int factorPermille);

bool operator<(const TollLabel& a, const TollLabel& b);
bool operator==(const TollLabel& a, const TollLabel& b);
TollLabel operator+(const TollLabel& a, const TollLabel& b);
TollLabel tollArcLabel(const Graph& g, int arcIdx);

// Primary scalar for FASTEST/SHORTEST (0 for tuple/derived models).
std::int64_t arcPrimary(const EffectiveCost& c, CostModel model);

}  // namespace pathforge
