// Graph validation tests.
#include <gtest/gtest.h>

#include "pathforge/graph.hpp"

using namespace pathforge;

TEST(Validate, AcceptsGoodNetwork) {
  Network n;
  n.vertices = {{"a", "A", 30.0, 76.0}};
  n.roads = {};
  EXPECT_TRUE(Graph::validate(n).empty());
}

TEST(Validate, DuplicateVertex) {
  Network n;
  n.vertices = {{"a", "A", 0, 0}, {"a", "A2", 0, 0}};
  auto issues = Graph::validate(n);
  ASSERT_FALSE(issues.empty());
  EXPECT_EQ(issues[0].code, "DUPLICATE_ID");
}

TEST(Validate, UnknownVertexRef) {
  Network n;
  n.vertices = {{"a", "A", 0, 0}};
  n.roads = {{"r1", "a", "ghost", true, 10, 5, 0, 0, "r1", true}};
  auto issues = Graph::validate(n);
  ASSERT_FALSE(issues.empty());
  EXPECT_EQ(issues[0].code, "UNKNOWN_VERTEX");
}

TEST(Validate, BadRangesAndCoords) {
  Network n;
  n.vertices = {{"a", "A", 999, 0}};
  n.roads = {{"r1", "a", "a", false, -5, 10, 0, 0, "r1", true}};
  auto issues = Graph::validate(n);
  EXPECT_GE(issues.size(), 2u);
}

TEST(Validate, BadFactorRejected) {
  Network n;
  n.vertices = {{"a", "A", 0, 0}, {"b", "B", 0, 1}};
  n.roads = {{"r1", "a", "b", true, 10, 5, 0, 0, "r1", true}};
  Overlay ov;
  ov.factors = {{"r1", 0}};
  auto built = Graph::build(n, ov);
  EXPECT_FALSE(built.second.empty());
}
