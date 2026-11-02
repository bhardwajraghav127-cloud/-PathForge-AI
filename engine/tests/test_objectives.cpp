// Objective tests: toll lexicographic order, avoid-congestion penalties,
// balanced weights/scales, and validation errors.
#include <gtest/gtest.h>

#include <vector>

#include "pathforge/dijkstra.hpp"
#include "pathforge/graph.hpp"
#include "pathforge/objectives.hpp"

using namespace pathforge;

namespace {

Network tollNet() {
  // Tolled fast (toll 500, 10s) vs free slow (toll 0, 100s).
  Network n;
  n.vertices = {{"s", "S", 0, 0}, {"t", "T", 0, 1}};
  n.roads = {
      {"fast", "s", "t", true, 1000, 10, 0, 500, "fast", true},
      {"free", "s", "t", true, 1000, 100, 0, 0, "free", true},
  };
  return n;
}

}  // namespace

TEST(Objectives, LowestTollPicksFree) {
  auto built = Graph::build(tollNet(), Overlay{});
  ASSERT_TRUE(built.second.empty());
  const Graph& g = built.first;
  std::vector<TollLabel> dist;
  std::vector<int> hops;
  DijkstraStats st;
  auto parent = dijkstraToll(g, 0, dist, hops, st);
  RouteResult r = buildRouteToll(g, 0, 1, parent, dist, st, "toll");
  ASSERT_TRUE(r.found);
  EXPECT_EQ(r.tollInr, 0);
  EXPECT_EQ(r.timeS, 100);
  EXPECT_TRUE(r.hasObjectiveTuple);
  EXPECT_EQ(r.objectiveTuple.toll, 0);
  // Toll tie broken by time: add an equally-free but slower road.
  Network n = tollNet();
  n.roads.push_back({"free2", "s", "t", true, 1000, 200, 0, 0, "free2", true});
  auto b2 = Graph::build(n, Overlay{});
  ASSERT_TRUE(b2.second.empty());
  std::vector<TollLabel> d2;
  std::vector<int> h2;
  DijkstraStats s2;
  auto p2 = dijkstraToll(b2.first, 0, d2, h2, s2);
  RouteResult r2 = buildRouteToll(b2.first, 0, 1, p2, d2, s2, "toll");
  ASSERT_TRUE(r2.found);
  EXPECT_EQ(r2.timeS, 100);  // faster of the two free roads
}

TEST(Objectives, AvoidCongestionBeatsJam) {
  Network n;
  n.vertices = {{"s", "S", 0, 0}, {"t", "T", 0, 1}};
  // jammed: 10s baseline at factor 400 (heavy) -> 25s x2.5 = 62 (rounded);
  // clear: 60s baseline free -> 60. Avoid picks clear.
  n.roads = {
      {"jammed", "s", "t", true, 1000, 10, 0, 0, "jammed", true},
      {"clear", "s", "t", true, 1000, 60, 0, 0, "clear", true},
  };
  Overlay ov;
  ov.factors = {{"jammed", 400}};
  auto built = Graph::build(n, ov);
  ASSERT_TRUE(built.second.empty());
  const Graph& g = built.first;
  BalancedParams bp;
  ResolvedObjective ro = resolveObjective(g, "AVOID_CONGESTION", bp);
  ASSERT_TRUE(ro.error.empty());
  auto costFn = [&](int ai) { return scalarArcCost(g, ai, ro, g.factorPermille(ai)); };
  // Arc order is canonical by ID: 0 = "clear:f", 1 = "jammed:f".
  EXPECT_GT(costFn(1), costFn(0));
  std::vector<std::int64_t> dist;
  std::vector<int> hops;
  DijkstraStats st;
  auto parent = dijkstraScalar(g, 0, costFn, dist, hops, st);
  RouteResult r = buildRoute(g, 0, 1, CostModel::AvoidCongestion, parent, dist, st, "a");
  ASSERT_TRUE(r.found);
  EXPECT_EQ(r.arcs[0].roadId, "clear");
}

TEST(Objectives, AvoidSevereFallback) {
  Network n;
  n.vertices = {{"s", "S", 0, 0}, {"t", "T", 0, 1}};
  n.roads = {{"only", "s", "t", true, 100, 10, 0, 0, "only", true}};
  Overlay ov;
  ov.factors = {{"only", 150}};  // severe
  auto built = Graph::build(n, ov);
  ASSERT_TRUE(built.second.empty());
  const Graph& g = built.first;
  BalancedParams bp;
  bp.avoidSevere = true;
  ResolvedObjective ro = resolveObjective(g, "AVOID_CONGESTION", bp);
  ASSERT_TRUE(ro.error.empty());
  auto costFn = [&](int ai) {
    if (classify(g.factorPermille(ai)) == CongestionClass::Severe) return kInf64;
    return scalarArcCost(g, ai, ro, g.factorPermille(ai));
  };
  std::vector<std::int64_t> dist;
  std::vector<int> hops;
  DijkstraStats st;
  auto parent = dijkstraScalar(g, 0, costFn, dist, hops, st);
  RouteResult r = buildRoute(g, 0, 1, CostModel::AvoidCongestion, parent, dist, st, "a");
  EXPECT_FALSE(r.found);
  EXPECT_EQ(r.reason, "UNREACHABLE");
}

TEST(Objectives, BalancedWeightsAndValidation) {
  auto built = Graph::build(tollNet(), Overlay{});
  ASSERT_TRUE(built.second.empty());
  const Graph& g = built.first;
  BalancedParams bp;
  bp.wTime = 1;
  bp.wDist = 1;
  bp.wToll = 1;
  ResolvedObjective ro = resolveObjective(g, "BALANCED", bp);
  ASSERT_TRUE(ro.error.empty());
  EXPECT_EQ(ro.normWTime + ro.normWDist + ro.normWToll, 1000000);
  EXPECT_GT(ro.scales.sTime, 0);
  // All-zero rejected; negative rejected.
  BalancedParams bad;
  EXPECT_FALSE(resolveObjective(g, "BALANCED", bad).error.empty());
  BalancedParams neg;
  neg.wTime = -1;
  EXPECT_FALSE(resolveObjective(g, "BALANCED", neg).error.empty());
  // Unknown objective rejected.
  EXPECT_FALSE(resolveObjective(g, "WARP", BalancedParams{}).error.empty());
}
