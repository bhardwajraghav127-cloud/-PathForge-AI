// Shared MST result types (Prim + Kruskal agree on this shape).
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "pathforge/graph.hpp"

namespace pathforge {

struct MstEdge {
  std::string roadId;
  std::string from;  // vertex ids (undirected; from/to as stored)
  std::string to;
  std::int64_t weightM = 0;
};

struct MstResult {
  bool forest = false;  // true when the graph is disconnected
  std::vector<MstEdge> edges;
  std::int64_t totalWeightM = 0;
  std::int64_t relaxedEdges = 0;
  std::int64_t heapOps = 0;
  std::vector<TraceEvent> trace;
  bool truncated = false;
};

}  // namespace pathforge
