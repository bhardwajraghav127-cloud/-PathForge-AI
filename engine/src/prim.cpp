// Prim's algorithm with indexed decrease-key heap.
#include "pathforge/prim.hpp"

#include <algorithm>
#include <limits>

#include "pathforge/heap.hpp"

namespace pathforge {
namespace {

struct UEdge {
  int u = -1;
  int v = -1;
  std::int64_t w = 0;
  std::string roadId;
};

}  // namespace

MstResult primMst(const Graph& g, std::int64_t maxEvents) {
  MstResult r;
  const int n = g.vertexCount();
  if (n == 0) return r;
  if (maxEvents < 1) maxEvents = 1;
  auto record = [&](TraceEvent e) {
    if (static_cast<std::int64_t>(r.trace.size()) >= maxEvents) {
      r.truncated = true;
      return;
    }
    e.step = static_cast<std::int64_t>(r.trace.size());
    r.trace.push_back(e);
  };
  // Undirected adjacency from usable roads (each road once).
  std::vector<std::vector<UEdge>> adj(static_cast<std::size_t>(n));
  for (int i = 0; i < g.arcCount(); ++i) {
    const Arc& a = g.arc(i);
    // Only the forward arc represents the road (reverse duplicates it).
    if (!a.forward) continue;
    // Usable if either direction is usable.
    bool usable = g.cost(i).usable;
    if (!usable) {
      for (int j = 0; j < g.arcCount(); ++j) {
        if (g.arc(j).roadId == a.roadId && g.cost(j).usable) {
          usable = true;
          break;
        }
      }
    }
    if (!usable) continue;
    UEdge e{a.from, a.to, g.roadOf(i).distanceM, a.roadId};
    adj[static_cast<std::size_t>(a.from)].push_back(e);
    adj[static_cast<std::size_t>(a.to)].push_back({a.to, a.from, e.w, e.roadId});
  }
  // Start: lexicographically smallest vertex id (documented).
  int start = 0;
  for (int v = 1; v < n; ++v) {
    if (g.vertex(v).id < g.vertex(start).id) start = v;
  }
  const std::int64_t kInf = kInf64;
  std::vector<std::int64_t> key(static_cast<std::size_t>(n), kInf);
  std::vector<int> parentEdge(static_cast<std::size_t>(n), -1);
  std::vector<UEdge> parentInfo(static_cast<std::size_t>(n));
  std::vector<char> inMst(static_cast<std::size_t>(n), 0);
  // Deterministic tie-break for equal keys: smaller vertexIdx first is handled
  // by the heap; equal (key, vertex) with different roads needs road order:
  // relax only on strictly smaller (w, roadId).
  auto better = [](std::int64_t wNew, const std::string& rNew, std::int64_t wOld,
                   const std::string& rOld) {
    if (wNew != wOld) return wNew < wOld;
    return rNew < rOld;
  };
  key[static_cast<std::size_t>(start)] = 0;
  IndexedMinHeap heap(n);
  heap.push(start, 0);
  r.heapOps++;
  int taken = 0;
  while (!heap.empty()) {
    int u = heap.pop();
    if (inMst[static_cast<std::size_t>(u)]) continue;
    inMst[static_cast<std::size_t>(u)] = 1;
    taken++;
    record({0, "visit", g.vertex(u).id, "", key[static_cast<std::size_t>(u)], ""});
    if (parentEdge[static_cast<std::size_t>(u)] != -1) {
      const UEdge& e = parentInfo[static_cast<std::size_t>(u)];
      r.edges.push_back({e.roadId, g.vertex(e.u).id, g.vertex(e.v).id, e.w});
      r.totalWeightM += e.w;
      record({0, "select", "", e.roadId, e.w, "mst-edge"});
    }
    for (const auto& e : adj[static_cast<std::size_t>(u)]) {
      r.relaxedEdges++;
      if (inMst[static_cast<std::size_t>(e.v)]) continue;
      std::int64_t oldW = key[static_cast<std::size_t>(e.v)];
      std::string oldR = parentEdge[static_cast<std::size_t>(e.v)] == -1
                             ? std::string("\xff")
                             : parentInfo[static_cast<std::size_t>(e.v)].roadId;
      if (better(e.w, e.roadId, oldW, oldR)) {
        key[static_cast<std::size_t>(e.v)] = e.w;
        parentEdge[static_cast<std::size_t>(e.v)] = 1;
        parentInfo[static_cast<std::size_t>(e.v)] = e;
        if (heap.contains(e.v)) {
          heap.update(e.v, e.w);
        } else {
          heap.push(e.v, e.w);
        }
        r.heapOps++;
      }
    }
  }
  r.forest = taken < n;
  return r;
}

}  // namespace pathforge
