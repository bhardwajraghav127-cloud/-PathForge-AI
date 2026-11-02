// PathForge core types.
// Purpose: shared value types for the network model, overlay, and route output.
// Invariants: integer metres/seconds/INR (int64); traffic factors in permille;
//   arc IDs are "<roadId>:f" / "<roadId>:r"; adjacency order is canonical arc-ID order.
// Complexity: plain data holders (O(1)).
// Viva Q&A:
//   Q: Why int64 instead of double for times? A: determinism + exact tie-breaks, no FP noise.
//   Q: What is permille? A: 1000 = 100%; 400 = 40% of baseline speed.
//   Q: Why arc IDs not vertex IDs for identity? A: parallel roads need distinct identity.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace pathforge {

inline constexpr std::int64_t kInf64 = static_cast<std::int64_t>(4000000000000000000LL);
inline constexpr int kMaxRequestBytes = 4 * 1024 * 1024;
inline constexpr int kApiVersion = 1;

enum class CostModel { Fastest, Shortest };

struct Vertex {
  std::string id;
  std::string name;
  double lat = 0.0;
  double lon = 0.0;
};

struct Road {
  std::string id;
  std::string from;
  std::string to;
  bool oneWay = false;
  std::int64_t distanceM = 0;
  std::int64_t baselineTimeS = 0;
  int refSpeedKph = 0;
  std::int64_t tollInr = 0;
  std::string name;
  bool available = true;
};

struct Network {
  int schemaVersion = 1;
  std::vector<Vertex> vertices;
  std::vector<Road> roads;
};

// Minimal M1 overlay: versioned road closures + per-road speed factors (permille).
struct Overlay {
  std::int64_t version = 0;
  std::vector<std::string> closures;  // road IDs closed in BOTH directions (M1)
  std::vector<std::pair<std::string, int>> factors;  // roadId -> permille 1..1000
};

struct Arc {
  std::string id;      // "<roadId>:f" or "<roadId>:r"
  std::string roadId;
  int from = -1;       // vertex index
  int to = -1;         // vertex index
  std::size_t roadIdx = 0;
  bool forward = true;
};

struct RouteLeg {
  std::string arcId;
  std::string roadId;
  std::string from;
  std::string to;
};

struct RouteResult {
  bool found = false;
  std::string reason;  // e.g. "UNREACHABLE" when !found
  std::vector<RouteLeg> arcs;
  std::vector<std::string> vertices;
  std::int64_t distanceM = 0;
  std::int64_t timeS = 0;
  std::int64_t baselineTimeS = 0;
  std::int64_t delayS = 0;
  std::int64_t tollInr = 0;
  std::int64_t objectiveCost = 0;
  std::string objectiveDescription;
  // M1: no partialLeadingArc (mid-arc routing arrives M2); field reserved.
};

struct EngineStats {
  std::int64_t visitedVertices = 0;
  std::int64_t relaxedEdges = 0;
  std::int64_t heapOps = 0;
};

}  // namespace pathforge
