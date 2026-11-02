// Yen oracle tests: brute-force simple-path agreement + envelope behavior.
#include <gtest/gtest.h>

#include <functional>
#include <iostream>
#include <set>
#include <vector>

#include <nlohmann/json.hpp>

#include "pathforge/engine.hpp"
#include "pathforge/graph.hpp"
#include "pathforge/yen.hpp"

using nlohmann::json;
using namespace pathforge;

namespace {

// Small multigraph with parallel roads + cycles (Yen must stay loopless).
Network mesh() {
  Network n;
  n.vertices = {{"s", "S", 0, 0}, {"a", "A", 0, 1}, {"b", "B", 1, 0},
                {"c", "C", 1, 1}, {"t", "T", 2, 0}};
  n.roads = {
      {"s-a", "s", "a", true, 100, 10, 0, 0, "x", true},
      {"s-b", "s", "b", true, 100, 12, 0, 0, "x", true},
      {"a-c", "a", "c", true, 100, 10, 0, 0, "x", true},
      {"b-c", "b", "c", true, 100, 8, 0, 0, "x", true},
      {"c-t", "c", "t", true, 100, 10, 0, 0, "x", true},
      {"a-t", "a", "t", true, 500, 40, 0, 0, "x", true},
      {"b-a", "b", "a", true, 100, 5, 0, 0, "x", true},  // cycle edge
      {"t-c", "t", "c", true, 100, 10, 0, 0, "x", true},  // back edge
  };
  return n;
}

// Brute-force all simple s->t paths (test oracle only).
void dfsAll(const Graph& g, int u, int dst, std::vector<int>& cur,
            std::vector<char>& seen, std::vector<std::vector<int>>& out) {
  if (u == dst) {
    out.push_back(cur);
    return;
  }
  seen[static_cast<std::size_t>(u)] = 1;
  for (int ai : g.outgoing(u)) {
    int v = g.arc(ai).to;
    if (seen[static_cast<std::size_t>(v)]) continue;
    cur.push_back(ai);
    dfsAll(g, v, dst, cur, seen, out);
    cur.pop_back();
  }
  seen[static_cast<std::size_t>(u)] = 0;
}

}  // namespace

TEST(Yen, MatchesBruteForce) {
  auto built = Graph::build(mesh(), Overlay{});
  ASSERT_TRUE(built.second.empty());
  const Graph& g = built.first;
  int si = g.vertexIndex("s");
  int di = g.vertexIndex("t");
  auto costFn = [&](int ai) { return g.cost(ai).timeS; };
  DijkstraStats st;
  std::vector<YenPath> yen = yenKShortest(g, si, di, costFn, 10, st);
  std::vector<std::vector<int>> all;
  std::vector<int> cur;
  std::vector<char> seen(static_cast<std::size_t>(g.vertexCount()), 0);
  dfsAll(g, si, di, cur, seen, all);
  // Oracle costs sorted.
  std::vector<std::int64_t> oracle;
  for (const auto& p : all) {
    __int128 t = 0;
    for (int ai : p) t += costFn(ai);
    oracle.push_back(static_cast<std::int64_t>(t));
  }
  std::sort(oracle.begin(), oracle.end());
  ASSERT_FALSE(oracle.empty());
  ASSERT_EQ(yen.size(), std::min<std::size_t>(oracle.size(), 10u));
  for (std::size_t i = 0; i < yen.size(); ++i) EXPECT_EQ(yen[i].scalarCost, oracle[i]) << "k=" << i;
  // Loopless: no repeated vertices in any Yen path.
  for (const auto& p : yen) {
    std::set<int> verts{si};
    int u = si;
    for (int ai : p.arcIdx) {
      u = g.arc(ai).to;
      EXPECT_TRUE(verts.insert(u).second) << "cycle in Yen path";
    }
  }
}

TEST(Yen, AlternativesEnvelope) {
  json net{{"schemaVersion", 1},
           {"vertices",
            {{{"id", "s"}}, {{"id", "a"}}, {{"id", "b"}}, {{"id", "t"}}}},
           {"roads",
            {{{"id", "s-a"},
              {"from", "s"},
              {"to", "a"},
              {"oneWay", true},
              {"distanceM", 100},
              {"baselineTimeS", 10}},
             {{"id", "s-b"},
              {"from", "s"},
              {"to", "b"},
              {"oneWay", true},
              {"distanceM", 100},
              {"baselineTimeS", 12}},
             {{"id", "a-t"},
              {"from", "a"},
              {"to", "t"},
              {"oneWay", true},
              {"distanceM", 100},
              {"baselineTimeS", 10}},
             {{"id", "b-t"},
              {"from", "b"},
              {"to", "t"},
              {"oneWay", true},
              {"distanceM", 100},
              {"baselineTimeS", 10}}}}};
  json base{{"apiVersion", 1},
            {"requestId", "y-0"},
            {"command", "route.alternatives"},
            {"payload",
             {{"network", net},
              {"source", "s"},
              {"target", "t"},
              {"objective", "FASTEST"},
              {"algorithm", "DIJKSTRA"},
              {"maxAlternatives", 3},
              {"maxCandidates", 10}}}};
  json res = json::parse(execute(base.dump()));
  ASSERT_TRUE(res.at("ok").get<bool>());
  EXPECT_TRUE(res.at("result").at("best").at("found").get<bool>());
  EXPECT_EQ(res.at("result").at("best").at("timeS").get<std::int64_t>(), 20);
  // s-a-t (20s) best; s-b-t (22s) shares no arcs -> accepted alternative.
  ASSERT_EQ(res.at("result").at("alternatives").size(), 1u);
  EXPECT_EQ(res.at("result").at("alternatives")[0].at("timeS").get<std::int64_t>(), 22);
  // Best agrees with route.find.
  json fr{{"apiVersion", 1},
          {"requestId", "y-1"},
          {"command", "route.find"},
          {"payload",
           {{"network", net},
            {"source", "s"},
            {"target", "t"},
            {"objective", "FASTEST"},
            {"algorithm", "DIJKSTRA"}}}};
  json fres = json::parse(execute(fr.dump()));
  EXPECT_EQ(fres.at("result").at("timeS"), res.at("result").at("best").at("timeS"));
}

TEST(Yen, CompareAndScenario) {
  json net{{"schemaVersion", 1},
           {"vertices", {{{"id", "s"}}, {{"id", "t"}}}},
           {"roads",
            {{{"id", "fast"},
              {"from", "s"},
              {"to", "t"},
              {"oneWay", true},
              {"distanceM", 1000},
              {"baselineTimeS", 60},
              {"tollInr", 100}},
             {{"id", "free"},
              {"from", "s"},
              {"to", "t"},
              {"oneWay", true},
              {"distanceM", 1000},
              {"baselineTimeS", 120},
              {"tollInr", 0}}}}};
  json cmp{{"apiVersion", 1},
           {"requestId", "c-1"},
           {"command", "route.compare"},
           {"payload",
            {{"network", net},
             {"objective", "FASTEST"},
             {"plans",
              {{{"id", "p1"}, {"arcs", {"fast:f"}}}, {{"id", "p2"}, {"arcs", {"free:f"}}}}}}}};
  json cres = json::parse(execute(cmp.dump()));
  ASSERT_TRUE(cres.at("ok").get<bool>());
  EXPECT_EQ(cres.at("result").at("deltas")[1].at("timeDeltaS").get<std::int64_t>(), 60);
  EXPECT_EQ(cres.at("result").at("deltas")[1].at("tollDeltaInr").get<std::int64_t>(), -100);
  EXPECT_TRUE(cres.at("result").at("sharedArcs").empty());

  json scn{{"apiVersion", 1},
           {"requestId", "s-1"},
           {"command", "scenario.compare"},
           {"payload",
            {{"network", net},
             {"query",
              {{"source", "s"},
               {"target", "t"},
               {"objective", "FASTEST"},
               {"algorithm", "DIJKSTRA"}}},
             {"scenarios",
              {{{"id", "normal"}, {"overlay", {{"version", 1}}}},
               {{"id", "jam"},
                {"overlay",
                 {{"version", 2}, {"factors", {{"fast", 200}}}}}}}}}}};
  json sres = json::parse(execute(scn.dump()));
  ASSERT_TRUE(sres.at("ok").get<bool>());
  ASSERT_EQ(sres.at("result").at("results").size(), 2u);
  // Jammed fast road: 60s -> 300s, alternative free road at 120s wins.
  EXPECT_EQ(sres.at("result").at("results")[1].at("route").at("timeS").get<std::int64_t>(), 120);
  EXPECT_EQ(
      sres.at("result").at("results")[1].at("deltasVsFirst").at("timeDeltaS").get<std::int64_t>(),
      60);
}
