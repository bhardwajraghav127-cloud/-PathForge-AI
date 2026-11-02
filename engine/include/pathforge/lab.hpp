// lab.run: C++-owned algorithm execution with capped traces (M2 subset).
// Purpose: run BFS / DFS / DIJKSTRA / A_STAR and return the result plus the
//   real execution trace for UI replay. UI only replays event indices.
// Payload: {network, overlay?, algorithm, source, target?, objective?,
//   objectiveParams?, maxEvents?}. BFS/DFS ignore target/objective; DIJKSTRA and
//   A_STAR require target. maxEvents default 20000, hard cap 100000.
// Warnings: TRACE_TRUNCATED when capped; HEURISTIC_ZERO when A* runs with h=0.
// Errors: UNKNOWN_ALGORITHM, UNKNOWN_VERTEX, HEURISTIC_INADMISSIBLE (A* gate).
// Viva Q&A:
//   Q: Where is the trace produced? A: inside the algorithm, not reconstructed.
//   Q: What does the UI do with it? A: replay by index: Previous/Next/Play.
//   Q: Why cap events? A: bound memory + payload size on large graphs.
#pragma once

#include <string>
#include <vector>

#include "pathforge/graph.hpp"
#include "pathforge/objectives.hpp"

namespace pathforge {

struct LabOutcome {
  bool ok = false;
  std::string errorCode;  // set when !ok
  std::string errorDetail;
  std::string algorithm;
  // BFS/DFS:
  std::vector<std::string> order;
  // DIJKSTRA/A_STAR:
  RouteResult route;
  bool hasRoute = false;
  std::vector<TraceEvent> trace;
  bool truncated = false;
  bool heuristicZero = false;
  std::int64_t expandedVertices = 0;
  DijkstraStats stats;
};

LabOutcome runLab(const Graph& g, const std::string& algorithm, int srcIdx, int dstIdx,
                  const ResolvedObjective& ro, std::int64_t maxEvents);

}  // namespace pathforge
