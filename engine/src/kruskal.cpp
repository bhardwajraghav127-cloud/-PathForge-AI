// Kruskal's algorithm with indexed DSU.
#include "pathforge/kruskal.hpp"

#include <algorithm>
#include <set>

namespace pathforge {

MstResult kruskalMst(const Graph& g, std::int64_t maxEvents) {
  MstResult r;
  const int n = g.vertexCount();
  if (n == 0) return r;
  if (maxEvents < 1) maxEvents = 1;
  auto record = [&](const TraceEvent& e) {
    if (static_cast<std::int64_t>(r.trace.size()) >= maxEvents) {
      r.truncated = true;
      return;
    }
    TraceEvent c = e;
    c.step = static_cast<std::int64_t>(r.trace.size());
    r.trace.push_back(c);
  };
  struct E {
    std::int64_t w = 0;
    std::string roadId;
    int u = -1;
    int v = -1;
  };
  std::vector<E> edges;
  std::set<std::string> seen;
  for (int i = 0; i < g.arcCount(); ++i) {
    const Arc& a = g.arc(i);
    if (!a.forward || seen.count(a.roadId) > 0) continue;
    seen.insert(a.roadId);
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
    edges.push_back({g.roadOf(i).distanceM, a.roadId, a.from, a.to});
  }
  std::sort(edges.begin(), edges.end(), [](const E& a, const E& b) {
    if (a.w != b.w) return a.w < b.w;
    return a.roadId < b.roadId;
  });
  Dsu dsu(n);
  for (const auto& e : edges) {
    if (dsu.unite(e.u, e.v)) {
      r.edges.push_back({e.roadId, g.vertex(e.u).id, g.vertex(e.v).id, e.w});
      r.totalWeightM += e.w;
      record({0, "select", "", e.roadId, e.w, "mst-edge"});
    }
    if (static_cast<int>(r.edges.size()) == n - 1) break;
  }
  r.forest = static_cast<int>(r.edges.size()) < n - 1;
  return r;
}

}  // namespace pathforge
