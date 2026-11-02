// Mid-arc position + plan evaluation tests (shared-convention proofs).
#include <gtest/gtest.h>

#include <nlohmann/json.hpp>

#include "pathforge/dijkstra.hpp"
#include "pathforge/engine.hpp"
#include "pathforge/graph.hpp"
#include "pathforge/position.hpp"

using nlohmann::json;
using namespace pathforge;

namespace {
Network line() {
  Network n;
  n.vertices = {{"a", "A", 0, 0}, {"b", "B", 0, 1}, {"c", "C", 0, 2}};
  n.roads = {
      {"r1", "a", "b", true, 1000, 100, 0, 0, "r1", true},
      {"r2", "b", "c", true, 1000, 100, 0, 0, "r2", true},
  };
  return n;
}
}  // namespace

TEST(Position, RemainderCeilingAndNoDoubleCount) {
  auto built = Graph::build(line(), Overlay{});
  ASSERT_TRUE(built.second.empty());
  const Graph& g = built.first;
  // Halfway along r1:f (fraction 500): remainder = ceil(100*500/1000) = 50.
  ResolvedSource src = resolveArcSource(g, "r1:f", 500);
  ASSERT_TRUE(src.errorCode.empty());
  EXPECT_TRUE(src.midArc);
  Remainder rem = remainderFor(g, src.arcIdx, src);
  EXPECT_EQ(rem.timeS, 50);
  EXPECT_EQ(rem.distanceM, 500);
  // Full route a->c via mid-arc start: 50 + 100 = 150, counted exactly once.
  BalancedParams bp;
  ResolvedObjective ro = resolveObjective(g, "FASTEST", bp);
  auto costFn = [&](int ai) { return scalarArcCost(g, ai, ro, g.factorPermille(ai)); };
  std::vector<std::int64_t> dist;
  std::vector<int> hops;
  DijkstraStats st;
  int head = src.vertexIdx;
  std::vector<int> parent = dijkstraScalar(g, head, costFn, dist, hops, st, nullptr, 20000,
                                           scalarRemainderCost(g, 1, rem, ro));
  RouteResult suffix = buildRoute(g, head, 2, CostModel::Fastest, parent, dist, st, "f");
  ASSERT_TRUE(suffix.found);
  EXPECT_EQ(suffix.timeS, 100);          // suffix only
  EXPECT_EQ(suffix.objectiveCost, 150);  // remainder included once
  // fraction=1000 => arrival at head (plain vertex source).
  ResolvedSource arr = resolveArcSource(g, "r1:f", 1000);
  EXPECT_FALSE(arr.midArc);
  EXPECT_EQ(g.vertex(arr.vertexIdx).id, "b");
  // Bad fraction rejected.
  EXPECT_EQ(resolveArcSource(g, "r1:f", 1001).errorCode, "INVALID_POSITION");
  EXPECT_EQ(resolveArcSource(g, "nope:f", 10).errorCode, "UNKNOWN_ROAD");
}

TEST(Position, OccupiedClosureCrawls) {
  Overlay ov;
  ov.closures = {"r1"};
  auto built = Graph::build(line(), ov);
  ASSERT_TRUE(built.second.empty());
  const Graph& g = built.first;
  ResolvedSource src = resolveArcSource(g, "r1:f", 500);
  ASSERT_TRUE(src.errorCode.empty());
  EXPECT_TRUE(src.occupyingClosedArc);
  Remainder rem = remainderFor(g, 0, src);
  EXPECT_TRUE(rem.crawl);
  // Crawl = 10x baseline remainder: baseline 100 -> remainder 50 -> crawl 500.
  EXPECT_EQ(rem.timeS, 500);
  // Plan evaluation flags crawl but stays traversable for the remainder.
  BalancedParams bp;
  ResolvedObjective ro = resolveObjective(g, "FASTEST", bp);
  std::string ec, ed;
  PlanEval ev = evaluatePlan(g, {"r1:f", "r2:f"}, src, &ro, ec, ed);
  EXPECT_TRUE(ec.empty());
  EXPECT_TRUE(ev.valid);
  EXPECT_TRUE(ev.occupyingClosedArc);
  EXPECT_EQ(ev.timeS, 600);  // 500 crawl remainder + 100 suffix
}

TEST(Position, EvaluateBlockedAndDiscontinuous) {
  Overlay ov;
  ov.closures = {"r2"};
  auto built = Graph::build(line(), ov);
  ASSERT_TRUE(built.second.empty());
  const Graph& g = built.first;
  BalancedParams bp;
  ResolvedObjective ro = resolveObjective(g, "FASTEST", bp);
  std::string ec, ed;
  ResolvedSource v = resolveVertexSource(0);
  PlanEval blocked = evaluatePlan(g, {"r1:f", "r2:f"}, v, &ro, ec, ed);
  EXPECT_TRUE(ec.empty());
  EXPECT_TRUE(blocked.valid);
  EXPECT_TRUE(blocked.blocked);
  EXPECT_EQ(blocked.blockedAtArc, "r2:f");
  EXPECT_EQ(blocked.blockedAtIndex, 1u);
  PlanEval bad = evaluatePlan(g, {"r1:f", "r1:f"}, v, &ro, ec, ed);
  EXPECT_FALSE(bad.valid);
  EXPECT_EQ(bad.reason, "DISCONTINUOUS");
  // Mid-arc plan must start with the occupied arc.
  ResolvedSource src = resolveArcSource(g, "r2:f", 100);
  PlanEval mis = evaluatePlan(g, {"r1:f"}, src, &ro, ec, ed);
  EXPECT_FALSE(mis.valid);
}

TEST(Position, RouteFindMidArcEnvelope) {
  json net{{"schemaVersion", 1},
           {"vertices", {{{"id", "a"}}, {{"id", "b"}}, {{"id", "c"}}}},
           {"roads",
            {{{"id", "r1"},
              {"from", "a"},
              {"to", "b"},
              {"oneWay", true},
              {"distanceM", 1000},
              {"baselineTimeS", 100}},
             {{"id", "r2"},
              {"from", "b"},
              {"to", "c"},
              {"oneWay", true},
              {"distanceM", 1000},
              {"baselineTimeS", 100}}}}};
  json req{{"apiVersion", 1},
           {"requestId", "mid-1"},
           {"command", "route.find"},
           {"payload",
            {{"network", net},
             {"source", {{"arc", "r1:f"}, {"fractionPermille", 500}}},
             {"target", "c"},
             {"objective", "FASTEST"},
             {"algorithm", "DIJKSTRA"}}}};
  json res = json::parse(execute(req.dump()));
  ASSERT_TRUE(res.at("ok").get<bool>());
  EXPECT_TRUE(res.at("result").at("found").get<bool>());
  EXPECT_EQ(res.at("result").at("timeS").get<std::int64_t>(), 150);
  EXPECT_TRUE(res.at("result").contains("partialLeadingArc"));
  EXPECT_EQ(res.at("result").at("arcs")[0].at("arcId").get<std::string>(), "r1:f");
}
