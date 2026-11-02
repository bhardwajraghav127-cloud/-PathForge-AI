// lab.run implementation (M2 subset).
#include "pathforge/lab.hpp"

#include "pathforge/astar.hpp"
#include "pathforge/dijkstra.hpp"
#include "pathforge/objectives.hpp"
#include "pathforge/traversal.hpp"

namespace pathforge {

LabOutcome runLab(const Graph& g, const std::string& algorithm, int srcIdx, int dstIdx,
                  const ResolvedObjective& ro, std::int64_t maxEvents) {
  LabOutcome o;
  o.algorithm = algorithm;
  if (maxEvents < 1) maxEvents = 1;
  if (maxEvents > 100000) maxEvents = 100000;  // hard cap; engine decides, UI shows

  if (algorithm == "BFS") {
    TraversalResult t = bfs(g, srcIdx, maxEvents);
    o.ok = true;
    o.order = t.order;
    o.trace = t.trace;
    o.truncated = t.truncated;
    return o;
  }
  if (algorithm == "DFS") {
    TraversalResult t = dfs(g, srcIdx, maxEvents);
    o.ok = true;
    o.order = t.order;
    o.trace = t.trace;
    o.truncated = t.truncated;
    return o;
  }
  if (algorithm != "DIJKSTRA" && algorithm != "A_STAR") {
    o.errorCode = "UNKNOWN_ALGORITHM";
    o.errorDetail = "unknown lab algorithm: " + algorithm + " (M2: BFS, DFS, DIJKSTRA, A_STAR)";
    return o;
  }
  if (dstIdx < 0) {
    o.errorCode = "SCHEMA_VIOLATION";
    o.errorDetail = "lab algorithm " + algorithm + " requires target";
    return o;
  }
  if (algorithm == "DIJKSTRA") {
    std::vector<TraceEvent> trace;
    std::vector<std::int64_t> dist;
    std::vector<int> hops;
    std::vector<int> parent;
    if (ro.model == CostModel::LowestToll) {
      std::vector<TollLabel> d2;
      parent = dijkstraToll(g, srcIdx, d2, hops, o.stats);
      if (d2[static_cast<std::size_t>(dstIdx)] == TollLabel{kInf64, kInf64, kInf64}) {
        o.ok = true;
        o.hasRoute = true;
        o.route.found = false;
        o.route.reason = "UNREACHABLE";
        o.route.objectiveDescription = ro.description;
        return o;
      }
      o.route = buildRouteToll(g, srcIdx, dstIdx, parent, d2, o.stats, ro.description);
    } else {
      auto costFn = [&](int ai) -> std::int64_t {
        if (ro.model == CostModel::AvoidCongestion && ro.params.avoidSevere &&
            classify(g.factorPermille(ai)) == CongestionClass::Severe)
          return kInf64;
        return scalarArcCost(g, ai, ro, g.factorPermille(ai));
      };
      parent = (ro.model == CostModel::Fastest || ro.model == CostModel::Shortest)
                   ? dijkstraScalar(
                         g, srcIdx, [&](int ai) { return arcPrimary(g.cost(ai), ro.model); },
                         dist, hops, o.stats, &trace, maxEvents)
                   : dijkstraScalar(g, srcIdx, costFn, dist, hops, o.stats, &trace, maxEvents);
      o.route = buildRoute(g, srcIdx, dstIdx, ro.model, parent, dist, o.stats, ro.description);
    }
    o.ok = true;
    o.hasRoute = true;
    o.trace = trace;
    o.truncated = o.stats.traceTruncated;
    return o;
  }
  if (algorithm == "A_STAR") {
    if (ro.model != CostModel::Fastest && ro.model != CostModel::Shortest) {
      // h=0 Dijkstra-equivalent: honest, warned, optimal.
      std::vector<TraceEvent> trace;
      std::vector<std::int64_t> dist;
      std::vector<int> hops;
      auto costFn = [&](int ai) -> std::int64_t {
        if (ro.model == CostModel::AvoidCongestion && ro.params.avoidSevere &&
            classify(g.factorPermille(ai)) == CongestionClass::Severe)
          return kInf64;
        return scalarArcCost(g, ai, ro, g.factorPermille(ai));
      };
      std::vector<int> parent =
          ro.model == CostModel::LowestToll
              ? std::vector<int>{}
              : dijkstraScalar(g, srcIdx, costFn, dist, hops, o.stats, &trace, maxEvents);
      if (ro.model == CostModel::LowestToll) {
        std::vector<TollLabel> d2;
        parent = dijkstraToll(g, srcIdx, d2, hops, o.stats);
        o.route = buildRouteToll(g, srcIdx, dstIdx, parent, d2, o.stats,
                                 ro.description + " [A* with h=0: Dijkstra-equivalent]");
      } else {
        o.route = buildRoute(g, srcIdx, dstIdx, ro.model, parent, dist, o.stats,
                             ro.description + " [A* with h=0: Dijkstra-equivalent]");
      }
      o.ok = true;
      o.hasRoute = true;
      o.trace = trace;
      o.truncated = o.stats.traceTruncated;
      o.heuristicZero = true;
      return o;
    }
    AStarOutcome a = astar(g, srcIdx, dstIdx, ro.model, maxEvents);
    if (!a.ok) {
      o.errorCode = "HEURISTIC_INADMISSIBLE";
      o.errorDetail = a.detail;
      return o;
    }
    o.route = buildRoute(g, srcIdx, dstIdx, ro.model, a.parent, a.dist, a.stats, ro.description);
    o.ok = true;
    o.hasRoute = true;
    o.trace = a.trace;
    o.truncated = a.stats.traceTruncated;
    o.heuristicZero = a.heuristicZero;
    o.expandedVertices = a.expandedVertices;
    o.stats = a.stats;
    return o;
  }
  o.errorCode = "UNKNOWN_ALGORITHM";
  o.errorDetail = "unknown lab algorithm: " + algorithm + " (M2: BFS, DFS, DIJKSTRA, A_STAR)";
  return o;
}

}  // namespace pathforge
