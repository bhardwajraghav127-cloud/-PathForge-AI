// Dijkstra implementation with global path tie-break.
#include "pathforge/dijkstra.hpp"

#include <algorithm>
#include <functional>
#include <limits>
#include <queue>
#include <vector>

#include "pathforge/heap.hpp"
#include "pathforge/objectives.hpp"

namespace pathforge {
namespace {

// Source-first arc-ID sequence of the recorded path to `vertex`.
std::vector<std::string> sourceFirstPath(const Graph& g, const std::vector<int>& parent, int vertex) {
  std::vector<std::string> rev;
  int cur = vertex;
  while (parent[static_cast<std::size_t>(cur)] != -1) {
    int pa = parent[static_cast<std::size_t>(cur)];
    rev.push_back(g.arc(pa).id);
    cur = g.arc(pa).from;
  }
  std::reverse(rev.begin(), rev.end());
  return rev;
}

}  // namespace

// Shared full-path tie-break (declared in dijkstra.hpp; used by A* too).
bool pathLess(const Graph& g, const std::vector<int>& parent, int u, int candArc) {
  std::vector<std::string> cand = sourceFirstPath(g, parent, u);
  cand.push_back(g.arc(candArc).id);
  std::vector<std::string> inc = sourceFirstPath(g, parent, g.arc(candArc).to);
  return cand < inc;
}

std::vector<int> dijkstra(const Graph& g, int srcIdx, CostModel model,
                          std::vector<std::int64_t>& dist, std::vector<int>& hops,
                          DijkstraStats& stats) {
  return dijkstraScalar(
      g, srcIdx, [&](int ai) { return arcPrimary(g.cost(ai), model); }, dist, hops, stats);
}

std::vector<int> dijkstraScalar(const Graph& g, int srcIdx,
                                const std::function<std::int64_t(int)>& arcCost,
                                std::vector<std::int64_t>& dist, std::vector<int>& hops,
                                DijkstraStats& stats, std::vector<TraceEvent>* trace,
                                std::int64_t maxEvents, std::int64_t initialDist) {
  auto record = [&](TraceEvent e) {
    if (trace == nullptr) return;
    if (static_cast<std::int64_t>(trace->size()) >= maxEvents) {
      stats.traceTruncated = true;
      return;
    }
    e.step = static_cast<std::int64_t>(trace->size());
    trace->push_back(e);
  };
  const int n = g.vertexCount();
  dist.assign(static_cast<std::size_t>(n), kInf64);
  hops.assign(static_cast<std::size_t>(n), std::numeric_limits<int>::max());
  std::vector<int> parent(static_cast<std::size_t>(n), -1);
  std::vector<char> settled(static_cast<std::size_t>(n), 0);
  dist[static_cast<std::size_t>(srcIdx)] = initialDist;
  hops[static_cast<std::size_t>(srcIdx)] = 0;

  IndexedMinHeap heap(n);
  heap.push(srcIdx, initialDist);
  stats.heapOps++;

  while (!heap.empty()) {
    int u = heap.pop();
    if (settled[static_cast<std::size_t>(u)]) continue;
    settled[static_cast<std::size_t>(u)] = 1;
    stats.visitedVertices++;
    record({0, "visit", g.vertex(u).id, "", dist[static_cast<std::size_t>(u)], ""});
    for (int ai : g.outgoing(u)) {
      stats.relaxedEdges++;
      const Arc& a = g.arc(ai);
      int v = a.to;
      if (settled[static_cast<std::size_t>(v)]) continue;
      EffectiveCost c = g.cost(ai);
      if (!c.usable) continue;
      std::int64_t w = arcCost(ai);
      if (w < 0 || w >= kInf64) continue;  // barred arc (e.g. avoidSevere)
      __int128 nd128 = static_cast<__int128>(dist[static_cast<std::size_t>(u)]) + w;
      std::int64_t nd =
          nd128 > static_cast<__int128>(kInf64) ? kInf64 : static_cast<std::int64_t>(nd128);
      int nh = hops[static_cast<std::size_t>(u)] + 1;
      std::int64_t od = dist[static_cast<std::size_t>(v)];
      if (nd < od || (nd == od && nh < hops[static_cast<std::size_t>(v)])) {
        dist[static_cast<std::size_t>(v)] = nd;
        hops[static_cast<std::size_t>(v)] = nh;
        parent[static_cast<std::size_t>(v)] = ai;
        if (heap.contains(v)) {
          heap.update(v, nd);
        } else {
          heap.push(v, nd);
        }
        stats.heapOps++;
        record({0, "relax", g.vertex(v).id, g.arc(ai).id, nd, ""});
      } else if (nd == od && nh == hops[static_cast<std::size_t>(v)] && od != kInf64) {
        // Equal (cost, hops): keep globally lexicographically smallest full path.
        if (pathLess(g, parent, u, ai)) {
          parent[static_cast<std::size_t>(v)] = ai;
        }
      }
    }
  }
  return parent;
}

RouteResult buildRoute(const Graph& g, int srcIdx, int dstIdx, CostModel model,
                       const std::vector<int>& parentArc, const std::vector<std::int64_t>& dist,
                       const DijkstraStats& stats, const std::string& objectiveDescription) {
  RouteResult r;
  r.objectiveDescription = objectiveDescription;
  if (dist[static_cast<std::size_t>(dstIdx)] == kInf64) {
    r.found = false;
    r.reason = "UNREACHABLE";
    return r;
  }
  r.found = true;
  // Reconstruct arc chain.
  std::vector<int> chain;
  int cur = dstIdx;
  while (cur != srcIdx) {
    int pa = parentArc[static_cast<std::size_t>(cur)];
    if (pa == -1) {
      r.found = false;
      r.reason = "UNREACHABLE";
      return r;
    }
    chain.push_back(pa);
    cur = g.arc(pa).from;
  }
  std::reverse(chain.begin(), chain.end());
  r.vertices.push_back(g.vertex(srcIdx).id);
  for (int ai : chain) {
    const Arc& a = g.arc(ai);
    EffectiveCost c = g.cost(ai);
    RouteLeg leg{a.id, a.roadId, g.vertex(a.from).id, g.vertex(a.to).id};
    r.arcs.push_back(leg);
    r.vertices.push_back(g.vertex(a.to).id);
    r.distanceM += c.distanceM;
    r.timeS += c.timeS;
    r.baselineTimeS += c.baselineTimeS;
    r.tollInr += c.tollInr;
  }
  r.delayS = r.timeS - r.baselineTimeS;
  // dist[] holds the scalar optimum under the caller's cost model (time,
  // distance, penalized time, or balanced fixed-point) — not raw distance.
  r.objectiveCost = dist[static_cast<std::size_t>(dstIdx)];
  (void)model;
  (void)stats;
  return r;
}

namespace {

struct TollEntry {
  TollLabel label;
  int hops = 0;
  int vertex = -1;
};
// Min-heap order: label, then hops, then vertexIdx (deterministic).
bool tollEntryGreater(const TollEntry& a, const TollEntry& b) {
  if (a.label == b.label) {
    if (a.hops != b.hops) return a.hops > b.hops;
    return a.vertex > b.vertex;
  }
  return b.label < a.label;
}

}  // namespace

std::vector<int> dijkstraToll(const Graph& g, int srcIdx, std::vector<TollLabel>& dist,
                              std::vector<int>& hops, DijkstraStats& stats,
                              TollLabel initial) {
  const int n = g.vertexCount();
  const TollLabel kInfToll{kInf64, kInf64, kInf64};
  dist.assign(static_cast<std::size_t>(n), kInfToll);
  hops.assign(static_cast<std::size_t>(n), std::numeric_limits<int>::max());
  std::vector<int> parent(static_cast<std::size_t>(n), -1);
  std::vector<char> settled(static_cast<std::size_t>(n), 0);
  dist[static_cast<std::size_t>(srcIdx)] = initial;
  hops[static_cast<std::size_t>(srcIdx)] = 0;

  std::priority_queue<TollEntry, std::vector<TollEntry>,
                      decltype(&tollEntryGreater)>
      pq(&tollEntryGreater);
  pq.push({initial, 0, srcIdx});
  stats.heapOps++;

  while (!pq.empty()) {
    TollEntry cur = pq.top();
    pq.pop();
    int u = cur.vertex;
    if (settled[static_cast<std::size_t>(u)]) continue;
    // Stale entry (a better label was recorded after this push).
    if (cur.label < dist[static_cast<std::size_t>(u)] ||
        dist[static_cast<std::size_t>(u)] < cur.label || cur.hops != hops[static_cast<std::size_t>(u)])
      continue;
    settled[static_cast<std::size_t>(u)] = 1;
    stats.visitedVertices++;
    for (int ai : g.outgoing(u)) {
      stats.relaxedEdges++;
      const Arc& a = g.arc(ai);
      int v = a.to;
      if (settled[static_cast<std::size_t>(v)]) continue;
      EffectiveCost c = g.cost(ai);
      if (!c.usable) continue;
      TollLabel cand = dist[static_cast<std::size_t>(u)] + tollArcLabel(g, ai);
      int nh = hops[static_cast<std::size_t>(u)] + 1;
      TollLabel& od = dist[static_cast<std::size_t>(v)];
      if (cand < od || (cand == od && nh < hops[static_cast<std::size_t>(v)])) {
        od = cand;
        hops[static_cast<std::size_t>(v)] = nh;
        parent[static_cast<std::size_t>(v)] = ai;
        pq.push({cand, nh, v});
        stats.heapOps++;
      } else if (cand == od && nh == hops[static_cast<std::size_t>(v)]) {
        if (pathLess(g, parent, u, ai)) parent[static_cast<std::size_t>(v)] = ai;
      }
    }
  }
  return parent;
}

RouteResult buildRouteToll(const Graph& g, int srcIdx, int dstIdx,
                           const std::vector<int>& parentArc, const std::vector<TollLabel>& dist,
                           const DijkstraStats& stats, const std::string& objectiveDescription) {
  RouteResult r;
  r.objectiveDescription = objectiveDescription;
  const TollLabel kInfToll{kInf64, kInf64, kInf64};
  TollLabel got = dist[static_cast<std::size_t>(dstIdx)];
  if (got == kInfToll) {
    r.found = false;
    r.reason = "UNREACHABLE";
    return r;
  }
  std::vector<int> chain;
  int cur = dstIdx;
  while (cur != srcIdx) {
    int pa = parentArc[static_cast<std::size_t>(cur)];
    if (pa == -1) {
      r.found = false;
      r.reason = "UNREACHABLE";
      return r;
    }
    chain.push_back(pa);
    cur = g.arc(pa).from;
  }
  std::reverse(chain.begin(), chain.end());
  r.found = true;
  r.vertices.push_back(g.vertex(srcIdx).id);
  for (int ai : chain) {
    const Arc& a = g.arc(ai);
    EffectiveCost c = g.cost(ai);
    r.arcs.push_back({a.id, a.roadId, g.vertex(a.from).id, g.vertex(a.to).id});
    r.vertices.push_back(g.vertex(a.to).id);
    r.distanceM += c.distanceM;
    r.timeS += c.timeS;
    r.baselineTimeS += c.baselineTimeS;
    r.tollInr += c.tollInr;
  }
  r.delayS = r.timeS - r.baselineTimeS;
  r.hasObjectiveTuple = true;
  r.objectiveTuple = got;
  r.objectiveCost = got.toll;
  (void)stats;
  return r;
}

}  // namespace pathforge
