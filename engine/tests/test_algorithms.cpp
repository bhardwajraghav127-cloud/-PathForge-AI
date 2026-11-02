// Multistop + topo + binsearch + lab.compare tests.
#include <gtest/gtest.h>

#include <algorithm>
#include <fstream>
#include <iostream>
#include <random>
#include <sstream>
#include <vector>

#include <nlohmann/json.hpp>

#include "pathforge/dijkstra.hpp"
#include "pathforge/engine.hpp"
#include "pathforge/graph.hpp"
#include "pathforge/lab.hpp"
#include "pathforge/multistop.hpp"

using nlohmann::json;
using namespace pathforge;

namespace {
Network square() {
  // Asymmetric directed costs: a->b cheap, b->a pricey.
  // Coordinates are geographically consistent (all corners within ~15 m, road
  // lengths 10-25 m) so the A* admissibility gate accepts this graph.
  Network n;
  n.vertices = {{"a", "A", 28.0, 77.0},
              {"b", "B", 28.0, 77.0001},
              {"c", "C", 28.0001, 77.0001},
              {"d", "D", 28.0001, 77.0}};
  n.roads = {
      {"ab", "a", "b", true, 10, 10, 0, 0, "x", true},
      {"ba", "b", "a", true, 10, 90, 0, 0, "x", true},
      {"bc", "b", "c", true, 10, 10, 0, 0, "x", true},
      {"cb", "c", "b", true, 10, 90, 0, 0, "x", true},
      {"cd", "c", "d", true, 10, 10, 0, 0, "x", true},
      {"dc", "d", "c", true, 10, 90, 0, 0, "x", true},
      {"da", "d", "a", true, 10, 10, 0, 0, "x", true},
      {"ad", "a", "d", true, 10, 90, 0, 0, "x", true},
      {"ac", "a", "c", true, 25, 25, 0, 0, "x", true},
  };
  return n;
}

// Brute-force permutation oracle (test-only).
std::int64_t bruteBest(const Graph& g, const std::vector<int>& stops, int start) {
  std::vector<std::vector<std::int64_t>> c(stops.size(),
                                           std::vector<std::int64_t>(stops.size(), kInf64));
  for (std::size_t i = 0; i < stops.size(); ++i) {
    std::vector<std::int64_t> dist;
    std::vector<int> hops;
    DijkstraStats st;
    auto parent = dijkstra(g, stops[i], CostModel::Fastest, dist, hops, st);
    (void)parent;
    for (std::size_t j = 0; j < stops.size(); ++j)
      c[i][j] = dist[static_cast<std::size_t>(stops[j])];
  }
  std::vector<int> perm;
  for (std::size_t i = 0; i < stops.size(); ++i) {
    if (static_cast<int>(i) != start) perm.push_back(static_cast<int>(i));
  }
  std::int64_t best = kInf64;
  do {
    __int128 t = 0;
    int prev = start;
    for (int q : perm) {
      t += c[static_cast<std::size_t>(prev)][static_cast<std::size_t>(q)];
      prev = q;
    }
    if (t < best) best = static_cast<std::int64_t>(t);
  } while (std::next_permutation(perm.begin(), perm.end()));
  return best;
}
}  // namespace

TEST(Multistop, ExactMatchesBruteForce) {
  auto built = Graph::build(square(), Overlay{});
  ASSERT_TRUE(built.second.empty());
  const Graph& g = built.first;
  std::vector<int> stops = {0, 1, 2, 3};
  MultistopResult r = multistop(g, stops, 0, -1, 10, true);
  ASSERT_TRUE(r.ok);
  EXPECT_TRUE(r.optimal);
  EXPECT_EQ(r.method, "held-karp");
  EXPECT_EQ(r.totalTimeS, bruteBest(g, stops, 0));
  // Legs chain: each leg starts where the previous ended.
  for (std::size_t i = 1; i < r.legs.size(); ++i)
    EXPECT_EQ(r.legs[i].from, r.legs[i - 1].to);
  EXPECT_EQ(r.order.front(), "a");
}

TEST(Multistop, StartEndTerminalsAndHeuristic) {
  auto built = Graph::build(square(), Overlay{});
  ASSERT_TRUE(built.second.empty());
  const Graph& g = built.first;
  std::vector<int> stops = {0, 1, 2, 3};
  MultistopResult r = multistop(g, stops, 1, 3, 10, true);
  ASSERT_TRUE(r.ok);
  EXPECT_EQ(r.order.front(), "b");
  EXPECT_EQ(r.order.back(), "d");
  // Heuristic path agrees on small instance.
  MultistopResult h = multistop(g, stops, 0, -1, 1, true);
  ASSERT_TRUE(h.ok);
  EXPECT_FALSE(h.optimal);
  EXPECT_EQ(h.totalTimeS, bruteBest(g, stops, 0));
}

TEST(LabExtra, TopoSortValidAndCycle) {
  Network n;
  n.vertices = {{"a", "A", 0, 0}, {"b", "B", 0, 1}, {"c", "C", 0, 2}};
  n.roads = {{"ab", "a", "b", true, 1, 1, 0, 0, "x", true},
             {"ac", "a", "c", true, 1, 1, 0, 0, "x", true},
             {"bc", "b", "c", true, 1, 1, 0, 0, "x", true}};
  auto built = Graph::build(n, Overlay{});
  ASSERT_TRUE(built.second.empty());
  BalancedParams bp;
  ResolvedObjective ro;
  ro.model = CostModel::Fastest;
  (void)bp;
  LabOutcome o = runLab(built.first, "TOPO_SORT", 0, -1, ro, 20000);
  ASSERT_TRUE(o.ok);
  EXPECT_FALSE(o.hasCycle);
  ASSERT_EQ(o.order.size(), 3u);
  EXPECT_EQ(o.order[0], "a");
  EXPECT_EQ(o.order[1], "b");
  EXPECT_EQ(o.order[2], "c");
  // Cycle detection.
  Network cyc = n;
  cyc.roads.push_back({"ca", "c", "a", true, 1, 1, 0, 0, "x", true});
  auto b2 = Graph::build(cyc, Overlay{});
  LabOutcome o2 = runLab(b2.first, "TOPO_SORT", 0, -1, ro, 20000);
  EXPECT_TRUE(o2.hasCycle);
  // Determinism.
  LabOutcome o3 = runLab(built.first, "TOPO_SORT", 0, -1, ro, 20000);
  EXPECT_EQ(o.order, o3.order);
}

TEST(LabExtra, BinsearchOracle) {
  std::cout << "[binsearch-oracle] seed=99\n";
  std::mt19937 rng(99);
  for (int t = 0; t < 20; ++t) {
    std::vector<std::int64_t> v(static_cast<std::size_t>(20 + rng() % 30));
    std::int64_t x = 0;
    for (auto& e : v) {
      x += static_cast<std::int64_t>(rng() % 10);
      e = x;
    }
    std::int64_t target = static_cast<std::int64_t>(rng() % 200);
    LabOutcome o = runBinsearch(v, target, 20000);
    ASSERT_TRUE(o.ok);
    auto it = std::lower_bound(v.begin(), v.end(), target);
    std::int64_t want = (it == v.end()) ? -1 : static_cast<std::int64_t>(it - v.begin());
    EXPECT_EQ(o.searchIndex, want) << "trial " << t;
    EXPECT_EQ(o.searchExact, want >= 0 && v[static_cast<std::size_t>(want)] == target);
  }
  // Unsorted rejected.
  LabOutcome bad = runBinsearch({3, 1, 2}, 2, 20000);
  EXPECT_FALSE(bad.ok);
  EXPECT_EQ(bad.errorCode, "SCHEMA_VIOLATION");
}

TEST(LabExtra, CompareDijkstraAStar) {
  auto built = Graph::build(square(), Overlay{});
  ASSERT_TRUE(built.second.empty());
  const Graph& g = built.first;
  BalancedParams bp;
  ResolvedObjective ro;
  ro.model = CostModel::Fastest;
  (void)bp;
  LabOutcome d = runLab(g, "DIJKSTRA", 0, 2, ro, 20000);
  LabOutcome a = runLab(g, "A_STAR", 0, 2, ro, 20000);
  ASSERT_TRUE(d.ok && a.ok);
  EXPECT_TRUE(d.hasRoute && a.hasRoute);
  EXPECT_EQ(d.route.objectiveCost, a.route.objectiveCost);
  // A* expands no more than Dijkstra on this admissible graph.
  EXPECT_LE(a.expandedVertices, d.stats.visitedVertices);
}

TEST(Multistop, DatasetFourStopNontrivial) {
  // 4-stop exact optimum differs from the given stop order (guarantee 9).
  std::string dir = PF_DATASET_DIR;
  std::ifstream in(dir + "/sample-networks/north-india-sim-v1.json");
  ASSERT_TRUE(in.good());
  std::ostringstream ss;
  ss << in.rdbuf();
  json j = json::parse(ss.str());
  Network n;
  for (const auto& v : j.at("vertices"))
    n.vertices.push_back({v.at("id").get<std::string>(), "", v.at("lat").get<double>(),
                          v.at("lon").get<double>()});
  for (const auto& r : j.at("roads"))
    n.roads.push_back({r.at("id").get<std::string>(), r.at("from").get<std::string>(),
                       r.at("to").get<std::string>(), r.value("oneWay", false),
                       r.at("distanceM").get<std::int64_t>(),
                       r.at("baselineTimeS").get<std::int64_t>(), 0, 0, "", true});
  Graph g = Graph::build(n, Overlay{}).first;
  auto vi = [&](const std::string& id) { return g.vertexIndex(id); };
  // Awkward input order: starting at Delhi, the greedy input sequence
  // delhi, chandigarh, karnal, ambala is not the optimum.
  std::vector<int> stops = {vi("delhi"), vi("chandigarh"), vi("karnal"), vi("ambala")};
  MultistopResult r = multistop(g, stops, 0, -1, 10, true);
  ASSERT_TRUE(r.ok);
  EXPECT_TRUE(r.optimal);
  std::vector<std::string> inputOrder = {"delhi", "chandigarh", "karnal", "ambala"};
  EXPECT_NE(r.order, inputOrder);
}
