// Directed multigraph with canonical arc-ID adjacency order.
// Purpose: expand physical roads into directed arcs; validate input; answer
//   effective per-arc costs under the overlay.
// Invariants: arcs sorted so every adjacency list is in lexicographic arc-ID
//   order; vertex lookup by ID; closed roads excluded from adjacency.
// Pseudocode: for each road: emit :f arc; emit :r unless oneWay; sort arcs by
//   id; build adjacency; apply closures + factor floors.
// Complexity: build O(R log R); cost lookup O(1).
// Viva Q&A:
//   Q: Why expand two-way roads into two arcs? A: one-way closures/traffic need direction identity.
//   Q: Why sort adjacency? A: deterministic iteration => reproducible Dijkstra traces.
//   Q: How are parallel roads handled? A: distinct arc IDs, both kept, tie-break decides.
#pragma once

#include <set>
#include <string>
#include <vector>

#include "pathforge/types.hpp"

namespace pathforge {

struct EffectiveCost {
  bool usable = false;
  std::int64_t timeS = 0;  // scaled baseline + incident delays
  std::int64_t distanceM = 0;
  std::int64_t tollInr = 0;
  std::int64_t baselineTimeS = 0;
  std::int64_t delayS = 0;  // incident delays included in timeS
  int factorPermille = 1000;
};

struct ValidationIssue {
  std::string code;
  std::string message;
};

class Graph {
 public:
  // Returns empty issues on success. Graph is unusable when issues is non-empty
  // with a hard error code (DUPLICATE_ID, UNKNOWN_VERTEX, BAD_RANGE, ...).
  static std::pair<Graph, std::vector<ValidationIssue>> build(const Network& net,
                                                              const Overlay& ov);

  // Lightweight structural validation without building adjacency.
  static std::vector<ValidationIssue> validate(const Network& net);

  bool empty() const { return vertices_.empty(); }
  int vertexCount() const;
  int arcCount() const;
  int vertexIndex(const std::string& id) const;
  const Vertex& vertex(int idx) const;
  const Arc& arc(int arcIdx) const;
  const std::vector<int>& outgoing(int vertexIdx) const;
  EffectiveCost cost(int arcIdx) const;
  int factorPermille(int arcIdx) const;
  const Road& roadOf(int arcIdx) const;
  const std::vector<std::string>& arcIncidents(int arcIdx) const;
  // Filtered copy: drops banned arcs and arcs touching banned vertices
  // (indices stable; for Yen spur paths).
  Graph subgraph(const std::set<std::string>& bannedArcs,
                 const std::set<std::string>& bannedVertexIds) const;

 private:
  std::vector<Vertex> vertices_;
  std::vector<std::string> vertexIds_;
  std::vector<Arc> arcs_;
  std::vector<std::vector<int>> adj_;
  std::vector<EffectiveCost> costs_;
  std::vector<std::vector<std::string>> arcIncidentIds_;
  std::vector<Road> roads_;
};

}  // namespace pathforge
