// MST tests: Prim vs Kruskal weight oracle, determinism, traces, forest.
#include <gtest/gtest.h>

#include <random>
#include <set>

#include "pathforge/graph.hpp"
#include "pathforge/kruskal.hpp"
#include "pathforge/prim.hpp"

using namespace pathforge;

namespace {
Network small() {
  Network n;
  n.vertices = {{"a", "A", 0, 0}, {"b", "B", 0, 1}, {"c", "C", 1, 0}, {"d", "D", 1, 1}};
  n.roads = {
      {"ab", "a", "b", false, 4, 4, 0, 0, "x", true},
      {"ac", "a", "c", false, 3, 3, 0, 0, "x", true},
      {"bc", "b", "c", false, 2, 2, 0, 0, "x", true},
      {"bd", "b", "d", false, 5, 5, 0, 0, "x", true},
      {"cd", "c", "d", false, 6, 6, 0, 0, "x", true},
  };
  return n;
}
}  // namespace

TEST(Mst, PrimKruskalAgree) {
  auto built = Graph::build(small(), Overlay{});
  ASSERT_TRUE(built.second.empty());
  const Graph& g = built.first;
  MstResult p = primMst(g);
  MstResult k = kruskalMst(g);
  EXPECT_FALSE(p.forest || k.forest);
  EXPECT_EQ(p.totalWeightM, 10);  // ac(3) + bc(2) + bd(5)
  EXPECT_EQ(k.totalWeightM, p.totalWeightM);
  EXPECT_EQ(p.edges.size(), 3u);
  EXPECT_EQ(k.edges.size(), 3u);
  // Determinism: run twice.
  MstResult p2 = primMst(g);
  ASSERT_EQ(p.edges.size(), p2.edges.size());
  for (std::size_t i = 0; i < p.edges.size(); ++i) EXPECT_EQ(p.edges[i].roadId, p2.edges[i].roadId);
}

TEST(Mst, SeededRandomAgreement) {
  std::cout << "[mst-oracle] seed=20240\n";
  std::mt19937 rng(20240);
  for (int trial = 0; trial < 10; ++trial) {
    Network n;
    int v = 6 + static_cast<int>(rng() % 5);
    for (int i = 0; i < v; ++i)
      n.vertices.push_back({"v" + std::to_string(i), "", 0.0, 0.0});
    int r = 0;
    for (int i = 0; i < v; ++i) {
      for (int j = i + 1; j < v; ++j) {
        if (rng() % 100 < 45) {
          std::int64_t w = 1 + static_cast<std::int64_t>(rng() % 50);
          n.roads.push_back({"r" + std::to_string(r++), "v" + std::to_string(i),
                             "v" + std::to_string(j), false, w, w, 0, 0, "x", true});
        }
      }
    }
    // Ensure connectivity via a chain.
    for (int i = 0; i + 1 < v; ++i)
      n.roads.push_back({"chain" + std::to_string(i), "v" + std::to_string(i),
                         "v" + std::to_string(i + 1), false, 7, 7, 0, 0, "x", true});
    auto built = Graph::build(n, Overlay{});
    ASSERT_TRUE(built.second.empty());
    MstResult p = primMst(built.first);
    MstResult k = kruskalMst(built.first);
    EXPECT_EQ(p.totalWeightM, k.totalWeightM) << "trial " << trial;
    EXPECT_FALSE(p.forest);
  }
}

TEST(Mst, ForestOnDisconnected) {
  Network n;
  n.vertices = {{"a", "A", 0, 0}, {"b", "B", 0, 1}};
  n.roads = {};
  auto built = Graph::build(n, Overlay{});
  ASSERT_TRUE(built.second.empty());
  MstResult p = primMst(built.first);
  EXPECT_TRUE(p.forest);
  EXPECT_TRUE(p.edges.empty());
}
