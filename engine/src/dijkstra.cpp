// Dijkstra implementation with global path tie-break.
#include "pathforge/dijkstra.hpp"

#include <algorithm>
#include <limits>
#include <vector>

#include "pathforge/heap.hpp"

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

// True if the candidate path (recorded path to u, then candArc into v) is
// lexicographically smaller than the recorded path to v. Caller guarantees
// parent[v] is still the incumbent arc (not yet overwritten).
bool candidatePathLess(const Graph& g, const std::vector<int>& parent, int u, int candArc) {
  std::vector<std::string> cand = sourceFirstPath(g, parent, u);
  cand.push_back(g.arc(candArc).id);
  std::vector<std::string> inc = sourceFirstPath(g, parent, g.arc(candArc).to);
  return cand < inc;
}

std::int64_t arcPrimary(const EffectiveCost& c, CostModel model) {
  return model == CostModel::Fastest ? c.timeS : c.distanceM;
}

}  // namespace

std::vector<int> dijkstra(const Graph& g, int srcIdx, CostModel model,
                          std::vector<std::int64_t>& dist, std::vector<int>& hops,
                          DijkstraStats& stats) {
  const int n = g.vertexCount();
  dist.assign(static_cast<std::size_t>(n), kInf64);
  hops.assign(static_cast<std::size_t>(n), std::numeric_limits<int>::max());
  std::vector<int> parent(static_cast<std::size_t>(n), -1);
  std::vector<char> settled(static_cast<std::size_t>(n), 0);
  dist[static_cast<std::size_t>(srcIdx)] = 0;
  hops[static_cast<std::size_t>(srcIdx)] = 0;

  IndexedMinHeap heap(n);
  heap.push(srcIdx, 0);
  stats.heapOps++;

  while (!heap.empty()) {
    int u = heap.pop();
    if (settled[static_cast<std::size_t>(u)]) continue;
    settled[static_cast<std::size_t>(u)] = 1;
    stats.visitedVertices++;
    for (int ai : g.outgoing(u)) {
      stats.relaxedEdges++;
      const Arc& a = g.arc(ai);
      int v = a.to;
      if (settled[static_cast<std::size_t>(v)]) continue;
      EffectiveCost c = g.cost(ai);
      if (!c.usable) continue;
      std::int64_t w = arcPrimary(c, model);
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
      } else if (nd == od && nh == hops[static_cast<std::size_t>(v)] && od != kInf64) {
        // Equal (cost, hops): keep globally lexicographically smallest full path.
        // Temporarily compare candidate (u -> v via ai) vs incumbent parent[v].
        if (candidatePathLess(g, parent, u, ai)) {
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
  r.objectiveCost = (model == CostModel::Fastest) ? r.timeS : r.distanceM;
  (void)stats;
  return r;
}

}  // namespace pathforge
