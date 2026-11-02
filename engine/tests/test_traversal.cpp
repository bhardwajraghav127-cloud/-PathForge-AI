// Traversal tests: order, determinism, BFS-vs-Dijkstra oracle.
#include <gtest/gtest.h>

#include "pathforge/dijkstra.hpp"
#include "pathforge/graph.hpp"
#include "pathforge/traversal.hpp"

using namespace pathforge;

namespace {

Network diamond() {
  Network n;
  n.vertices = {{"s", "S", 0, 0}, {"a", "A", 0, 1}, {"b", "B", 1, 0}, {"t", "T", 1, 1}};
  n.roads = {
      {"r1", "s", "a", true, 5, 5, 0, 0, "r1", true},
      {"r2", "s", "b", true, 5, 5, 0, 0, "r2", true},
      {"r3", "a", "t", true, 5, 5, 0, 0, "r3", true},
      {"r4", "b", "t", true, 5, 5, 0, 0, "r4", true},
  };
  return n;
}

}  // namespace

TEST(Traversal, BfsLevelOrder) {
  auto built = Graph::build(diamond(), Overlay{});
  ASSERT_TRUE(built.second.empty());
  TraversalResult t = bfs(built.first, built.first.vertexIndex("s"));
  ASSERT_EQ(t.order.size(), 4u);
  EXPECT_EQ(t.order[0], "s");
  // Canonical adjacency: s->a before s->b; a->t before b->t.
  EXPECT_EQ(t.order[1], "a");
  EXPECT_EQ(t.order[2], "b");
  EXPECT_EQ(t.order[3], "t");
  EXPECT_FALSE(t.truncated);
  // Trace steps are dense from 0.
  for (std::size_t i = 0; i < t.trace.size(); ++i)
    EXPECT_EQ(t.trace[i].step, static_cast<std::int64_t>(i));
}

TEST(Traversal, DfsReachesAll) {
  auto built = Graph::build(diamond(), Overlay{});
  ASSERT_TRUE(built.second.empty());
  TraversalResult t = dfs(built.first, built.first.vertexIndex("s"));
  EXPECT_EQ(t.order.size(), 4u);
  EXPECT_EQ(t.order[0], "s");
  // Depth-first from s goes s,a,t then b (canonical pop order).
  EXPECT_EQ(t.order[1], "a");
  EXPECT_EQ(t.order[2], "t");
  EXPECT_EQ(t.order[3], "b");
}

TEST(Traversal, BfsMatchesDijkstraUnitWeights) {
  // Unit distances: BFS hops must equal Dijkstra SHORTEST metres.
  Network n;
  n.vertices = {{"0", "0", 0, 0}, {"1", "1", 0, 1}, {"2", "2", 0, 2}, {"3", "3", 0, 3}};
  n.roads = {
      {"e01", "0", "1", false, 1, 1, 0, 0, "e01", true},
      {"e12", "1", "2", false, 1, 1, 0, 0, "e12", true},
      {"e23", "2", "3", false, 1, 1, 0, 0, "e23", true},
      {"e03", "0", "3", false, 1, 1, 0, 0, "e03", true},
  };
  auto built = Graph::build(n, Overlay{});
  ASSERT_TRUE(built.second.empty());
  const Graph& g = built.first;
  TraversalResult t = bfs(g, 0);
  std::vector<std::int64_t> dist;
  std::vector<int> hops;
  DijkstraStats st;
  auto parent = dijkstra(g, 0, CostModel::Shortest, dist, hops, st);
  for (int v = 0; v < g.vertexCount(); ++v)
    EXPECT_EQ(t.dist[static_cast<std::size_t>(v)], dist[static_cast<std::size_t>(v)])
        << "vertex " << v;
}

TEST(Traversal, TraceCapWarns) {
  auto built = Graph::build(diamond(), Overlay{});
  ASSERT_TRUE(built.second.empty());
  TraversalResult t = bfs(built.first, 0, 2);
  EXPECT_TRUE(t.truncated);
  EXPECT_LE(static_cast<std::int64_t>(t.trace.size()), 2);
}
