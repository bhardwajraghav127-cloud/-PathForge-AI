// lab.run implementation (M2 subset + M5 MST/topo extensions).
#include "pathforge/lab.hpp"

#include <set>

#include "pathforge/astar.hpp"
#include "pathforge/dijkstra.hpp"
#include "pathforge/kruskal.hpp"
#include "pathforge/objectives.hpp"
#include "pathforge/prim.hpp"
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
  if (algorithm == "MST_PRIM" || algorithm == "MST_KRUSKAL") {
    MstResult m = (algorithm == "MST_PRIM") ? primMst(g, maxEvents) : kruskalMst(g, maxEvents);
    o.ok = true;
    o.mstEdges = m.edges;
    o.mstWeight = m.totalWeightM;
    o.mstForest = m.forest;
    o.trace = m.trace;
    o.truncated = m.truncated;
    o.stats.relaxedEdges = m.relaxedEdges;
    o.stats.heapOps = m.heapOps;
    return o;
  }
  if (algorithm == "TOPO_SORT") {
    // Kahn with lexicographically smallest vertex id first (deterministic).
    const int n = g.vertexCount();
    std::vector<int> indeg(static_cast<std::size_t>(n), 0);
    for (int u = 0; u < n; ++u) {
      for (int ai : g.outgoing(u)) indeg[static_cast<std::size_t>(g.arc(ai).to)]++;
    }
    std::set<std::string> ready;
    for (int v = 0; v < n; ++v) {
      if (indeg[static_cast<std::size_t>(v)] == 0) ready.insert(g.vertex(v).id);
    }
    std::vector<TraceEvent> trace;
    bool trunc = false;
    auto record = [&](TraceEvent e) {
      if (static_cast<std::int64_t>(trace.size()) >= maxEvents) {
        trunc = true;
        return;
      }
      e.step = static_cast<std::int64_t>(trace.size());
      trace.push_back(e);
    };
    while (!ready.empty()) {
      std::string id = *ready.begin();
      ready.erase(ready.begin());
      int u = g.vertexIndex(id);
      o.order.push_back(id);
      record({0, "select", id, "", 0, "topo"});
      for (int ai : g.outgoing(u)) {
        int v = g.arc(ai).to;
        if (--indeg[static_cast<std::size_t>(v)] == 0) ready.insert(g.vertex(v).id);
      }
      if (trunc) break;
    }
    o.ok = true;
    o.hasCycle = static_cast<int>(o.order.size()) < n;
    o.trace = trace;
    o.truncated = trunc;
    return o;
  }
  if (algorithm != "DIJKSTRA" && algorithm != "A_STAR") {
    o.errorCode = "UNKNOWN_ALGORITHM";
    o.errorDetail =
        "unknown lab algorithm: " + algorithm + " (BFS, DFS, DIJKSTRA, A_STAR, MST_PRIM,"
        " MST_KRUSKAL, TOPO_SORT, BINSEARCH)";
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
  o.errorCode = "INTERNAL";
  o.errorDetail = "unreachable lab dispatch";
  return o;
}

LabOutcome runBinsearch(const std::vector<std::int64_t>& values, std::int64_t target,
                        std::int64_t maxEvents) {
  LabOutcome o;
  o.algorithm = "BINSEARCH";
  if (maxEvents < 1) maxEvents = 1;
  for (std::size_t i = 1; i < values.size(); ++i) {
    if (values[i] < values[i - 1]) {
      o.errorCode = "SCHEMA_VIOLATION";
      o.errorDetail = "values must be sorted non-decreasing";
      return o;
    }
  }
  std::int64_t lo = 0;
  std::int64_t hi = static_cast<std::int64_t>(values.size());
  auto record = [&](std::int64_t l, std::int64_t m, std::int64_t h, const std::string& note) {
    if (static_cast<std::int64_t>(o.trace.size()) >= maxEvents) {
      o.truncated = true;
      return;
    }
    TraceEvent e;
    e.step = static_cast<std::int64_t>(o.trace.size());
    e.type = "select";
    e.dist = m;
    e.note = "lo=" + std::to_string(l) + " hi=" + std::to_string(h) + " " + note;
    o.trace.push_back(e);
  };
  while (lo < hi) {
    std::int64_t mid = lo + (hi - lo) / 2;
    std::int64_t v = values[static_cast<std::size_t>(mid)];
    if (v < target) {
      record(lo, mid, hi, "below");
      lo = mid + 1;
    } else {
      record(lo, mid, hi, v == target ? "match" : "above");
      hi = mid;
    }
    if (o.truncated) break;
  }
  o.ok = true;
  if (lo < static_cast<std::int64_t>(values.size())) {
    o.searchIndex = lo;
    o.searchExact = values[static_cast<std::size_t>(lo)] == target;
  } else {
    o.searchIndex = -1;
    o.searchExact = false;
  }
  return o;
}

}  // namespace pathforge
