// lab.run tests: determinism, route agreement, truncation, errors.
#include <gtest/gtest.h>

#include <nlohmann/json.hpp>

#include "pathforge/engine.hpp"
#include "pathforge/lab.hpp"

using nlohmann::json;
using namespace pathforge;

namespace {
Network tiny() {
  Network n;
  n.vertices = {{"s", "S", 0, 0}, {"a", "A", 0, 1}, {"t", "T", 1, 1}};
  n.roads = {
      {"r1", "s", "a", true, 100, 10, 0, 0, "r1", true},
      {"r2", "a", "t", true, 100, 10, 0, 0, "r2", true},
      {"r3", "s", "t", true, 500, 100, 0, 0, "r3", true},
  };
  return n;
}
}  // namespace

TEST(Lab, BfsDeterministic) {
  auto built = Graph::build(tiny(), Overlay{});
  ASSERT_TRUE(built.second.empty());
  BalancedParams bp;
  ResolvedObjective ro = resolveObjective(built.first, "FASTEST", bp);
  LabOutcome a = runLab(built.first, "BFS", 0, -1, ro, 20000);
  LabOutcome b = runLab(built.first, "BFS", 0, -1, ro, 20000);
  ASSERT_TRUE(a.ok && b.ok);
  EXPECT_EQ(a.order, b.order);
  ASSERT_EQ(a.trace.size(), b.trace.size());
  for (std::size_t i = 0; i < a.trace.size(); ++i) {
    EXPECT_EQ(a.trace[i].type, b.trace[i].type);
    EXPECT_EQ(a.trace[i].vertex, b.trace[i].vertex);
    EXPECT_EQ(a.trace[i].arc, b.trace[i].arc);
  }
}

TEST(Lab, DijkstraMatchesRouteFind) {
  auto built = Graph::build(tiny(), Overlay{});
  ASSERT_TRUE(built.second.empty());
  BalancedParams bp;
  ResolvedObjective ro = resolveObjective(built.first, "FASTEST", bp);
  LabOutcome lo = runLab(built.first, "DIJKSTRA", 0, 2, ro, 20000);
  ASSERT_TRUE(lo.ok && lo.hasRoute && lo.route.found);
  EXPECT_EQ(lo.route.timeS, 20);
  // Same through the JSON envelope.
  json net{{"schemaVersion", 1},
           {"vertices",
            {{{"id", "s"}}, {{"id", "a"}}, {{"id", "t"}}}},
           {"roads",
            {{{"id", "r1"},
              {"from", "s"},
              {"to", "a"},
              {"oneWay", true},
              {"distanceM", 100},
              {"baselineTimeS", 10}},
             {{"id", "r2"},
              {"from", "a"},
              {"to", "t"},
              {"oneWay", true},
              {"distanceM", 100},
              {"baselineTimeS", 10}},
             {{"id", "r3"},
              {"from", "s"},
              {"to", "t"},
              {"oneWay", true},
              {"distanceM", 500},
              {"baselineTimeS", 100}}}}};
  json req{{"apiVersion", 1},
           {"requestId", "lab-1"},
           {"command", "lab.run"},
           {"payload",
            {{"network", net},
             {"algorithm", "DIJKSTRA"},
             {"source", "s"},
             {"target", "t"},
             {"objective", "FASTEST"}}}};
  json res = json::parse(execute(req.dump()));
  ASSERT_TRUE(res.at("ok").get<bool>());
  EXPECT_EQ(res.at("result").at("route").at("timeS").get<std::int64_t>(), 20);
  EXPECT_FALSE(res.at("result").at("trace").empty());
}

TEST(Lab, TruncationAndErrors) {
  auto built = Graph::build(tiny(), Overlay{});
  ASSERT_TRUE(built.second.empty());
  BalancedParams bp;
  ResolvedObjective ro = resolveObjective(built.first, "FASTEST", bp);
  LabOutcome lo = runLab(built.first, "BFS", 0, -1, ro, 2);
  EXPECT_TRUE(lo.truncated);
  LabOutcome bad = runLab(built.first, "BELLMAN_FORD", 0, -1, ro, 20000);
  EXPECT_FALSE(bad.ok);
  EXPECT_EQ(bad.errorCode, "UNKNOWN_ALGORITHM");
  LabOutcome noT = runLab(built.first, "DIJKSTRA", 0, -1, ro, 20000);
  EXPECT_FALSE(noT.ok);
}
