// Incident composition: min factor, summed delays, closure wins, direction.
#include <gtest/gtest.h>

#include "pathforge/graph.hpp"

using namespace pathforge;

namespace {
Network twoWay() {
  Network n;
  n.vertices = {{"a", "A", 0, 0}, {"b", "B", 0, 1}};
  n.roads = {{"r1", "a", "b", false, 1000, 100, 0, 0, "r1", true}};
  return n;
}
int arcIdx(const Graph& g, const std::string& id) {
  for (int i = 0; i < g.arcCount(); ++i) {
    if (g.arc(i).id == id) return i;
  }
  return -1;
}
}  // namespace

TEST(Incidents, MinFactorSummedDelay) {
  Overlay ov;
  ov.incidents = {{"i1", "r1", IncidentDir::Both, IncidentKind::Jam},
                  {"i2", "r1", IncidentDir::Both, IncidentKind::Accident}};
  auto built = Graph::build(twoWay(), ov);
  ASSERT_TRUE(built.second.empty()) << built.second.front().message;
  const Graph& g = built.first;
  EffectiveCost c = g.cost(arcIdx(g, "r1:f"));
  ASSERT_TRUE(c.usable);
  EXPECT_EQ(c.factorPermille, 200);                 // min(400, 200)
  EXPECT_EQ(c.delayS, 600);                         // 0 + 600
  EXPECT_EQ(c.timeS, 500 + 600);                    // scaled 100s@200 + delay
  EXPECT_EQ(g.arcIncidents(arcIdx(g, "r1:f")).size(), 2u);
}

TEST(Incidents, ClosureWinsAndDirectional) {
  Overlay ov;
  ov.incidents = {{"c1", "r1", IncidentDir::Forward, IncidentKind::Closure}};
  auto built = Graph::build(twoWay(), ov);
  ASSERT_TRUE(built.second.empty());
  const Graph& g = built.first;
  EXPECT_FALSE(g.cost(arcIdx(g, "r1:f")).usable);  // forward closed
  EXPECT_TRUE(g.cost(arcIdx(g, "r1:r")).usable);   // reverse still open
}

TEST(Incidents, InvalidRefsRejected) {
  Overlay ov;
  ov.incidents = {{"i1", "ghost", IncidentDir::Both, IncidentKind::Jam}};
  auto built = Graph::build(twoWay(), ov);
  ASSERT_FALSE(built.second.empty());
  EXPECT_EQ(built.second.front().code, "UNKNOWN_ROAD");
  Overlay ov2;
  ov2.incidents = {{"dup", "r1", IncidentDir::Both, IncidentKind::Jam},
                   {"dup", "r1", IncidentDir::Both, IncidentKind::Partial}};
  auto b2 = Graph::build(twoWay(), ov2);
  ASSERT_FALSE(b2.second.empty());
  EXPECT_EQ(b2.second.front().code, "DUPLICATE_ID");
}
