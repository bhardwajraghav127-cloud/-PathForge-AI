// Position resolution + shared plan evaluation + shared route serialization.
#include "pathforge/position.hpp"

#include "pathforge/objectives.hpp"

namespace pathforge {

ResolvedSource resolveVertexSource(int vertexIdx) {
  ResolvedSource s;
  s.vertexIdx = vertexIdx;
  return s;
}

ResolvedSource resolveArcSource(const Graph& g, const std::string& arcId, int fraction) {
  ResolvedSource s;
  if (fraction < 0 || fraction > 1000) {
    s.errorCode = "INVALID_POSITION";
    s.errorDetail = "fractionPermille must be 0..1000";
    return s;
  }
  int ai = -1;
  for (int i = 0; i < g.arcCount(); ++i) {
    if (g.arc(i).id == arcId) {
      ai = i;
      break;
    }
  }
  if (ai < 0) {
    s.errorCode = "UNKNOWN_ROAD";
    s.errorDetail = "unknown arc: " + arcId;
    return s;
  }
  const Arc& a = g.arc(ai);
  if (fraction == 1000) {
    // Arrived at head: plain vertex source, no remainder, no crawl.
    s.vertexIdx = a.to;
    return s;
  }
  s.midArc = true;
  s.arcIdx = ai;
  s.tailIdx = a.from;
  s.vertexIdx = a.to;  // routing starts at head
  s.fraction = fraction;
  s.occupyingClosedArc = !g.cost(ai).usable;
  return s;
}

std::int64_t remainderCost(std::int64_t full, int fraction) {
  __int128 num = static_cast<__int128>(full) * (1000 - fraction);
  __int128 q = (num + 999) / 1000;  // ceiling
  if (q > static_cast<__int128>(kInf64)) return kInf64;
  return static_cast<std::int64_t>(q);
}

Remainder remainderFor(const Graph& g, int arcIdx, const ResolvedSource& src) {
  Remainder r;
  EffectiveCost c = g.cost(arcIdx);
  if (!c.usable) {
    // Crawl policy: 100 permille of baseline speed => 10x baseline time.
    __int128 t = static_cast<__int128>(c.baselineTimeS) * 10;
    // Remainder of the crawl over the UNCOVERED fraction.
    __int128 num = t * (1000 - src.fraction);
    __int128 q = (num + 999) / 1000;
    r.timeS = q > static_cast<__int128>(kInf64) ? kInf64 : static_cast<std::int64_t>(q);
    r.distanceM = remainderCost(c.distanceM, src.fraction);
    r.crawl = true;
    return r;
  }
  r.timeS = remainderCost(c.timeS, src.fraction);
  r.distanceM = remainderCost(c.distanceM, src.fraction);
  return r;
}

namespace {

std::int64_t satAdd(std::int64_t a, std::int64_t b) {
  __int128 v = static_cast<__int128>(a) + b;
  if (v > static_cast<__int128>(kInf64)) return kInf64;
  if (v < 0) return 0;
  return static_cast<std::int64_t>(v);
}

}  // namespace

std::int64_t scalarRemainderCost(const Graph& g, int arcIdx, const Remainder& rem,
                                 const ResolvedObjective& ro) {
  switch (ro.model) {
    case CostModel::Fastest:
      return rem.timeS;
    case CostModel::Shortest:
      return rem.distanceM;
    case CostModel::AvoidCongestion: {
      std::int64_t pen = classPenaltyPermille(classify(g.factorPermille(arcIdx)));
      __int128 v = static_cast<__int128>(rem.timeS) * pen;
      __int128 q = (v + 500) / 1000;
      return q > static_cast<__int128>(kInf64) ? kInf64 : static_cast<std::int64_t>(q);
    }
    case CostModel::Balanced: {
      __int128 acc = 0;
      acc += static_cast<__int128>(ro.normWTime) * rem.timeS * 1000 / ro.scales.sTime;
      acc += static_cast<__int128>(ro.normWDist) * rem.distanceM * 1000 / ro.scales.sDist;
      __int128 q = (acc + 500) / 1000;  // toll remainder is 0
      return q > static_cast<__int128>(kInf64) ? kInf64 : static_cast<std::int64_t>(q);
    }
    case CostModel::LowestToll:
      return 0;
  }
  return 0;
}

PlanEval evaluatePlan(const Graph& g, const std::vector<std::string>& arcIds,
                      const ResolvedSource& src, const ResolvedObjective* ro,
                      std::string& errorCode, std::string& errorDetail) {
  PlanEval e;
  if (arcIds.empty()) {
    e.reason = "EMPTY_PLAN";
    return e;
  }
  // Map ids to indices; fail fast on unknown.
  std::vector<int> idx;
  idx.reserve(arcIds.size());
  for (const auto& id : arcIds) {
    int ai = -1;
    for (int i = 0; i < g.arcCount(); ++i) {
      if (g.arc(i).id == id) {
        ai = i;
        break;
      }
    }
    if (ai < 0) {
      errorCode = "UNKNOWN_ROAD";
      errorDetail = "unknown arc in plan: " + id;
      return e;
    }
    idx.push_back(ai);
  }
  std::size_t start = 0;
  if (src.midArc) {
    if (idx[0] != src.arcIdx) {
      e.reason = "DISCONTINUOUS";
      return e;
    }
    Remainder rem = remainderFor(g, idx[0], src);
    const Arc& a0 = g.arc(idx[0]);
    e.arcs.push_back({a0.id, a0.roadId, g.vertex(a0.from).id, g.vertex(a0.to).id});
    e.vertices.push_back(g.vertex(a0.from).id);
    e.vertices.push_back(g.vertex(a0.to).id);
    e.timeS = rem.timeS;
    e.distanceM = rem.distanceM;
    e.tollInr = 0;  // toll incurred on entry
    EffectiveCost c0 = g.cost(idx[0]);
    e.baselineTimeS = remainderCost(c0.baselineTimeS, src.fraction);
    e.occupyingClosedArc = rem.crawl;
    if (ro != nullptr) {
      if (ro->model == CostModel::LowestToll) {
        e.hasObjectiveTuple = true;
        e.objectiveTuple = {0, rem.timeS, rem.distanceM};
      } else {
        e.objectiveCost = scalarRemainderCost(g, idx[0], rem, *ro);
      }
    }
    start = 1;
    if (rem.crawl) {
      // Remainder is traversable under crawl; suffix must still connect.
    }
  } else {
    e.vertices.push_back(g.vertex(g.arc(idx[0]).from).id);
  }
  for (std::size_t k = start; k < idx.size(); ++k) {
    const Arc& a = g.arc(idx[k]);
    EffectiveCost c = g.cost(idx[k]);
    // Connectivity: head of previous == from of current.
    if (!e.vertices.empty() && e.vertices.back() != g.vertex(a.from).id) {
      e.reason = "DISCONTINUOUS";
      e.arcs.clear();
      e.vertices.clear();
      return e;
    }
    if (!c.usable) {
      e.valid = true;
      e.blocked = true;
      e.blockedAtArc = a.id;
      e.blockedAtIndex = k;
      e.delayS = e.timeS - e.baselineTimeS;
      return e;
    }
    if (ro != nullptr && ro->model == CostModel::AvoidCongestion && ro->params.avoidSevere &&
        classify(g.factorPermille(idx[k])) == CongestionClass::Severe) {
      e.valid = true;
      e.blocked = true;
      e.blockedAtArc = a.id;
      e.blockedAtIndex = k;
      e.delayS = e.timeS - e.baselineTimeS;
      return e;
    }
    e.arcs.push_back({a.id, a.roadId, g.vertex(a.from).id, g.vertex(a.to).id});
    e.vertices.push_back(g.vertex(a.to).id);
    e.timeS += c.timeS;
    e.distanceM += c.distanceM;
    e.baselineTimeS += c.baselineTimeS;
    e.tollInr += c.tollInr;
    if (ro != nullptr) {
      if (ro->model == CostModel::LowestToll) {
        e.hasObjectiveTuple = true;
        e.objectiveTuple = e.objectiveTuple + TollLabel{c.tollInr, c.timeS, c.distanceM};
      } else {
        e.objectiveCost = satAdd(e.objectiveCost, scalarArcCost(g, idx[k], *ro, g.factorPermille(idx[k])));
      }
    }
  }
  e.valid = true;
  e.delayS = e.timeS - e.baselineTimeS;
  return e;
}

nlohmann::json routeToJson(const RouteResult& r) {
  nlohmann::json arcs = nlohmann::json::array();
  for (const auto& l : r.arcs)
    arcs.push_back(
        {{"arcId", l.arcId}, {"roadId", l.roadId}, {"from", l.from}, {"to", l.to}});
  nlohmann::json cost = r.objectiveCost;
  if (r.hasObjectiveTuple)
    cost = {{"tollInr", r.objectiveTuple.toll},
            {"timeS", r.objectiveTuple.time},
            {"distanceM", r.objectiveTuple.dist}};
  nlohmann::json out{{"found", r.found},
                     {"reason", r.reason},
                     {"arcs", arcs},
                     {"vertices", r.vertices},
                     {"distanceM", r.distanceM},
                     {"timeS", r.timeS},
                     {"baselineTimeS", r.baselineTimeS},
                     {"delayS", r.delayS},
                     {"tollInr", r.tollInr},
                     {"objectiveCost", cost},
                     {"objectiveDescription", r.objectiveDescription}};
  if (r.hasPartialLeadingArc) {
    out["partialLeadingArc"] = {
        {"arcId", r.partialLeg.arcId},
        {"roadId", r.partialLeg.roadId},
        {"from", r.partialLeg.from},
        {"to", r.partialLeg.to},
        {"remainingTimeS", r.partialTimeS},
        {"remainingDistanceM", r.partialDistanceM},
        {"occupyingClosedArc", r.partialCrawl}};
  }
  return out;
}

RouteResult joinRemainder(const Graph& g, const ResolvedSource& rsrc, const Remainder& rem,
                          const RouteResult& suffix) {
  RouteResult r;
  r.objectiveDescription = suffix.objectiveDescription;
  const Arc& a = g.arc(rsrc.arcIdx);
  r.partialLeg = {a.id, a.roadId, g.vertex(a.from).id, g.vertex(a.to).id};
  r.hasPartialLeadingArc = true;
  r.partialTimeS = rem.timeS;
  r.partialDistanceM = rem.distanceM;
  r.partialCrawl = rem.crawl;
  r.found = suffix.found;
  r.reason = suffix.reason;
  r.hasObjectiveTuple = suffix.hasObjectiveTuple;
  r.objectiveTuple = suffix.objectiveTuple;
  r.objectiveCost = suffix.objectiveCost;
  r.arcs.reserve(suffix.arcs.size() + 1);
  r.arcs.push_back(r.partialLeg);
  r.arcs.insert(r.arcs.end(), suffix.arcs.begin(), suffix.arcs.end());
  r.vertices.reserve(suffix.vertices.size() + 1);
  r.vertices.push_back(g.vertex(a.from).id);
  r.vertices.insert(r.vertices.end(), suffix.vertices.begin(), suffix.vertices.end());
  EffectiveCost c = g.cost(rsrc.arcIdx);
  std::int64_t baseRem = remainderCost(c.baselineTimeS, rsrc.fraction);
  r.timeS = rem.timeS + suffix.timeS;
  r.distanceM = rem.distanceM + suffix.distanceM;
  r.baselineTimeS = baseRem + suffix.baselineTimeS;
  r.delayS = r.timeS - r.baselineTimeS;
  r.tollInr = suffix.tollInr;  // toll incurred once on entry
  return r;
}

}  // namespace pathforge
