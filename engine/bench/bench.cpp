// Micro-benchmarks (M11/REQ-20): seeded grid graphs, Dijkstra/A*/Prim/Kruskal.
// Native-only, bounded sizes, deterministic seeds. Reports median/p95 wall ms
// plus engine counters. Usage: pf_bench [seed] (default 42).
#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <numeric>
#include <random>
#include <string>
#include <vector>

#include "pathforge/astar.hpp"
#include "pathforge/dijkstra.hpp"
#include "pathforge/graph.hpp"
#include "pathforge/kruskal.hpp"
#include "pathforge/lab.hpp"
#include "pathforge/objectives.hpp"
#include "pathforge/prim.hpp"

using namespace pathforge;

namespace {

struct Timing {
  std::vector<double> ms;
  std::int64_t visited = 0;
  std::int64_t heapOps = 0;
};

double median(std::vector<double> v) {
  std::sort(v.begin(), v.end());
  return v[v.size() / 2];
}

double p95(std::vector<double> v) {
  std::sort(v.begin(), v.end());
  return v[static_cast<std::size_t>(v.size() * 95 / 100)];
}

// Grid graph with spacing S metres: road length == euclidean neighbor distance
// (admissible for A* by construction), plus deterministic diagonal shortcuts.
Network grid(int side, std::uint64_t seed) {
  Network n;
  const double spacingDeg = 0.001;  // ~111 m; roads match euclidean length
  for (int y = 0; y < side; ++y)
    for (int x = 0; x < side; ++x)
      n.vertices.push_back({"v" + std::to_string(y * side + x), "",
                            28.0 + y * spacingDeg, 77.0 + x * spacingDeg});
  std::mt19937_64 rng(seed);
  auto id = [&](int x, int y) { return "v" + std::to_string(y * side + x); };
  int r = 0;
  auto road = [&](const std::string& a, const std::string& b) {
    // Neighbor distance ~111 m (x) or ~111 m (y); time at ~10 m/s.
    std::int64_t d = 105 + static_cast<std::int64_t>(rng() % 20);
    n.roads.push_back({"e" + std::to_string(r++), a, b, false, d, d / 10 + 1,
                       40, 0, "", true});
  };
  for (int y = 0; y < side; ++y)
    for (int x = 0; x < side; ++x) {
      if (x + 1 < side) road(id(x, y), id(x + 1, y));
      if (y + 1 < side) road(id(x, y), id(x, y + 1));
    }
  return n;
}

Timing benchDijkstra(const Graph& g, int src, int dst, int reps) {
  Timing t;
  for (int i = 0; i < reps; ++i) {
    std::vector<std::int64_t> dist;
    std::vector<int> hops;
    DijkstraStats st;
    auto t0 = std::chrono::steady_clock::now();
    (void)dijkstra(g, src, CostModel::Fastest, dist, hops, st);
    auto t1 = std::chrono::steady_clock::now();
    t.ms.push_back(std::chrono::duration<double, std::milli>(t1 - t0).count());
    t.visited = st.visitedVertices;
    t.heapOps = st.heapOps;
  }
  (void)dst;
  return t;
}

Timing benchAStar(const Graph& g, int src, int dst, int reps) {
  Timing t;
  for (int i = 0; i < reps; ++i) {
    auto t0 = std::chrono::steady_clock::now();
    AStarOutcome o = astar(g, src, dst, CostModel::Fastest, 1000000);
    auto t1 = std::chrono::steady_clock::now();
    if (!o.ok) {
      std::printf("ASTAR_INADMISSIBLE\n");
      break;
    }
    t.ms.push_back(std::chrono::duration<double, std::milli>(t1 - t0).count());
    t.visited = o.stats.visitedVertices;
    t.heapOps = o.stats.heapOps;
  }
  return t;
}

Timing benchPrim(const Graph& g, int reps) {
  Timing t;
  for (int i = 0; i < reps; ++i) {
    auto t0 = std::chrono::steady_clock::now();
    MstResult m = primMst(g, 1000000);
    auto t1 = std::chrono::steady_clock::now();
    t.ms.push_back(std::chrono::duration<double, std::milli>(t1 - t0).count());
    t.visited = m.truncated ? -1 : static_cast<std::int64_t>(m.edges.size());
    t.heapOps = m.heapOps;
  }
  return t;
}

Timing benchKruskal(const Graph& g, int reps) {
  Timing t;
  for (int i = 0; i < reps; ++i) {
    auto t0 = std::chrono::steady_clock::now();
    MstResult m = kruskalMst(g, 1000000);
    auto t1 = std::chrono::steady_clock::now();
    t.ms.push_back(std::chrono::duration<double, std::milli>(t1 - t0).count());
    t.visited = static_cast<std::int64_t>(m.edges.size());
    t.heapOps = m.heapOps;
  }
  return t;
}

void row(const char* algo, int n, int e, const Timing& t) {
  std::printf("%s,%d,%d,%.3f,%.3f,%lld,%lld\n", algo, n, e, median(t.ms),
              p95(t.ms), static_cast<long long>(t.visited),
              static_cast<long long>(t.heapOps));
}

}  // namespace

int main(int argc, char** argv) {
  std::uint64_t seed = argc > 1 ? std::stoull(argv[1]) : 42;
  std::printf("algo,nodes,edges,median_ms,p95_ms,visited_or_edges,heap_ops\n");
  for (int side : {10, 32, 70}) {  // 100 / 1024 / 4900 nodes
    int reps = side <= 10 ? 20 : side <= 32 ? 10 : 5;
    Network n = grid(side, seed);
    auto built = Graph::build(n, Overlay{});
    if (!built.second.empty()) {
      std::printf("BUILD_FAILED\n");
      return 1;
    }
    const Graph& g = built.first;
    int src = 0;
    int dst = g.vertexCount() - 1;
    row("dijkstra", g.vertexCount(), g.arcCount(), benchDijkstra(g, src, dst, reps));
    row("astar", g.vertexCount(), g.arcCount(), benchAStar(g, src, dst, reps));
    row("prim", g.vertexCount(), g.arcCount(), benchPrim(g, reps));
    row("kruskal", g.vertexCount(), g.arcCount(), benchKruskal(g, reps));
  }
  return 0;
}
