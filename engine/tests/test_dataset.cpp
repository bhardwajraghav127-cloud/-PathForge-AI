// Dataset guarantee tests (M3): computed properties of north-india-sim-v1.
// Nothing is hardcoded: routes, deltas and diversity are all engine outputs.
#include <gtest/gtest.h>

#include <cmath>
#include <fstream>
#include <sstream>

#include <nlohmann/json.hpp>

#include "pathforge/dijkstra.hpp"
#include "pathforge/engine.hpp"
#include "pathforge/graph.hpp"
#include "pathforge/position.hpp"
#include "pathforge/yen.hpp"

using nlohmann::json;
using namespace pathforge;

#ifndef PF_DATASET_DIR
#error "PF_DATASET_DIR must be defined by CMake"
#endif

namespace {

Network loadNet() {
  std::ifstream in(std::string(PF_DATASET_DIR) + "/sample-networks/north-india-sim-v1.json");
  if (!in) throw std::runtime_error("cannot open dataset");
  std::ostringstream ss;
  ss << in.rdbuf();
  json j = json::parse(ss.str());
  Network n;
  for (const auto& v : j.at("vertices"))
    n.vertices.push_back({v.at("id").get<std::string>(), v.value("name", ""),
                         v.at("lat").get<double>(), v.at("lon").get<double>()});
  for (const auto& r : j.at("roads"))
    n.roads.push_back({r.at("id").get<std::string>(), r.at("from").get<std::string>(),
                       r.at("to").get<std::string>(), r.value("oneWay", false),
                       r.at("distanceM").get<std::int64_t>(),
                       r.at("baselineTimeS").get<std::int64_t>(), r.value("refSpeedKph", 0),
                       r.value("tollInr", 0LL), r.value("name", ""), r.value("available", true)});
  return n;
}

Overlay loadPreset(const std::string& id) {
  std::ifstream in(std::string(PF_DATASET_DIR) + "/traffic-scenarios/" + id + ".json");
  if (!in) throw std::runtime_error("cannot open preset " + id);
  std::ostringstream ss;
  ss << in.rdbuf();
  json j = json::parse(ss.str()).at("overlay");
  Overlay ov;
  ov.version = j.value("version", 0LL);
  if (j.contains("factors")) {
    for (auto it = j.at("factors").begin(); it != j.at("factors").end(); ++it)
      ov.factors.emplace_back(it.key(), it.value().get<int>());
  }
  if (j.contains("incidents")) {
    for (const auto& x : j.at("incidents")) {
      Incident ic;
      ic.id = x.at("id").get<std::string>();
      ic.road = x.at("road").get<std::string>();
      std::string d = x.value("dir", "both");
      ic.dir = d == "forward" ? IncidentDir::Forward
                              : (d == "reverse" ? IncidentDir::Reverse : IncidentDir::Both);
      std::string k = x.at("kind").get<std::string>();
      ic.kind = k == "jam"                ? IncidentKind::Jam
                : k == "accident"         ? IncidentKind::Accident
                : k == "construction"     ? IncidentKind::Construction
                : k == "partial"          ? IncidentKind::Partial
                                         : IncidentKind::Closure;
      ov.incidents.push_back(ic);
    }
  }
  if (j.contains("closures")) {
    for (const auto& c : j.at("closures")) ov.closures.push_back(c.get<std::string>());
  }
  return ov;
}

Graph mustBuild(const Network& n, const Overlay& ov) {
  auto b = Graph::build(n, ov);
  EXPECT_TRUE(b.second.empty()) << (b.second.empty() ? "" : b.second.front().message);
  return b.first;
}

std::vector<std::string> arcIds(const RouteResult& r) {
  std::vector<std::string> out;
  for (const auto& a : r.arcs) out.push_back(a.arcId);
  return out;
}

RouteResult findRoute(const Graph& g, const std::string& s, const std::string& t,
                      const std::string& obj) {
  std::vector<std::int64_t> dist;
  std::vector<int> hops;
  DijkstraStats st;
  CostModel m = obj == "FASTEST" ? CostModel::Fastest
                : obj == "SHORTEST"
                    ? CostModel::Shortest
                    : CostModel::LowestToll;
  std::vector<int> parent;
  if (m == CostModel::LowestToll) {
    std::vector<TollLabel> d2;
    parent = dijkstraToll(g, g.vertexIndex(s), d2, hops, st);
    return buildRouteToll(g, g.vertexIndex(s), g.vertexIndex(t), parent, d2, st, obj);
  }
  parent = dijkstra(g, g.vertexIndex(s), m, dist, hops, st);
  return buildRoute(g, g.vertexIndex(s), g.vertexIndex(t), m, parent, dist, st, obj);
}

}  // namespace

TEST(Dataset, StructuralCounts) {
  Network n = loadNet();
  EXPECT_GE(n.vertices.size(), 18u);
  EXPECT_LE(n.vertices.size(), 24u);
  EXPECT_GE(n.roads.size(), 40u);
  EXPECT_LE(n.roads.size(), 60u);
  int oneWay = 0;
  for (const auto& r : n.roads) {
    if (r.oneWay) oneWay++;
  }
  EXPECT_GE(oneWay, 2);
  EXPECT_TRUE(Graph::validate(n).empty());
  Graph g = mustBuild(n, Overlay{});
  // Jind is a single-access leaf.
  EXPECT_EQ(g.outgoing(g.vertexIndex("jind")).size(), 1u);
}

TEST(Dataset, ThreeDistinctCorridors) {
  Network n = loadNet();
  Graph g = mustBuild(n, Overlay{});
  DijkstraStats st;
  auto costFn = [&](int ai) { return g.cost(ai).timeS; };
  std::vector<YenPath> k = yenKShortest(g, g.vertexIndex("chandigarh"), g.vertexIndex("delhi"),
                                       costFn, 10, st);
  ASSERT_GE(k.size(), 3u);
  // Best is the express corridor.
  EXPECT_EQ(k[0].arcIdx.size(), 7u);
}

TEST(Dataset, ShortestDiffersFromFastest) {
  Network n = loadNet();
  Graph g = mustBuild(n, Overlay{});
  RouteResult f = findRoute(g, "chandigarh", "delhi", "FASTEST");
  RouteResult s = findRoute(g, "chandigarh", "delhi", "SHORTEST");
  ASSERT_TRUE(f.found && s.found);
  EXPECT_NE(arcIds(f), arcIds(s));
  EXPECT_LT(s.distanceM, f.distanceM);
  EXPECT_LT(f.timeS, s.timeS);
}

TEST(Dataset, TollDiffersFromFastest) {
  Network n = loadNet();
  Graph g = mustBuild(n, Overlay{});
  RouteResult f = findRoute(g, "chandigarh", "delhi", "FASTEST");
  RouteResult t = findRoute(g, "chandigarh", "delhi", "LOWEST_TOLL");
  ASSERT_TRUE(f.found && t.found);
  EXPECT_NE(arcIds(f), arcIds(t));
  EXPECT_EQ(t.tollInr, 0);
  EXPECT_GT(f.tollInr, 0);
}

TEST(Dataset, MarginalDelayBand) {
  Network n = loadNet();
  Graph base = mustBuild(n, Overlay{});
  RouteResult f = findRoute(base, "chandigarh", "delhi", "FASTEST");
  ASSERT_TRUE(f.found);
  Graph g = mustBuild(n, loadPreset("marginal-delay-v1"));
  BalancedParams bp;
  ResolvedObjective ro;
  ro.model = CostModel::Fastest;
  (void)bp;
  ResolvedSource src = resolveVertexSource(base.vertexIndex("chandigarh"));
  std::string ec, ed;
  std::vector<std::string> ids = arcIds(f);
  PlanEval ev = evaluatePlan(g, ids, src, &ro, ec, ed);
  EXPECT_TRUE(ec.empty());
  ASSERT_TRUE(ev.valid && !ev.blocked);
  std::int64_t delta = ev.timeS - f.timeS;
  EXPECT_GE(delta, 60);
  EXPECT_LE(delta, 540);
}

TEST(Dataset, MajorDelayBand) {
  Network n = loadNet();
  Graph base = mustBuild(n, Overlay{});
  RouteResult f = findRoute(base, "chandigarh", "delhi", "FASTEST");
  ASSERT_TRUE(f.found);
  Graph g = mustBuild(n, loadPreset("major-delay-v1"));
  ResolvedObjective ro;
  ro.model = CostModel::Fastest;
  ResolvedSource src = resolveVertexSource(base.vertexIndex("chandigarh"));
  std::string ec, ed;
  PlanEval ev = evaluatePlan(g, arcIds(f), src, &ro, ec, ed);
  EXPECT_TRUE(ec.empty());
  ASSERT_TRUE(ev.valid && !ev.blocked);
  EXPECT_GE(ev.timeS - f.timeS, 1800);
  // A better alternative exists under the major overlay.
  RouteResult alt = findRoute(g, "chandigarh", "delhi", "FASTEST");
  ASSERT_TRUE(alt.found);
  EXPECT_GE(ev.timeS - alt.timeS, 1800);
}

TEST(Dataset, CentralClosureKeepsAlternativeLeafIsolated) {
  Network n = loadNet();
  Overlay shut;
  shut.closures = {"ex03"};
  Graph g = mustBuild(n, shut);
  RouteResult alt = findRoute(g, "chandigarh", "delhi", "FASTEST");
  EXPECT_TRUE(alt.found);
  Overlay leaf;
  leaf.closures = {"wr10"};
  Graph g2 = mustBuild(n, leaf);
  RouteResult dead = findRoute(g2, "chandigarh", "jind", "FASTEST");
  EXPECT_FALSE(dead.found);
  EXPECT_EQ(dead.reason, "UNREACHABLE");
}

TEST(Dataset, OneWayRespected) {
  Network n = loadNet();
  Graph g = mustBuild(n, Overlay{});
  RouteResult r = findRoute(g, "sonipat", "samalkha", "FASTEST");
  ASSERT_TRUE(r.found);
  ASSERT_EQ(r.arcs.size(), 1u);
  EXPECT_EQ(r.arcs[0].arcId, "ex06r:f");  // legal carriageway, never reversed ex06
  // Global scan: no :r arc of a one-way road appears in any of several queries.
  std::set<std::string> oneWayRoads;
  for (const auto& rd : n.roads) {
    if (rd.oneWay) oneWayRoads.insert(rd.id);
  }
  for (const auto& q :
       {std::pair<std::string, std::string>{"chandigarh", "delhi"},
        {"delhi", "chandigarh"}, {"rohtak", "delhi"}, {"sonipat", "samalkha"}}) {
    RouteResult rr = findRoute(g, q.first, q.second, "FASTEST");
    ASSERT_TRUE(rr.found) << q.first << "->" << q.second;
    for (const auto& a : rr.arcs) {
      if (a.arcId.size() > 2 && a.arcId.substr(a.arcId.size() - 2) == ":r") {
        std::string road = a.arcId.substr(0, a.arcId.size() - 2);
        EXPECT_TRUE(oneWayRoads.find(road) == oneWayRoads.end())
            << "reversed one-way: " << a.arcId;
      }
    }
  }
}

TEST(Dataset, MultiStopCandidates) {
  Network n = loadNet();
  Graph g = mustBuild(n, Overlay{});
  // At least 6 distinct reachable stops from Chandigarh (supports M5 4-stop).
  int reachable = 0;
  for (const auto& v : n.vertices) {
    if (v.id == "chandigarh") continue;
    if (findRoute(g, "chandigarh", v.id, "FASTEST").found) reachable++;
  }
  EXPECT_GE(reachable, 6);
}
