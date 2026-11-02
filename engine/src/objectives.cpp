// Objective resolution + scalar costs + toll labels.
#include "pathforge/objectives.hpp"

namespace pathforge {

CongestionClass classify(int factorPermille) {
  if (factorPermille >= 900) return CongestionClass::Free;
  if (factorPermille >= 600) return CongestionClass::Moderate;
  if (factorPermille >= 300) return CongestionClass::Heavy;
  return CongestionClass::Severe;
}

int classPenaltyPermille(CongestionClass c) {
  switch (c) {
    case CongestionClass::Free: return 1000;
    case CongestionClass::Moderate: return 1500;
    case CongestionClass::Heavy: return 2500;
    case CongestionClass::Severe: return 4000;
  }
  return 1000;
}

ResolvedObjective resolveObjective(const Graph& g, const std::string& name,
                                   const BalancedParams& params) {
  ResolvedObjective ro;
  if (name == "FASTEST") {
    ro.model = CostModel::Fastest;
    ro.description = "FASTEST: minimize total effective seconds under overlay";
  } else if (name == "SHORTEST") {
    ro.model = CostModel::Shortest;
    ro.description = "SHORTEST: minimize total metres";
  } else if (name == "LOWEST_TOLL") {
    ro.model = CostModel::LowestToll;
    ro.description = "LOWEST_TOLL: lexicographically minimize (tollInr, timeS, distanceM)";
  } else if (name == "AVOID_CONGESTION") {
    ro.model = CostModel::AvoidCongestion;
    ro.params = params;
    ro.description =
        "AVOID_CONGESTION: minimize effective time x class penalty "
        "(1000/1500/2500/4000)";
    if (params.avoidSevere) ro.description += "; severe arcs excluded (UNREACHABLE if cut)";
  } else if (name == "BALANCED") {
    ro.model = CostModel::Balanced;
    ro.params = params;
    if (params.wTime < 0 || params.wDist < 0 || params.wToll < 0) {
      ro.error = "weights must be nonnegative";
      return ro;
    }
    __int128 sum =
        static_cast<__int128>(params.wTime) + params.wDist + params.wToll;
    if (sum == 0) {
      ro.error = "weights must not be all zero";
      return ro;
    }
    // Normalize to sum 1e6; remainder goes to the largest weight (documented).
    const std::int64_t kNorm = 1000000;
    ro.normWTime = static_cast<std::int64_t>(static_cast<__int128>(params.wTime) * kNorm / sum);
    ro.normWDist = static_cast<std::int64_t>(static_cast<__int128>(params.wDist) * kNorm / sum);
    ro.normWToll = static_cast<std::int64_t>(static_cast<__int128>(params.wToll) * kNorm / sum);
    std::int64_t rem =
        kNorm - ro.normWTime - ro.normWDist - ro.normWToll;
    if (params.wTime >= params.wDist && params.wTime >= params.wToll) {
      ro.normWTime += rem;
    } else if (params.wDist >= params.wToll) {
      ro.normWDist += rem;
    } else {
      ro.normWToll += rem;
    }
    // Scales: sums of positive baselines over usable arcs; safe default 1.
    __int128 sT = 0, sD = 0, sTo = 0;
    for (int i = 0; i < g.arcCount(); ++i) {
      EffectiveCost c = g.cost(i);
      if (!c.usable) continue;
      if (c.baselineTimeS > 0) sT += c.baselineTimeS;
      if (c.distanceM > 0) sD += c.distanceM;
      if (c.tollInr > 0) sTo += c.tollInr;
    }
    // Each directed arc counted once; two-way roads contribute both directions
    // (documented: scales are direction-aware sums).
    ro.scales.sTime = sT > 0 ? (sT > kInf64 ? kInf64 : static_cast<std::int64_t>(sT)) : 1;
    ro.scales.sDist = sD > 0 ? (sD > kInf64 ? kInf64 : static_cast<std::int64_t>(sD)) : 1;
    ro.scales.sToll = sTo > 0 ? (sTo > kInf64 ? kInf64 : static_cast<std::int64_t>(sTo)) : 1;
    ro.description = "BALANCED: weighted normalized time/distance/toll";
  } else {
    ro.error = "objective must be FASTEST, SHORTEST, LOWEST_TOLL, AVOID_CONGESTION or BALANCED";
    return ro;
  }
  return ro;
}

std::int64_t scalarArcCost(const Graph& g, int arcIdx, const ResolvedObjective& ro,
                           int factorPermille) {
  EffectiveCost c = g.cost(arcIdx);
  switch (ro.model) {
    case CostModel::Fastest:
    case CostModel::Shortest:
      return arcPrimary(c, ro.model);
    case CostModel::AvoidCongestion: {
      CongestionClass cls = classify(factorPermille);
      std::int64_t pen = classPenaltyPermille(cls);
      __int128 v = static_cast<__int128>(c.timeS) * pen;
      __int128 q = (v + 500) / 1000;  // round-half-up
      return q > static_cast<__int128>(kInf64) ? kInf64 : static_cast<std::int64_t>(q);
    }
    case CostModel::Balanced: {
      // Fixed-point 1e-6: sum over w_i * x_i / S_i, rounded half up.
      __int128 acc = 0;
      acc += static_cast<__int128>(ro.normWTime) * c.timeS * 1000 / ro.scales.sTime;
      acc += static_cast<__int128>(ro.normWDist) * c.distanceM * 1000 / ro.scales.sDist;
      acc += static_cast<__int128>(ro.normWToll) * c.tollInr * 1000 / ro.scales.sToll;
      __int128 q = (acc + 500) / 1000;
      return q > static_cast<__int128>(kInf64) ? kInf64 : static_cast<std::int64_t>(q);
    }
    case CostModel::LowestToll:
      return 0;  // unused: tuple path
  }
  return 0;
}

bool operator<(const TollLabel& a, const TollLabel& b) {
  if (a.toll != b.toll) return a.toll < b.toll;
  if (a.time != b.time) return a.time < b.time;
  return a.dist < b.dist;
}
std::int64_t arcPrimary(const EffectiveCost& c, CostModel model) {
  if (model == CostModel::Fastest) return c.timeS;
  if (model == CostModel::Shortest) return c.distanceM;
  return 0;
}

bool operator==(const TollLabel& a, const TollLabel& b) {
  return a.toll == b.toll && a.time == b.time && a.dist == b.dist;
}
TollLabel operator+(const TollLabel& a, const TollLabel& b) {
  auto sat = [](__int128 v) {
    return v > static_cast<__int128>(kInf64) ? kInf64 : static_cast<std::int64_t>(v);
  };
  return {sat(static_cast<__int128>(a.toll) + b.toll),
          sat(static_cast<__int128>(a.time) + b.time),
          sat(static_cast<__int128>(a.dist) + b.dist)};
}

TollLabel tollArcLabel(const Graph& g, int arcIdx) {
  EffectiveCost c = g.cost(arcIdx);
  return {c.tollInr, c.timeS, c.distanceM};
}

}  // namespace pathforge
