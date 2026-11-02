// Dijkstra unit tests: oracle comparison + tie-breaks + edge cases.
#include <gtest/gtest.h>

#include <vector>

#include "pathforge/dijkstra.hpp"
#include "pathforge/graph.hpp"

using namespace pathforge;

namespace {

Network diamond() {
  // s -> a (1s), s -> b (1s), a -> t (1s), b -> t (1s): equal-cost tie.
  Network n;
  n.vertices = {{"s", "S", 0, 0}, {"a", "A", 0, 1}, {"b", "B", 1, 0}, {"t", "T", 1, 1}};
  n.roads = {
      {"r1", "s", "a", true, 1000, 10, 0, 0, "r1", true},
      {"r2", "s", "b", true, 1000, 10, 0, 0, "r2", true},
      {"r3", "a", "t", true, 1000, 10, 0, 0, "r3", true},
      {"r4", "b", "t", true, 1000, 10, 0, 0, "r4", true},
  };
  return n;
}

TEST(Dijkstra, TieBreakFewerHopsAndLexicographic) {
  auto built = Graph::build(diamond(), Overlay{});
  ASSERT_TRUE(built.second.empty());
  const Graph& g = built.first;
  int si = g.vertexIndex("s");
  int di = g.vertexIndex("t");
  std::vector<std::int64_t> dist;
  std::vector<int> hops;
  DijkstraStats st;
  auto parent = dijkstra(g, si, CostModel::Fastest, dist, hops, st);
  RouteResult r = buildRoute(g, si, di, CostModel::Fastest, parent, dist, st, "d");
  ASSERT_TRUE(r.found);
  EXPECT_EQ(r.timeS, 20);
  ASSERT_EQ(r.arcs.size(), 2u);
  // Both 2-hop paths cost 20s; lexicographically smaller arc sequence wins:
  // ["r1:f","r3:f"] < ["r2:f","r4:f"].
  EXPECT_EQ(r.arcs[0].arcId, "r1:f");
  EXPECT_EQ(r.arcs[1].arcId, "r3:f");
}

TEST(Dijkstra, Unreachable) {
  Network n;
  n.vertices = {{"a", "A", 0, 0}, {"b", "B", 0, 1}};
  n.roads = {};
  auto built = Graph::build(n, Overlay{});
  ASSERT_TRUE(built.second.empty());
  const Graph& g = built.first;
  std::vector<std::int64_t> dist;
  std::vector<int> hops;
  DijkstraStats st;
  auto parent = dijkstra(g, 0, CostModel::Shortest, dist, hops, st);
  RouteResult r = buildRoute(g, 0, 1, CostModel::Shortest, parent, dist, st, "d");
  EXPECT_FALSE(r.found);
  EXPECT_EQ(r.reason, "UNREACHABLE");
}

TEST(Dijkstra, OneWayRespectedAndClosure) {
  Network n;
  n.vertices = {{"a", "A", 0, 0}, {"b", "B", 0, 1}};
  n.roads = {{"r1", "a", "b", true, 500, 30, 60, 0, "r1", true}};
  // Reverse must be unreachable (one-way).
  auto built = Graph::build(n, Overlay{});
  ASSERT_TRUE(built.second.empty());
  const Graph& g = built.first;
  std::vector<std::int64_t> dist;
  std::vector<int> hops;
  DijkstraStats st;
  auto parent = dijkstra(g, g.vertexIndex("b"), CostModel::Fastest, dist, hops, st);
  RouteResult r = buildRoute(g, g.vertexIndex("b"), g.vertexIndex("a"), CostModel::Fastest,
                            parent, dist, st, "d");
  EXPECT_FALSE(r.found);
  // Forward works until closed.
  Overlay ov;
  ov.closures = {"r1"};
  auto shut = Graph::build(n, ov);
  ASSERT_TRUE(shut.second.empty());
  const Graph& g2 = shut.first;
  std::vector<std::int64_t> d2;
  std::vector<int> h2;
  DijkstraStats s2;
  auto p2 = dijkstra(g2, g2.vertexIndex("a"), CostModel::Fastest, d2, h2, s2);
  RouteResult r2 =
      buildRoute(g2, g2.vertexIndex("a"), g2.vertexIndex("b"), CostModel::Fastest, p2, d2, s2, "d");
  EXPECT_FALSE(r2.found);
}

TEST(Dijkstra, TrafficFactorAndObjectiveDiffer) {
  Network n;
  n.vertices = {{"s", "S", 0, 0}, {"m", "M", 0, 1}, {"t", "T", 0, 2}};
  // Direct: 100m but 100s baseline; via m: 200m but 2x10s = 20s.
  n.roads = {
      {"direct", "s", "t", true, 100, 100, 0, 0, "direct", true},
      {"s-m", "s", "m", true, 100, 10, 0, 0, "s-m", true},
      {"m-t", "m", "t", true, 100, 10, 0, 0, "m-t", true},
  };
  auto built = Graph::build(n, Overlay{});
  ASSERT_TRUE(built.second.empty());
  const Graph& g = built.first;
  std::vector<std::int64_t> dist;
  std::vector<int> hops;
  DijkstraStats st;
  auto pf = dijkstra(g, 0, CostModel::Fastest, dist, hops, st);
  RouteResult rf = buildRoute(g, 0, 2, CostModel::Fastest, pf, dist, st, "f");
  EXPECT_TRUE(rf.found);
  EXPECT_EQ(rf.timeS, 20);
  auto ps = dijkstra(g, 0, CostModel::Shortest, dist, hops, st);
  RouteResult rs = buildRoute(g, 0, 2, CostModel::Shortest, ps, dist, st, "s");
  EXPECT_TRUE(rs.found);
  EXPECT_EQ(rs.distanceM, 100);
  EXPECT_EQ(rs.arcs[0].roadId, "direct");
}

}  // namespace
