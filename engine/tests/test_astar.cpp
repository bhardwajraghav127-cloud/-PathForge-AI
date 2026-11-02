// A* tests: Dijkstra agreement on seeded admissible graphs, gate, edge cases.
#include <gtest/gtest.h>

#include <cmath>
#include <iostream>
#include <random>

#include "pathforge/astar.hpp"
#include "pathforge/dijkstra.hpp"
#include "pathforge/graph.hpp"

using namespace pathforge;

namespace {

// Grid graph with guaranteed-admissible distances (distanceM >= haversine).
// Prints the seed (R11: seed and print random test seeds).
Network randomAdmissible(unsigned seed, int grid, double detourLo, double detourHi) {
  std::cout << "[astar-oracle] seed=" << seed << "\n";
  std::mt19937 rng(seed);
  std::uniform_real_distribution<double> det(detourLo, detourHi);
  std::uniform_real_distribution<double> speed(8.0, 20.0);  // m/s
  Network n;
  auto id = [&](int x, int y) { return "v" + std::to_string(x) + "_" + std::to_string(y); };
  for (int x = 0; x < grid; ++x)
    for (int y = 0; y < grid; ++y)
      n.vertices.push_back({id(x, y), id(x, y), x * 0.01, y * 0.01});
  int r = 0;
  for (int x = 0; x < grid; ++x)
    for (int y = 0; y < grid; ++y) {
      if (x + 1 < grid) {
        double hav = haversineM(x * 0.01, y * 0.01, (x + 1) * 0.01, y * 0.01);
        std::int64_t d = static_cast<std::int64_t>(std::ceil(hav * det(rng)));
        std::int64_t t = static_cast<std::int64_t>(std::ceil(static_cast<double>(d) / speed(rng)));
        n.roads.push_back({"r" + std::to_string(r++), id(x, y), id(x + 1, y), false, d,
                           t < 1 ? 1 : t, 0, 0, "sim", true});
      }
      if (y + 1 < grid) {
        double hav = haversineM(x * 0.01, y * 0.01, x * 0.01, (y + 1) * 0.01);
        std::int64_t d = static_cast<std::int64_t>(std::ceil(hav * det(rng)));
        std::int64_t t = static_cast<std::int64_t>(std::ceil(static_cast<double>(d) / speed(rng)));
        n.roads.push_back({"r" + std::to_string(r++), id(x, y), id(x, y + 1), false, d,
                           t < 1 ? 1 : t, 0, 0, "sim", true});
      }
    }
  return n;
}

}  // namespace

TEST(AStar, AgreesWithDijkstraSeeded) {
  for (unsigned seed : {7u, 42u, 1234u}) {
    Network n = randomAdmissible(seed, 4, 1.0, 1.5);
    auto built = Graph::build(n, Overlay{});
    ASSERT_TRUE(built.second.empty()) << "seed " << seed;
    const Graph& g = built.first;
    int si = 0;
    int di = g.vertexCount() - 1;
    for (CostModel m : {CostModel::Fastest, CostModel::Shortest}) {
      std::vector<std::int64_t> dd;
      std::vector<int> hd;
      DijkstraStats sd;
      auto pd = dijkstra(g, si, m, dd, hd, sd);
      RouteResult rd = buildRoute(g, si, di, m, pd, dd, sd, "d");
      AStarOutcome a = astar(g, si, di, m);
      ASSERT_TRUE(a.ok) << "seed " << seed;
      RouteResult ra = buildRoute(g, si, di, m, a.parent, a.dist, a.stats, "a");
      ASSERT_EQ(ra.found, rd.found) << "seed " << seed;
      if (rd.found) {
        EXPECT_EQ(ra.objectiveCost, rd.objectiveCost) << "seed " << seed;
        EXPECT_LE(a.expandedVertices, sd.visitedVertices) << "seed " << seed;
      }
    }
  }
}

TEST(AStar, InadmissibleRejected) {
  Network n;
  n.vertices = {{"a", "A", 0.0, 0.0}, {"b", "B", 1.0, 0.0}};  // ~111km apart
  n.roads = {{"short", "a", "b", true, 100 /*m, far below haversine*/, 10, 0, 0, "x", true}};
  auto built = Graph::build(n, Overlay{});
  ASSERT_TRUE(built.second.empty());  // structural validation passes
  AStarOutcome a = astar(built.first, 0, 1, CostModel::Shortest);
  EXPECT_FALSE(a.ok);
  EXPECT_FALSE(a.detail.empty());
}

TEST(AStar, ZeroSpeedFallsBackToZeroHeuristic) {
  Network n;
  n.vertices = {{"a", "A", 0, 0}, {"b", "B", 0, 0.001}};  // ~111m apart
  n.roads = {{"r", "a", "b", true, 500, 0 /*zero time*/, 0, 0, "r", true}};
  auto built = Graph::build(n, Overlay{});
  ASSERT_TRUE(built.second.empty());
  AStarOutcome a = astar(built.first, 0, 1, CostModel::Fastest);
  ASSERT_TRUE(a.ok);
  EXPECT_TRUE(a.heuristicZero);
  RouteResult r = buildRoute(built.first, 0, 1, CostModel::Fastest, a.parent, a.dist, a.stats, "x");
  EXPECT_TRUE(r.found);
}
