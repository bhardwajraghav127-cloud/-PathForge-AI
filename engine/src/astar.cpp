// A* implementation.
#include "pathforge/astar.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <queue>
#include <vector>

#include "pathforge/dijkstra.hpp"
#include "pathforge/objectives.hpp"

namespace pathforge {
namespace {

constexpr double kEarthM = 6371000.0;
constexpr double kPi = 3.14159265358979323846;

double rad(double d) { return d * kPi / 180.0; }

struct AEntry {
  std::int64_t f = 0;
  std::int64_t g = 0;
  int hops = 0;
  int vertex = -1;
};
bool aGreater(const AEntry& a, const AEntry& b) {
  if (a.f != b.f) return a.f > b.f;
  if (a.g != b.g) return a.g > b.g;
  return a.vertex > b.vertex;
}

}  // namespace

double haversineM(double lat1, double lon1, double lat2, double lon2) {
  double dLat = rad(lat2 - lat1);
  double dLon = rad(lon2 - lon1);
  double s = std::sin(dLat / 2) * std::sin(dLat / 2) +
             std::cos(rad(lat1)) * std::cos(rad(lat2)) * std::sin(dLon / 2) * std::sin(dLon / 2);
  return 2 * kEarthM * std::asin(std::min(1.0, std::sqrt(s)));
}

AStarOutcome astar(const Graph& g, int srcIdx, int dstIdx, CostModel model,
                   std::int64_t maxEvents, std::int64_t initialG) {
  AStarOutcome o;
  auto record = [&](TraceEvent e) {
    if (static_cast<std::int64_t>(o.trace.size()) >= maxEvents) {
      o.stats.traceTruncated = true;
      return;
    }
    e.step = static_cast<std::int64_t>(o.trace.size());
    o.trace.push_back(e);
  };
  const int n = g.vertexCount();
  const double tLat = g.vertex(dstIdx).lat;
  const double tLon = g.vertex(dstIdx).lon;

  // Admissibility gate over usable arcs.
  for (int i = 0; i < g.arcCount(); ++i) {
    EffectiveCost c = g.cost(i);
    if (!c.usable) continue;
    const Arc& a = g.arc(i);
    double hav = haversineM(g.vertex(a.from).lat, g.vertex(a.from).lon,
                            g.vertex(a.to).lat, g.vertex(a.to).lon);
    double tol = std::max(100.0, 0.01 * hav);
    if (static_cast<double>(c.distanceM) < hav - tol) {
      o.detail = "road " + a.roadId + " shorter than straight-line distance (beyond tolerance)";
      return o;
    }
  }

  // Heuristic per model.
  std::vector<std::int64_t> h(static_cast<std::size_t>(n), 0);
  if (model == CostModel::Shortest) {
    for (int v = 0; v < n; ++v) {
      // Epsilon guard: a double rounding up across an integer boundary would
      // otherwise overestimate and break admissibility.
      double hav = haversineM(g.vertex(v).lat, g.vertex(v).lon, tLat, tLon);
      std::int64_t hh = static_cast<std::int64_t>(std::floor(hav - 1e-6));
      h[static_cast<std::size_t>(v)] = hh < 0 ? 0 : hh;
    }
  } else if (model == CostModel::Fastest) {
    bool unbounded = false;
    std::int64_t minMsPerM = kInf64;
    for (int i = 0; i < g.arcCount(); ++i) {
      EffectiveCost c = g.cost(i);
      if (!c.usable || c.distanceM <= 0) continue;
      if (c.baselineTimeS == 0) {
        unbounded = true;
        break;
      }
      std::int64_t msPerM =
          static_cast<std::int64_t>((static_cast<__int128>(c.baselineTimeS) * 1000) / c.distanceM);
      if (msPerM < minMsPerM) minMsPerM = msPerM;
    }
    if (!unbounded && minMsPerM != kInf64) {
      for (int v = 0; v < n; ++v) {
        double hav = haversineM(g.vertex(v).lat, g.vertex(v).lon, tLat, tLon);
        // Millimetre guard: double arithmetic may round UP across the bound.
        std::int64_t hv = static_cast<std::int64_t>(std::floor(hav * 1000.0 - 1.0));
        if (hv < 0) hv = 0;
        __int128 hh = static_cast<__int128>(hv) * minMsPerM / 1000000;
        h[static_cast<std::size_t>(v)] =
            hh > static_cast<__int128>(kInf64) ? kInf64 : static_cast<std::int64_t>(hh);
      }
    } else {
      o.heuristicZero = true;  // unbounded speed or no usable arcs
    }
  } else {
    o.heuristicZero = true;
  }

  o.dist.assign(static_cast<std::size_t>(n), kInf64);
  o.hops.assign(static_cast<std::size_t>(n), std::numeric_limits<int>::max());
  o.parent.assign(static_cast<std::size_t>(n), -1);
  std::vector<char> closed(static_cast<std::size_t>(n), 0);
  o.dist[static_cast<std::size_t>(srcIdx)] = initialG;
  o.hops[static_cast<std::size_t>(srcIdx)] = 0;

  auto arcW = [&](int ai) -> std::int64_t { return arcPrimary(g.cost(ai), model); };

  std::priority_queue<AEntry, std::vector<AEntry>, decltype(&aGreater)> pq(&aGreater);
  __int128 f0 = static_cast<__int128>(initialG) + h[static_cast<std::size_t>(srcIdx)];
  pq.push({f0 > static_cast<__int128>(kInf64) ? kInf64 : static_cast<std::int64_t>(f0), initialG,
           0, srcIdx});
  o.stats.heapOps++;

  while (!pq.empty()) {
    AEntry cur = pq.top();
    pq.pop();
    int u = cur.vertex;
    if (closed[static_cast<std::size_t>(u)]) continue;
    if (cur.g != o.dist[static_cast<std::size_t>(u)]) continue;  // stale
    closed[static_cast<std::size_t>(u)] = 1;
    o.stats.visitedVertices++;
    o.expandedVertices++;
    record({0, "visit", g.vertex(u).id, "", cur.g, ""});
    if (u == dstIdx) break;
    for (int ai : g.outgoing(u)) {
      o.stats.relaxedEdges++;
      const Arc& a = g.arc(ai);
      int v = a.to;
      if (closed[static_cast<std::size_t>(v)]) continue;
      EffectiveCost c = g.cost(ai);
      if (!c.usable) continue;
      std::int64_t w = arcW(ai);
      __int128 ng128 = static_cast<__int128>(o.dist[static_cast<std::size_t>(u)]) + w;
      std::int64_t ng =
          ng128 > static_cast<__int128>(kInf64) ? kInf64 : static_cast<std::int64_t>(ng128);
      int nh = o.hops[static_cast<std::size_t>(u)] + 1;
      __int128 nf128 = ng128 + h[static_cast<std::size_t>(v)];
      std::int64_t nf =
          nf128 > static_cast<__int128>(kInf64) ? kInf64 : static_cast<std::int64_t>(nf128);
      std::int64_t og = o.dist[static_cast<std::size_t>(v)];
      if (ng < og || (ng == og && nh < o.hops[static_cast<std::size_t>(v)])) {
        o.dist[static_cast<std::size_t>(v)] = ng;
        o.hops[static_cast<std::size_t>(v)] = nh;
        o.parent[static_cast<std::size_t>(v)] = ai;
        pq.push({nf, ng, nh, v});
        o.stats.heapOps++;
        record({0, "relax", g.vertex(v).id, g.arc(ai).id, ng, ""});
      } else if (ng == og && nh == o.hops[static_cast<std::size_t>(v)] && og != kInf64) {
        if (pathLess(g, o.parent, u, ai)) o.parent[static_cast<std::size_t>(v)] = ai;
      }
    }
  }
  o.ok = true;
  o.detail = "A* complete";
  return o;
}

}  // namespace pathforge
